/**
 * Agents materializer — discovers agents from raw otel_traces +
 * openlit_controller_services, derives snapshots, and writes them into
 * openlit_agents_summary + openlit_agent_versions.
 *
 * Designed to be invoked from a cron tick (see scripts/agents/materialize.js
 * and /api/agents/materialize). UI request paths never call this directly —
 * they read from the materialized tables.
 */

import { dataCollector, OTEL_TRACES_TABLE_NAME } from "@/lib/platform/common";
import { CONTROLLER_SERVICES_TABLE } from "@/lib/platform/controller/table-details";
import type { AgentSource } from "@/types/agents";
import { computeAgentKey, invalidateAgent } from "./index";
import { invalidatePrefix } from "./cache";
import { agentsLogger } from "./logger";
import {
	deriveSnapshot,
	getLatestVersionsBatch,
	upsertVersion,
} from "./snapshot";
import { AGENTS_SUMMARY_TABLE } from "./table-details";

/**
 * Maximum agents the materializer touches in a single tick.
 *
 * The materializer used to walk every discovered agent on every tick. With
 * 1000+ agents that means 1000+ snapshot derivations + version upserts +
 * insert -- enough to keep the cron busy past its 60s tick interval and
 * cause overlap. We cap each tick at this number and use a round-robin
 * cursor so the work amortizes across multiple ticks.
 *
 * Tunable via env so operators can crank it up when they have spare
 * ClickHouse capacity. 100 is a conservative default that keeps the worst
 * case under ~10s on a healthy ClickHouse.
 */
const MAX_AGENTS_PER_TICK = Math.max(
	1,
	Number(process.env.AGENTS_MATERIALIZE_MAX_PER_TICK || 100)
);

/**
 * Per-dbConfig cursor for round-robin processing. Index points to the next
 * starting position in the sorted agent list. Kept in-process; resets on
 * Node restart, which is fine -- a restart just re-processes from the top
 * of the agent list.
 */
const _materializeCursor = new Map<string, number>();

function escape(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

interface DiscoveredAgent {
	agent_key: string;
	service_name: string;
	environment: string;
	cluster_id: string;
	workload_key: string;
	source: AgentSource;
	controller_service_id: string;
	controller_instance_id: string;
	sdk_version: string;
	sdk_language: string;
	first_seen: string;
	last_seen: string;
	instrumentation_status: string;
	// Provider candidates the controller detected by scanning the process
	// (Python imports for `openai`, `anthropic`, etc.). Lets the agents
	// table render provider logos for controller-discovered workloads
	// before any GenAI trace has arrived. Empty for SDK-only rows.
	controller_llm_providers: string[];
}

const SDK_DISCOVERY_LOOKBACK_MINUTES = 30;

async function discoverAgents(
	dbConfigId?: string,
	clusterFilter?: string
): Promise<DiscoveredAgent[]> {
	const clusterPredicate = clusterFilter
		? `AND cluster_id = '${escape(clusterFilter)}'`
		: "";

	// SDK-side: deduplicate per (service_name, environment, cluster_id) over a
	// recent window. cluster_id defaults to 'default' for SDK-only agents.
	// workload_key comes from ResourceAttributes['service.workload.key'] which
	// the controller injects via OTEL_RESOURCE_ATTRIBUTES on managed processes;
	// SDK-only services emit it empty.
	const sdkQuery = `
		WITH sdk_seen AS (
			SELECT
				ServiceName AS service_name,
				if(ResourceAttributes['deployment.environment'] != '', ResourceAttributes['deployment.environment'], 'default') AS environment,
				if(ResourceAttributes['k8s.cluster.name'] != '', ResourceAttributes['k8s.cluster.name'], 'default') AS cluster_id,
				argMax(ResourceAttributes['service.workload.key'], Timestamp) AS workload_key,
				argMax(ResourceAttributes['telemetry.sdk.version'], Timestamp) AS sdk_version,
				argMax(ResourceAttributes['telemetry.sdk.language'], Timestamp) AS sdk_language,
				min(Timestamp) AS first_seen,
				max(Timestamp) AS last_seen
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE Timestamp >= now() - INTERVAL ${SDK_DISCOVERY_LOOKBACK_MINUTES} MINUTE
				AND ServiceName != ''
				AND ResourceAttributes['telemetry.sdk.name'] = 'openlit'
				-- Exclude controller-managed OBI/eBPF spans: when LLM Observability is
				-- enabled, OBI briefly emits a few spans with telemetry.sdk.name='openlit'
				-- under the original compose service-name (before the controller recreates
				-- the container with OTEL_SERVICE_NAME set). Without this filter those
				-- spans get discovered as a phantom SDK row that the workload_key dedup
				-- cannot merge with the controller row (their workload_key is empty).
				AND ResourceAttributes['telemetry.distro.name'] != 'opentelemetry-ebpf-instrumentation'
			GROUP BY service_name, environment, cluster_id
		)
		SELECT
			service_name,
			environment,
			cluster_id,
			workload_key,
			sdk_version,
			sdk_language,
			first_seen,
			last_seen
		FROM sdk_seen
	`;

	const sdkRes = await dataCollector({ query: sdkQuery }, "query", dbConfigId);
	if (sdkRes.err) {
		agentsLogger.error("materializer_sdk_discovery_failed", {
			err: sdkRes.err,
		});
	}
	const sdkRows = (sdkRes.data as Array<{
		service_name: string;
		environment: string;
		cluster_id: string;
		workload_key: string;
		sdk_version: string;
		sdk_language: string;
		first_seen: string;
		last_seen: string;
	}>) || [];

	const ctrlQuery = `
		WITH latest AS (
			SELECT
				argMax(s.id, s.last_seen) AS id,
				argMax(s.controller_instance_id, s.last_seen) AS controller_instance_id,
				argMax(s.cluster_id, s.last_seen) AS cluster_id,
				argMax(s.service_name, s.last_seen) AS service_name,
				argMax(s.workload_key, s.last_seen) AS workload_key,
				argMax(s.instrumentation_status, s.last_seen) AS instrumentation_status,
				argMax(s.resource_attributes, s.last_seen) AS resource_attributes,
				argMax(s.llm_providers, s.last_seen) AS llm_providers,
				min(s.first_seen) AS first_seen,
				max(s.last_seen) AS last_seen
			FROM ${CONTROLLER_SERVICES_TABLE} s FINAL
			WHERE s.last_seen >= now() - INTERVAL 24 HOUR
				${clusterPredicate}
			GROUP BY concat(s.cluster_id, ':', s.service_name)
		)
		SELECT
			latest.id AS id,
			latest.controller_instance_id AS controller_instance_id,
			latest.cluster_id AS cluster_id,
			latest.service_name AS service_name,
			latest.workload_key AS workload_key,
			latest.instrumentation_status AS instrumentation_status,
			latest.resource_attributes AS resource_attributes,
			latest.llm_providers AS llm_providers,
			latest.first_seen AS first_seen,
			latest.last_seen AS last_seen
		FROM latest
	`;
	const ctrlRes = await dataCollector({ query: ctrlQuery }, "query", dbConfigId);
	if (ctrlRes.err) {
		agentsLogger.error("materializer_controller_discovery_failed", {
			err: ctrlRes.err,
		});
	}
	const ctrlRows = (ctrlRes.data as Array<{
		id: string;
		controller_instance_id: string;
		cluster_id: string;
		service_name: string;
		workload_key: string;
		instrumentation_status: string;
		resource_attributes: Record<string, string> | string[][] | null;
		llm_providers: string[] | null;
		first_seen: string;
		last_seen: string;
	}>) || [];

	const merged = new Map<string, DiscoveredAgent>();
	// Secondary index: (cluster_id|workload_key) -> agent_key in `merged`.
	// Used when a controller row arrives and an SDK row already exists for the
	// same workload but under a different service.name (e.g. controller
	// catalogues a docker container as `demo-openai-app` while the bootstrapped
	// SDK still emits as `openai-app`). Matching by workload_key bridges them
	// into a single `source='both'` row keyed by the controller's agent_key.
	const sdkByWorkloadKey = new Map<string, string>();

	for (const row of sdkRows) {
		if (!row.service_name) continue;
		const env = row.environment || "default";
		const cluster = row.cluster_id || "default";
		const key = computeAgentKey(cluster, env, row.service_name);
		const workloadKey = row.workload_key || "";
		merged.set(key, {
			agent_key: key,
			service_name: row.service_name,
			environment: env,
			cluster_id: cluster,
			workload_key: workloadKey,
			source: "sdk",
			controller_service_id: "",
			controller_instance_id: "",
			sdk_version: row.sdk_version || "",
			sdk_language: row.sdk_language || "",
			first_seen: row.first_seen,
			last_seen: row.last_seen,
			instrumentation_status: "instrumented",
			controller_llm_providers: [],
		});
		if (workloadKey) {
			sdkByWorkloadKey.set(`${cluster}|${workloadKey}`, key);
		}
	}

	for (const row of ctrlRows) {
		if (!row.service_name) continue;
		const cluster = row.cluster_id || "default";
		const attrs = parseResourceAttributes(row.resource_attributes);
		const env = attrs["deployment.environment"] || "default";
		const workloadKey = row.workload_key || "";
		const ctrlKey = computeAgentKey(cluster, env, row.service_name);

		// Workload-key match takes precedence over service-name match so the
		// controller's name is canonical even when the SDK reported a different
		// service.name.
		let existing: DiscoveredAgent | undefined;
		const matchedSdkKey = workloadKey
			? sdkByWorkloadKey.get(`${cluster}|${workloadKey}`)
			: undefined;
		if (matchedSdkKey && matchedSdkKey !== ctrlKey) {
			const sdkRow = merged.get(matchedSdkKey);
			if (sdkRow) {
				merged.delete(matchedSdkKey);
				existing = {
					...sdkRow,
					agent_key: ctrlKey,
					service_name: row.service_name,
					environment: env,
				};
				merged.set(ctrlKey, existing);
			}
		} else {
			existing = merged.get(ctrlKey);
		}

		const ctrlProviders = Array.isArray(row.llm_providers)
			? row.llm_providers.filter(Boolean)
			: [];

		if (existing) {
			existing.source = "both";
			existing.workload_key = workloadKey || existing.workload_key;
			existing.controller_service_id = row.id;
			existing.controller_instance_id = row.controller_instance_id;
			existing.instrumentation_status =
				row.instrumentation_status || existing.instrumentation_status;
			existing.first_seen = earliest(existing.first_seen, row.first_seen);
			existing.last_seen = latest(existing.last_seen, row.last_seen);
			existing.controller_llm_providers = ctrlProviders;
		} else {
			merged.set(ctrlKey, {
				agent_key: ctrlKey,
				service_name: row.service_name,
				environment: env,
				cluster_id: cluster,
				workload_key: workloadKey,
				source: "controller",
				controller_service_id: row.id,
				controller_instance_id: row.controller_instance_id,
				sdk_version: attrs["telemetry.sdk.version"] || "",
				sdk_language: attrs["telemetry.sdk.language"] || "",
				first_seen: row.first_seen,
				last_seen: row.last_seen,
				instrumentation_status: row.instrumentation_status || "discovered",
				controller_llm_providers: ctrlProviders,
			});
		}
	}

	return Array.from(merged.values());
}

function earliest(a: string, b: string): string {
	if (!a) return b;
	if (!b) return a;
	return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

function latest(a: string, b: string): string {
	if (!a) return b;
	if (!b) return a;
	return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function parseResourceAttributes(
	raw: Record<string, string> | string[][] | null | undefined
): Record<string, string> {
	if (!raw) return {};
	if (Array.isArray(raw)) {
		const out: Record<string, string> = {};
		for (const pair of raw) {
			if (Array.isArray(pair) && pair.length >= 2) {
				out[String(pair[0])] = String(pair[1]);
			}
		}
		return out;
	}
	if (typeof raw === "object") {
		return raw as Record<string, string>;
	}
	return {};
}

interface RequestCountRow {
	agent_key: string;
	request_count_24h: number;
}

async function fetchRequestCounts(
	agents: DiscoveredAgent[],
	dbConfigId?: string
): Promise<Map<string, number>> {
	if (!agents.length) return new Map();
	const serviceNames = Array.from(new Set(agents.map((a) => a.service_name)));
	const namesList = serviceNames.map((n) => `'${escape(n)}'`).join(", ");
	const query = `
		SELECT
			ServiceName AS service_name,
			if(ResourceAttributes['deployment.environment'] != '', ResourceAttributes['deployment.environment'], 'default') AS environment,
			if(ResourceAttributes['k8s.cluster.name'] != '', ResourceAttributes['k8s.cluster.name'], 'default') AS cluster_id,
			count() AS request_count_24h
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE Timestamp >= now() - INTERVAL 24 HOUR
			AND ServiceName IN (${namesList})
		GROUP BY service_name, environment, cluster_id
	`;
	const res = await dataCollector({ query }, "query", dbConfigId);
	if (res.err) {
		agentsLogger.error("materializer_request_count_failed", {
			err: res.err,
		});
		return new Map();
	}
	const rows = (res.data as Array<{
		service_name: string;
		environment: string;
		cluster_id: string;
		request_count_24h: number;
	}>) || [];
	const map = new Map<string, number>();
	for (const r of rows) {
		const key = computeAgentKey(
			r.cluster_id || "default",
			r.environment || "default",
			r.service_name
		);
		map.set(key, Number(r.request_count_24h || 0));
	}
	return map;
}

export interface MaterializeResult {
	processed: number;
	newVersions: number;
	errors: number;
}

interface SummaryUpsertRow {
	agent_key: string;
	service_name: string;
	environment: string;
	cluster_id: string;
	workload_key: string;
	source: AgentSource;
	controller_service_id: string;
	controller_instance_id: string;
	primary_model: string;
	models: string[];
	providers: string[];
	tool_names: string[];
	tool_count: number;
	request_count_24h: number;
	current_version_hash: string;
	current_version_number: number;
	sdk_version: string;
	sdk_language: string;
	instrumentation_status: string;
	last_materialized_at: string;
	first_seen: string;
	last_seen: string;
	updated_at: string;
}

function toClickHouseTimestamp(value: string | Date | number | undefined): string {
	// openlit_agents_summary uses plain ClickHouse DateTime columns (second
	// precision), so we have to emit `YYYY-MM-DD HH:mm:ss` -- milliseconds make
	// the JSONEachRow parser bail with `Cannot parse input: expected '"' before
	// ".SSS"`. We also treat ClickHouse-formatted strings as UTC (their actual
	// timezone) instead of round-tripping through `new Date(string)`, which
	// would coerce the space-separated form to local time on some Node builds.
	if (typeof value === "string") {
		const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
		if (m) return `${m[1]} ${m[2]}`;
	}
	const d = value ? new Date(value) : new Date();
	const valid = !Number.isNaN(d.getTime()) ? d : new Date();
	return valid.toISOString().slice(0, 19).replace("T", " ");
}

interface MaterializeOptions {
	dbConfigId?: string;
	/** Limit work to a single agent_key when only one agent needs a refresh. */
	agentKeyFilter?: string;
	/** Limit work to a single service/env/cluster when forced via API. */
	scope?: { serviceName: string; environment?: string; clusterId?: string };
	lookbackMinutes?: number;
}

export async function materializeAgents(
	options: MaterializeOptions = {}
): Promise<MaterializeResult> {
	const { dbConfigId, agentKeyFilter, scope, lookbackMinutes } = options;
	let discovered: DiscoveredAgent[];

	if (scope?.serviceName) {
		const env = scope.environment || "default";
		const cluster = scope.clusterId || "default";
		const key = computeAgentKey(cluster, env, scope.serviceName);
		const all = await discoverAgents(dbConfigId, scope.clusterId);
		const match = all.find((a) => a.agent_key === key);
		if (match) {
			discovered = [match];
		} else {
			// Manufacture a placeholder SDK row so we can still derive a snapshot.
			discovered = [
				{
					agent_key: key,
					service_name: scope.serviceName,
					environment: env,
					cluster_id: cluster,
					workload_key: "",
					source: "sdk",
					controller_service_id: "",
					controller_instance_id: "",
					sdk_version: "",
					sdk_language: "",
					first_seen: new Date().toISOString(),
					last_seen: new Date().toISOString(),
					instrumentation_status: "instrumented",
					controller_llm_providers: [],
				},
			];
		}
	} else if (agentKeyFilter) {
		const all = await discoverAgents(dbConfigId);
		const match = all.find((a) => a.agent_key === agentKeyFilter);
		discovered = match ? [match] : [];
	} else {
		discovered = await discoverAgents(dbConfigId);
	}

	if (!discovered.length) {
		return { processed: 0, newVersions: 0, errors: 0 };
	}

	// Apply per-tick cap with round-robin cursor for the broad-discovery
	// path. Single-agent invocations (scope / agentKeyFilter) ignore the cap
	// because they're already bounded to one agent. Sorting by agent_key
	// makes the cursor deterministic across ticks.
	const isBroadDiscovery = !agentKeyFilter && !scope?.serviceName;
	if (isBroadDiscovery && discovered.length > MAX_AGENTS_PER_TICK) {
		discovered.sort((a, b) => a.agent_key.localeCompare(b.agent_key));
		const cursorKey = `${dbConfigId || "default"}`;
		const cursor = _materializeCursor.get(cursorKey) || 0;
		const end = Math.min(cursor + MAX_AGENTS_PER_TICK, discovered.length);
		const slice = discovered.slice(cursor, end);
		// Wrap to the front when we fall short of MAX_AGENTS_PER_TICK so the
		// tick still uses its full budget on small backlogs.
		if (slice.length < MAX_AGENTS_PER_TICK && cursor > 0) {
			const remaining = MAX_AGENTS_PER_TICK - slice.length;
			slice.push(...discovered.slice(0, Math.min(remaining, cursor)));
		}
		const nextCursor = end >= discovered.length ? 0 : end;
		_materializeCursor.set(cursorKey, nextCursor);
		discovered = slice;
	}

	const requestCounts = await fetchRequestCounts(discovered, dbConfigId);
	// One round-trip for the entire batch instead of one per agent in the
	// "no GenAI activity" fallback path.
	const latestVersionsByKey = await getLatestVersionsBatch(
		discovered.map((a) => a.agent_key),
		dbConfigId
	);

	let processed = 0;
	let newVersions = 0;
	let errors = 0;
	const summaryRows: SummaryUpsertRow[] = [];

	for (const agent of discovered) {
		try {
			const snapshot = await deriveSnapshot({
				serviceName: agent.service_name,
				environment: agent.environment,
				clusterId: agent.cluster_id,
				lookbackMinutes,
				dbConfigId,
			});

			let versionHash = "";
			let versionNumber = 0;
			let primaryModel = "";
			let models: string[] = [];
			let providers: string[] = [];
			let toolNames: string[] = [];
			let toolCount = 0;

			if (snapshot) {
				const upsertRes = await upsertVersion(snapshot, dbConfigId);
				versionHash = snapshot.version_hash;
				versionNumber = upsertRes.versionNumber;
				if (upsertRes.isNewVersion) newVersions += 1;
				primaryModel = snapshot.primary_model;
				models = snapshot.models;
				providers = snapshot.providers;
				toolNames = snapshot.tools.map((t) => t.name);
				toolCount = snapshot.tools.length;
			} else {
				const latestVersion = latestVersionsByKey.get(agent.agent_key);
				if (latestVersion) {
					versionHash = latestVersion.version_hash;
					versionNumber = latestVersion.version_number;
					primaryModel = latestVersion.primary_model;
					models = latestVersion.models;
					providers = latestVersion.providers;
					toolNames = latestVersion.tools.map((t) => t.name);
					toolCount = latestVersion.tools.length;
				}
			}

			// Union controller-detected providers (from process import-scan)
			// with any trace-derived providers. This is what populates provider
			// logos on the agents table for freshly-discovered controller
			// workloads that haven't emitted GenAI spans yet, and for SDK
			// workloads where the controller saw the import but the snapshot
			// window did not yet contain a request. We clone before pushing so
			// we don't mutate the snapshot / cached-version arrays in place.
			if (agent.controller_llm_providers.length) {
				const merged = providers.slice();
				const seen = new Set(merged);
				for (const p of agent.controller_llm_providers) {
					if (p && !seen.has(p)) {
						merged.push(p);
						seen.add(p);
					}
				}
				providers = merged;
			}

			const requestCount24h = requestCounts.get(agent.agent_key) || 0;
			summaryRows.push({
				agent_key: agent.agent_key,
				service_name: agent.service_name,
				environment: agent.environment,
				cluster_id: agent.cluster_id,
				workload_key: agent.workload_key,
				source: agent.source,
				controller_service_id: agent.controller_service_id,
				controller_instance_id: agent.controller_instance_id,
				primary_model: primaryModel,
				models,
				providers,
				tool_names: toolNames,
				tool_count: toolCount,
				request_count_24h: requestCount24h,
				current_version_hash: versionHash,
				current_version_number: versionNumber,
				sdk_version: agent.sdk_version,
				sdk_language: agent.sdk_language,
				instrumentation_status: agent.instrumentation_status || "discovered",
				last_materialized_at: toClickHouseTimestamp(new Date()),
				first_seen: toClickHouseTimestamp(agent.first_seen),
				last_seen: toClickHouseTimestamp(agent.last_seen),
				updated_at: toClickHouseTimestamp(new Date()),
			});
			processed += 1;
		} catch (err) {
			errors += 1;
			agentsLogger.error("materializer_agent_failed", {
				err,
				serviceName: agent.service_name,
				agentKey: agent.agent_key,
			});
		}
	}

	if (summaryRows.length) {
		const res = await dataCollector(
			{ table: AGENTS_SUMMARY_TABLE, values: summaryRows },
			"insert",
			dbConfigId
		);
		if (res.err) {
			agentsLogger.error("materializer_summary_insert_failed", {
				err: res.err,
				rowCount: summaryRows.length,
			});
			errors += summaryRows.length;
		}
		// Bust cache for affected agents — readers see fresh data on next request.
		for (const row of summaryRows) {
			invalidateAgent(row.agent_key, dbConfigId);
		}
		// Listing pages cache by filters; nuke the entire list-cache namespace
		// for this tenant (cheap; entries are tiny).
		invalidatePrefix(`agents:list:${dbConfigId || "default"}:`);
	}

	return { processed, newVersions, errors };
}
