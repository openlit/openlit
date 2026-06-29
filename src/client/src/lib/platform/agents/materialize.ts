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
import {
	CONTROLLER_DESIRED_STATES_V2_TABLE,
	CONTROLLER_SERVICES_TABLE,
} from "@/lib/platform/controller/table-details";
import type { AgentSource, CodingAgentVendor } from "@/types/agents";
import { computeAgentKey, invalidateAgent } from "./index";
import { invalidatePrefix } from "./cache";
import { agentsLogger } from "./logger";
import {
	deriveSnapshot,
	getLatestVersionsBatch,
	upsertVersion,
} from "./snapshot";
import { AGENTS_SUMMARY_TABLE } from "./table-details";
import { escapeClickHouseString } from "@/lib/clickhouse-escape";
import { mergeProviders } from "./provider-normalize";

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

const escape = escapeClickHouseString;

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
	// Coding-agent specific rollups, populated by discoverCodingAgents()
	// only on rows where source === 'coding'. All zero/empty for other rows.
	coding_agent_vendor?: CodingAgentVendor;
	coding_session_count_24h?: number;
	coding_cost_usd_24h?: number;
	coding_active_users_24h?: number;
	// Per-vendor code-change 24h rollups. Same `greatest(rollup,
	// per-edit-sum)` pattern as queries.ts so the hub agrees with
	// the per-session Sessions list.
	coding_lines_added_24h?: number;
	coding_lines_removed_24h?: number;
	coding_lines_accepted_24h?: number;
	coding_lines_rejected_24h?: number;
	coding_edit_accept_24h?: number;
	coding_edit_reject_24h?: number;
	coding_commit_count_24h?: number;
	coding_pr_count_24h?: number;
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
	// Coding-agent CLI spans are deliberately kept out of SDK discovery.
	// Three independent barriers exist; the first one a future change
	// breaks, the others catch it. They are listed in order of how
	// structurally robust they are:
	//
	//   1. Distro marker (PRIMARY). The CLI stamps
	//      telemetry.distro.name = 'openlit-cli' on every span as a
	//      resource attribute (see cli/internal/otlp/exporter.go). This
	//      identifies the entire emitting distribution -- there is
	//      nothing per-event about it; if even one span has it, every
	//      span from that process has it. A service_name that ever
	//      sets this distro inside the window is excluded entirely
	//      from SDK discovery via the cli_services anti-join below.
	//   2. coding_agent.session.id per-span filter (LEGACY backstop).
	//      Kept so historical data emitted before the distro marker
	//      shipped doesn't suddenly start showing up here. Remove
	//      this once the retention window has rolled past the distro
	//      cutover.
	//   3. The ReplacingMergeTree dedup on agent_key -- anything that
	//      slipped past both filters above would still end up
	//      fighting with the coding row, and we'd see the agent flip
	//      layout on every materialize tick. The user-visible symptom
	//      is "the SDK Overview tabs render on my Cursor agent"; the
	//      original bug was that only barrier #2 existed and any race
	//      or regression in the per-span stamp leaked a phantom SDK
	//      row. The structural fix is #1.
	const sdkQuery = `
		WITH
			-- Any service_name that emitted a CLI span (any distro =
			-- 'openlit-cli') inside the lookback window. This is the
			-- positive identifier that *this process* is a coding-agent
			-- hook, not a regular openlit-go SDK service. We exclude
			-- the entire (service, env, cluster) tuple even if some
			-- spans within it happen to lack coding_agent.session.id
			-- (e.g. a CLI startup span emitted before the first hook
			-- event, or any future leak).
			cli_services AS (
				SELECT DISTINCT
					ServiceName AS service_name,
					if(ResourceAttributes['deployment.environment'] != '', ResourceAttributes['deployment.environment'], 'default') AS environment,
					if(ResourceAttributes['k8s.cluster.name'] != '', ResourceAttributes['k8s.cluster.name'], 'default') AS cluster_id
				FROM ${OTEL_TRACES_TABLE_NAME}
				WHERE Timestamp >= now() - INTERVAL ${SDK_DISCOVERY_LOOKBACK_MINUTES} MINUTE
					AND (
						ResourceAttributes['telemetry.distro.name'] = 'openlit-cli'
						OR ResourceAttributes['coding_agent.session.id'] != ''
						OR SpanAttributes['coding_agent.session.id'] != ''
					)
			),
			sdk_seen AS (
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
				-- Barrier #1: positive distro-name exclusion.
				AND ResourceAttributes['telemetry.distro.name'] != 'openlit-cli'
				-- Barrier #2: legacy per-span fallback for data emitted before
				-- the distro marker shipped. Remove after the retention window
				-- has rolled past.
				AND ResourceAttributes['coding_agent.session.id'] = ''
				AND SpanAttributes['coding_agent.session.id'] = ''
				-- Barrier #1 reinforced: even if individual spans don't have
				-- the distro marker, the service_name as a whole must not be
				-- one that ever emitted a CLI span in this window.
				AND (ServiceName, if(ResourceAttributes['deployment.environment'] != '', ResourceAttributes['deployment.environment'], 'default'), if(ResourceAttributes['k8s.cluster.name'] != '', ResourceAttributes['k8s.cluster.name'], 'default')) NOT IN (SELECT service_name, environment, cluster_id FROM cli_services)
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

	// The materializer needs to keep stopped workloads in agents_summary
	// even after their last heartbeat aged out of the 24h window. We do
	// that by UNION-ing the active heartbeat rows with the
	// lifetime-latest row for any workload whose lifecycle desired
	// state is 'stopped'. Without this, a workload that has been
	// stopped for >24h would silently disappear from the UI -- the
	// agents-list query reads agents_summary, and agents_summary only
	// keeps rows the materializer rewrites.
	const ctrlQuery = `
		WITH active AS (
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
		),
		stopped_keys AS (
			SELECT workload_key, cluster_id
			FROM ${CONTROLLER_DESIRED_STATES_V2_TABLE} FINAL
			WHERE feature = 'lifecycle' AND desired_status = 'stopped'
				AND workload_key != ''
				${clusterPredicate}
		),
		stopped AS (
			-- Lifetime lookup (no time bound) so stopped agents stay
			-- materialized regardless of how long they have been down.
			-- We bound the size by stopped_keys (small) and exclude
			-- anything already covered by the active CTE to avoid
			-- double-materializing the same workload. The dedup key is
			-- the same (cluster_id, service_name) tuple the active CTE
			-- groups by -- service_name alone would collide across
			-- clusters (e.g. "checkout" running in cluster-prod while
			-- stopped in cluster-staging).
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
			WHERE (s.workload_key, s.cluster_id) IN (SELECT workload_key, cluster_id FROM stopped_keys)
				AND s.workload_key != ''
				${clusterPredicate}
			GROUP BY concat(s.cluster_id, ':', s.service_name)
			HAVING (cluster_id, service_name) NOT IN (SELECT cluster_id, service_name FROM active)
		),
		latest AS (
			SELECT * FROM active
			UNION ALL
			SELECT * FROM stopped
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

/**
 * Coding-agent discovery — separate pass so it stays decoupled from the
 * SDK/controller path. We group raw spans by `coding_agent.client` (mirror
 * of `gen_ai.agent.name`) and emit one summary row per vendor under the
 * synthetic cluster id `coding`. Per-user / per-session detail lives in
 * the dedicated coding-agent dashboards.
 *
 * Why one row per vendor (not per session, repo, or user): the /agents
 * page is a fleet view. A workspace running 50 Claude Code sessions a
 * day shouldn't crowd the page out with 50 rows; it should show one
 * "Claude Code" row whose detail page drills into sessions/users/cost.
 */
/**
 * Optional window override. When omitted (the materializer's
 * canonical call site) the query falls back to a fixed last-24h
 * window — what the agents-hub card has always shown.
 *
 * When the caller passes a window (the live recompute path used by
 * `listAgents` when the user picks a non-default top-right time
 * filter), we honour those bounds instead. This is what makes the
 * hub's Sessions / Users / Cost numbers stay in sync with the
 * Sessions / Users / Dashboard tabs once the user changes the time
 * range.
 */
export interface CodingAgentDiscoveryWindow {
	timeStart?: string;
	timeEnd?: string;
}

function escapeTimestamp(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildCodingWindowClause(
	window: CodingAgentDiscoveryWindow | undefined
): string {
	const start = window?.timeStart;
	const end = window?.timeEnd;
	if (!start && !end) {
		return "Timestamp >= now() - INTERVAL 24 HOUR";
	}
	const clauses: string[] = [];
	if (start) {
		clauses.push(
			`Timestamp >= parseDateTimeBestEffort('${escapeTimestamp(start)}')`
		);
	}
	if (end) {
		clauses.push(
			`Timestamp <= parseDateTimeBestEffort('${escapeTimestamp(end)}')`
		);
	}
	if (clauses.length === 0) {
		// Caller passed an empty window — fall back to the 24h default
		// rather than dropping the time predicate entirely (which would
		// scan the whole table and silently inflate the rollup).
		return "Timestamp >= now() - INTERVAL 24 HOUR";
	}
	return clauses.join(" AND ");
}

/**
 * Live recompute of the hub-card Coding Agents rollup over an
 * arbitrary time window. Used by `listAgents` when the user's
 * top-right time filter is something other than the materializer's
 * fixed 24h. We deliberately call into the same query path as the
 * materializer (one row per vendor, `greatest(session.cost_usd,
 * sum(turn.cost))` per chat) so the hub numbers can never disagree
 * with the Sessions / Users / Dashboard tabs for the same window.
 */
export async function recomputeCodingAgentsForWindow(
	window: CodingAgentDiscoveryWindow,
	dbConfigId?: string
): Promise<DiscoveredAgent[]> {
	return discoverCodingAgents(dbConfigId, window);
}

async function discoverCodingAgents(
	dbConfigId?: string,
	window?: CodingAgentDiscoveryWindow
): Promise<DiscoveredAgent[]> {
	// Cost rollup notes:
	//   * `coding_agent.session.cost_usd` is only stamped on the
	//     session-root span at sessionEnd. Active / still-running
	//     sessions don't have it yet, so summing on it alone makes the
	//     hub show $0.00 even when LLM-turn spans show real cost.
	//   * `gen_ai.usage.cost` lives on per-turn LLM spans (Cursor
	//     estimates from text length × static pricing; Claude Code
	//     uses authoritative provider numbers).
	//
	// We sum both per session and `greatest()` them — exactly how the
	// per-session list does it — so an authoritative session-end total
	// wins when present and a turn-by-turn estimate keeps the row
	// non-zero in the meantime. Active-user rollup also moves to
	// `gen_ai.user.name` (which the CLI stamps as a resource attr) so
	// it stops returning 0 when the per-span `user.id` isn't set.
	// Materialize over CHAT_ID (= coalesce(parent_id, session_id)) so
	// the hub stats agree with the Sessions list:
	//   - 1 parent chat + N subagents = 1 session in both views
	//   - cost is summed across all spans of the chat (the parent's
	//     authoritative `coding_agent.session.cost_usd` still wins
	//     when present, via greatest())
	//   - active_users stores the *raw* distinct-user count. The
	//     COHORT_K_FLOOR mask used to live here, but it ran before
	//     auth context was even resolved, so a single-developer OSS
	//     install would always read 0. The hub already requires org
	//     membership; the deeper /coding-agents views apply the floor
	//     to per-user breakdowns where it's actually a privacy boundary.
	// Implementation note: the natural shape here is a nested rollup
	// (per_session → per_chat → per_vendor). We tried that — but
	// ClickHouse aggressively inlines subqueries, which made
	// `argMax(client_version, last_seen)` collapse to
	// `argMax(argMax(...), max(Timestamp))` and fail with
	// `ILLEGAL_AGGREGATION`. The same inlining bites WITH-style CTEs.
	// So we collapse to one pass: chat_id is a per-row expression
	// (coalesce of parent_id and session_id, both raw map lookups),
	// so we can GROUP BY (vendor, chat_id) directly. session-level
	// aggregation isn't needed because each (chat_id, session_id)
	// shares the same vendor, and cost is summed across all spans of
	// the chat anyway.
	// The chat_id rollup MUST mirror queries.ts CHAT_ID_EXPR so the hub
	// row counts agree with the Sessions list. New vendors should fold
	// into the per-row coalesce here, NOT introduce a second discovery
	// pass. Claude Code's native exporter sets `session.id` (plain,
	// without the `coding_agent.` prefix); we fall through to it so a
	// CLAUDE_CODE_ENABLE_TELEMETRY=1-only install (no openlit plugin)
	// still appears in the hub.
	// Per-span vendor expression: lets us GROUP BY (chat_id, vendor)
	// so a chat id legitimately hosting spans from two vendors (Claude
	// Code launched inside a Cursor terminal — both hooks fire under
	// the host's chat id) yields TWO hub rows, one per vendor. Without
	// this split the per-vendor user/cost counts inherit whichever
	// vendor's spans happened to dominate the chat id and the user
	// sees Cursor traffic counted against the Claude Code agent (or
	// vice versa). The expression must mirror queries.ts PER_SPAN_VENDOR_EXPR.
	const perSpanVendor = `
		coalesce(
			nullIf(SpanAttributes['coding_agent.client'], ''),
			nullIf(ResourceAttributes['gen_ai.agent.name'], ''),
			nullIf(ResourceAttributes['service.name'], '')
		)
	`;
	const query = `
		SELECT
			vendor,
			argMax(client_version, chat_last_seen) AS client_version,
			min(chat_first_seen) AS first_seen,
			max(chat_last_seen) AS last_seen,
			uniqExact(chat_id) AS session_count_24h,
			sum(chat_cost) AS cost_usd_24h,
			uniqExactIf(user_id, user_id != '') AS active_users_24h,
			sum(chat_lines_added) AS lines_added_24h,
			sum(chat_lines_removed) AS lines_removed_24h,
			sum(chat_lines_accepted) AS lines_accepted_24h,
			sum(chat_lines_rejected) AS lines_rejected_24h,
			sum(chat_edit_accept) AS edit_accept_24h,
			sum(chat_edit_reject) AS edit_reject_24h,
			sum(chat_commit_count) AS commit_count_24h,
			sum(chat_pr_count) AS pr_count_24h
		FROM (
			SELECT
				${perSpanVendor} AS vendor,
				coalesce(
					nullIf(ResourceAttributes['coding_agent.agent.parent_id'], ''),
					nullIf(SpanAttributes['coding_agent.agent.parent_id'], ''),
					nullIf(SpanAttributes['coding_agent.session.id'], ''),
					nullIf(ResourceAttributes['coding_agent.session.id'], ''),
					nullIf(SpanAttributes['session.id'], ''),
					nullIf(ResourceAttributes['session.id'], '')
				) AS chat_id,
				-- session-end cost wins when present, otherwise sum of
				-- per-turn cost estimates. Both are stamped on chat-level
				-- spans (root and per LLM turn).
				greatest(
					toFloat64OrZero(any(SpanAttributes['coding_agent.session.cost_usd'])),
					sumOrNull(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost']))
				) AS chat_cost,
				-- Per-chat code-change rollups. The greatest(session-
				-- rollup-attr, per-edit-decision-sum) pattern mirrors
				-- queries.ts (and the materializer's cost expression)
				-- so the hub agrees with the per-session list for
				-- both Codex (no SessionEnd) and in-flight CC / Cursor
				-- sessions.
				greatest(
					toInt64OrZero(any(SpanAttributes['coding_agent.session.lines.added'])),
					toInt64(sumIf(
						toInt64OrZero(SpanAttributes['coding_agent.edit.lines.added']),
						SpanName = 'coding_agent.edit.decision'
					))
				) AS chat_lines_added,
				greatest(
					toInt64OrZero(any(SpanAttributes['coding_agent.session.lines.removed'])),
					toInt64(sumIf(
						toInt64OrZero(SpanAttributes['coding_agent.edit.lines.removed']),
						SpanName = 'coding_agent.edit.decision'
					))
				) AS chat_lines_removed,
				greatest(
					toInt64OrZero(any(SpanAttributes['coding_agent.session.lines.accepted'])),
					toInt64(sumIf(
						toInt64OrZero(SpanAttributes['coding_agent.edit.lines.added']),
						SpanName = 'coding_agent.edit.decision'
							AND SpanAttributes['coding_agent.edit.decision'] IN ('accept', 'auto_accepted')
					))
				) AS chat_lines_accepted,
				greatest(
					toInt64OrZero(any(SpanAttributes['coding_agent.session.lines.rejected'])),
					toInt64(sumIf(
						toInt64OrZero(SpanAttributes['coding_agent.edit.lines.added']),
						SpanName = 'coding_agent.edit.decision'
							AND SpanAttributes['coding_agent.edit.decision'] = 'reject'
					))
				) AS chat_lines_rejected,
				greatest(
					toInt64OrZero(any(SpanAttributes['coding_agent.session.edit.accept_count'])),
					toInt64(countIf(
						SpanName = 'coding_agent.edit.decision'
							AND SpanAttributes['coding_agent.edit.decision'] IN ('accept', 'auto_accepted')
					))
				) AS chat_edit_accept,
				greatest(
					toInt64OrZero(any(SpanAttributes['coding_agent.session.edit.reject_count'])),
					toInt64(countIf(
						SpanName = 'coding_agent.edit.decision'
							AND SpanAttributes['coding_agent.edit.decision'] = 'reject'
					))
				) AS chat_edit_reject,
				greatest(
					toInt64OrZero(any(SpanAttributes['coding_agent.session.commit_count'])),
					toInt64(countIf(SpanName = 'coding_agent.git.commit'))
				) AS chat_commit_count,
				greatest(
					toInt64OrZero(any(SpanAttributes['coding_agent.session.pr_count'])),
					toInt64(countIf(SpanName = 'coding_agent.git.pull_request'))
				) AS chat_pr_count,
				coalesce(
					nullIf(any(SpanAttributes['gen_ai.user.name']), ''),
					nullIf(any(ResourceAttributes['gen_ai.user.name']), ''),
					nullIf(any(ResourceAttributes['user.email']), ''),
					nullIf(any(SpanAttributes['user.email']), ''),
					''
				) AS user_id,
				min(Timestamp) AS chat_first_seen,
				max(Timestamp) AS chat_last_seen,
				argMax(SpanAttributes['coding_agent.client.version'], Timestamp) AS client_version
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${buildCodingWindowClause(window)}
				AND (
					SpanAttributes['coding_agent.session.id'] != ''
					OR ResourceAttributes['coding_agent.session.id'] != ''
					-- Native Claude Code OTel: signed by service.name and
					-- a plain session.id attribute. Without this branch a
					-- CLAUDE_CODE_ENABLE_TELEMETRY=1-only install would
					-- never reach the hub.
					OR (
						ResourceAttributes['service.name'] = 'claude-code'
						AND (SpanAttributes['session.id'] != '' OR ResourceAttributes['session.id'] != '')
					)
				)
			GROUP BY chat_id, ${perSpanVendor}
			HAVING vendor != ''
		) per_chat
		GROUP BY vendor
		HAVING vendor != ''
	`;

	const res = await dataCollector({ query }, "query", dbConfigId);
	if (res.err) {
		agentsLogger.error("materializer_coding_discovery_failed", {
			err: res.err,
		});
		return [];
	}
	const rows = (res.data as Array<{
		vendor: string;
		client_version: string;
		first_seen: string;
		last_seen: string;
		session_count_24h: number;
		cost_usd_24h: number;
		active_users_24h: number;
		lines_added_24h: number;
		lines_removed_24h: number;
		lines_accepted_24h: number;
		lines_rejected_24h: number;
		edit_accept_24h: number;
		edit_reject_24h: number;
		commit_count_24h: number;
		pr_count_24h: number;
	}>) || [];

	return rows
		.filter((row) => row.vendor)
		.map((row) => {
			const vendor = row.vendor as CodingAgentVendor;
			const cluster = "coding";
			const env = "default";
			// Per-vendor stable agent key. The detail page derives the
			// vendor from `service_name` since cluster is fixed.
			const agentKey = computeAgentKey(cluster, env, vendor);
			return {
				agent_key: agentKey,
				service_name: vendor,
				environment: env,
				cluster_id: cluster,
				workload_key: "",
				source: "coding" as AgentSource,
				controller_service_id: "",
				controller_instance_id: "",
				sdk_version: row.client_version || "",
				sdk_language: "",
				first_seen: row.first_seen,
				last_seen: row.last_seen,
				instrumentation_status: "instrumented",
				controller_llm_providers: [],
				coding_agent_vendor: vendor,
				coding_session_count_24h: Number(row.session_count_24h || 0),
				coding_cost_usd_24h: Number(row.cost_usd_24h || 0),
				coding_active_users_24h: Number(row.active_users_24h || 0),
				coding_lines_added_24h: Number(row.lines_added_24h || 0),
				coding_lines_removed_24h: Number(row.lines_removed_24h || 0),
				coding_lines_accepted_24h: Number(row.lines_accepted_24h || 0),
				coding_lines_rejected_24h: Number(row.lines_rejected_24h || 0),
				coding_edit_accept_24h: Number(row.edit_accept_24h || 0),
				coding_edit_reject_24h: Number(row.edit_reject_24h || 0),
				coding_commit_count_24h: Number(row.commit_count_24h || 0),
				coding_pr_count_24h: Number(row.pr_count_24h || 0),
			};
		});
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

	// Split coding agents from the rest. Their request_count is the
	// total number of spans observed under the vendor in the last 24h
	// (rolled up at discovery time as `session_count_24h`); the
	// classic per-service ServiceName query won't match because coding
	// agent spans come in under whatever service_name the host
	// pipeline reports, not the vendor identifier.
	const map = new Map<string, number>();
	const traditional = agents.filter((a) => a.source !== "coding");
	for (const coding of agents.filter((a) => a.source === "coding")) {
		map.set(coding.agent_key, coding.coding_session_count_24h || 0);
	}
	if (!traditional.length) return map;

	const serviceNames = Array.from(new Set(traditional.map((a) => a.service_name)));
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
		return map;
	}
	const rows = (res.data as Array<{
		service_name: string;
		environment: string;
		cluster_id: string;
		request_count_24h: number;
	}>) || [];
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
	// Populated only on coding-agent rows. Kept inline (not a separate
	// table) so the existing SELECTs already get them for free.
	coding_agent_vendor: string;
	coding_session_count_24h: number;
	coding_cost_usd_24h: number;
	coding_active_users_24h: number;
	coding_lines_added_24h: number;
	coding_lines_removed_24h: number;
	coding_lines_accepted_24h: number;
	coding_lines_rejected_24h: number;
	coding_edit_accept_24h: number;
	coding_edit_reject_24h: number;
	coding_commit_count_24h: number;
	coding_pr_count_24h: number;
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
		// Look for the agent in BOTH discovery pipelines, not just the SDK
		// one. The detail page's "Refresh" button calls
		// /api/agents/[agentKey]/refresh which passes the saved scope of
		// the agent it was viewing — for a coding agent that's
		// (service=cursor, cluster=coding). Only checking discoverAgents
		// here meant the SDK pipeline would (correctly) report no match,
		// the code would fall through to the SDK placeholder branch below,
		// and we'd insert a phantom `source='sdk'` row into
		// openlit_agents_summary that overwrites the legitimate
		// `source='coding'` row on the next FINAL read. The UI then
		// renders the SDK Overview/Dashboard/Monitoring layout for what
		// is in fact a coding agent. See coding-agents-hook.mdc §10.
		const [sdkAll, codingAll] = await Promise.all([
			discoverAgents(dbConfigId, scope.clusterId),
			discoverCodingAgents(dbConfigId),
		]);
		const match =
			sdkAll.find((a) => a.agent_key === key) ||
			codingAll.find((a) => a.agent_key === key);
		if (match) {
			discovered = [match];
		} else {
			// Refuse to manufacture a placeholder. The historical intent
			// was "still derive a snapshot when a forced materialize
			// arrives before any spans" — but in practice the API only
			// reaches this branch for refresh calls on agents that
			// already exist, and the placeholder's `source='sdk'`
			// silently clobbered legitimate coding rows. If a refresh
			// hits before any spans arrive, the caller will simply see
			// an unchanged snapshot until the next cron tick discovers
			// the spans — which is what the operator expects.
			discovered = [];
		}
	} else if (agentKeyFilter) {
		const all = await discoverAgents(dbConfigId);
		const codingAll = await discoverCodingAgents(dbConfigId);
		const match =
			all.find((a) => a.agent_key === agentKeyFilter) ||
			codingAll.find((a) => a.agent_key === agentKeyFilter);
		discovered = match ? [match] : [];
	} else {
		const [traditional, coding] = await Promise.all([
			discoverAgents(dbConfigId),
			discoverCodingAgents(dbConfigId),
		]);
		discovered = [...traditional, ...coding];
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
			// Coding agents don't have a versioned system prompt
			// (their "version" is the vendor's CLI version) so we
			// skip snapshot derivation entirely. Saves one round-trip
			// per coding row per tick and avoids polluting
			// agent_versions with rows that have no system_prompt.
			const snapshot = agent.source === "coding"
				? null
				: await deriveSnapshot({
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
			// window did not yet contain a request.
			//
			// mergeProviders canonicalizes names across the two vocabularies
			// (controller short names vs OTel semconv names, e.g. "gemini" vs
			// "gcp.gemini") so the same provider doesn't appear twice with only
			// one matching a logo.
			providers = mergeProviders(providers, agent.controller_llm_providers);

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
				coding_agent_vendor: agent.coding_agent_vendor || "",
				coding_session_count_24h: agent.coding_session_count_24h || 0,
				coding_cost_usd_24h: agent.coding_cost_usd_24h || 0,
				coding_active_users_24h: agent.coding_active_users_24h || 0,
				coding_lines_added_24h: agent.coding_lines_added_24h || 0,
				coding_lines_removed_24h: agent.coding_lines_removed_24h || 0,
				coding_lines_accepted_24h: agent.coding_lines_accepted_24h || 0,
				coding_lines_rejected_24h: agent.coding_lines_rejected_24h || 0,
				coding_edit_accept_24h: agent.coding_edit_accept_24h || 0,
				coding_edit_reject_24h: agent.coding_edit_reject_24h || 0,
				coding_commit_count_24h: agent.coding_commit_count_24h || 0,
				coding_pr_count_24h: agent.coding_pr_count_24h || 0,
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
		// Safety net for the SDK-clobbers-coding bug. Before we INSERT,
		// check whether any of the rows we are about to write would
		// overwrite an existing `source='coding'` row with a non-coding
		// source under the same agent_key. The ReplacingMergeTree dedup
		// is by agent_key alone, so a stray `source='sdk'` write wins on
		// the next FINAL read and the detail page flips layout. If we
		// detect this, drop the offending rows and log loudly — the
		// upstream code path is the bug, but we refuse to corrupt state
		// regardless. See coding-agents-hook.mdc §10 for the structural
		// fix chain.
		const nonCodingKeys = summaryRows
			.filter((r) => r.source !== "coding")
			.map((r) => r.agent_key);
		if (nonCodingKeys.length > 0) {
			const escaped = nonCodingKeys
				.map((k) => `'${k.replace(/'/g, "''")}'`)
				.join(", ");
			const conflictRes = await dataCollector(
				{
					query: `
						SELECT agent_key
						FROM ${AGENTS_SUMMARY_TABLE} FINAL
						WHERE agent_key IN (${escaped}) AND source = 'coding'
					`,
				},
				"query",
				dbConfigId
			);
			if (!conflictRes.err && Array.isArray(conflictRes.data)) {
				const codingKeys = new Set(
					(conflictRes.data as Array<{ agent_key: string }>).map(
						(r) => r.agent_key
					)
				);
				if (codingKeys.size > 0) {
					const before = summaryRows.length;
					const filtered = summaryRows.filter(
						(r) => r.source === "coding" || !codingKeys.has(r.agent_key)
					);
					if (filtered.length !== before) {
						agentsLogger.error("materializer_blocked_coding_clobber", {
							droppedRowCount: before - filtered.length,
							agentKeys: Array.from(codingKeys),
						});
						summaryRows.length = 0;
						summaryRows.push(...filtered);
					}
				}
			}
		}

		if (!summaryRows.length) {
			return { processed, newVersions, errors };
		}

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
