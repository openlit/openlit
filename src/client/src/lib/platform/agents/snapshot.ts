/**
 * Snapshot derivation + fingerprinting + version upserts.
 *
 * This module is the only writer of `openlit_agent_versions`. It pulls the
 * latest agent definition from a small, bounded slice of `otel_traces` and
 * persists it as a new version row when the fingerprint changes (or refreshes
 * the existing row's last_seen / request_count otherwise).
 */

import { createHash } from "crypto";
import { agentsLogger } from "./logger";

/**
 * Format a Date/string/number as `YYYY-MM-DD HH:mm:ss` for ClickHouse DateTime
 * columns. The agents tables use second precision, so values with milliseconds
 * (e.g. `2026-05-11 18:43:53.937`) cause the JSONEachRow parser to reject the
 * row with "Cannot parse input".
 */
function toAgentTimestamp(value: string | Date | number | undefined): string {
	if (typeof value === "string") {
		// ClickHouse DateTime/DateTime64 strings come back as
		// `YYYY-MM-DD HH:mm:ss[.SSS]`. Strip ms (DateTime columns reject them)
		// without round-tripping through `new Date()` -- that would treat the
		// space-separated string as local time on some Node builds and shift
		// the value by the host TZ offset.
		const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
		if (m) return `${m[1]} ${m[2]}`;
	}
	const d = value ? new Date(value) : new Date();
	const valid = !Number.isNaN(d.getTime()) ? d : new Date();
	return valid.toISOString().slice(0, 19).replace("T", " ");
}
import {
	dataCollector,
	OTEL_LOGS_TABLE_NAME,
	OTEL_TRACES_TABLE_NAME,
} from "@/lib/platform/common";
import type {
	AgentRuntimeConfig,
	AgentSnapshot,
	AgentTool,
	AgentVersion,
} from "@/types/agents";
import { computeAgentKey } from "./index";
import { AGENT_VERSIONS_TABLE } from "./table-details";
import { escapeClickHouseString } from "@/lib/clickhouse-escape";
import { mergeProviders } from "./provider-normalize";

const escape = escapeClickHouseString;

function normalizeWhitespace(s: string): string {
	return (s || "").replace(/\s+/g, " ").trim();
}

function canonicalJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (value && typeof value === "object") {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			sorted[key] = canonicalJson((value as Record<string, unknown>)[key]);
		}
		return sorted;
	}
	return value;
}

function roundTo3(value: number | undefined | null): number | null {
	if (value === undefined || value === null || Number.isNaN(value)) return null;
	return Math.round(value * 1000) / 1000;
}

function safeJsonParse<T>(value: string, fallback: T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

/** Normalize a tool definition into the canonical AgentTool shape. */
function normalizeTool(raw: unknown): AgentTool | null {
	if (!raw || typeof raw !== "object") return null;
	const rec = raw as Record<string, unknown>;
	// Common OTel + provider shapes:
	//  - {name, description, parameters}            (OpenAI legacy)
	//  - {type: "function", function: {...}}        (OpenAI tools list)
	//  - {name, description, input_schema}          (Anthropic)
	if (rec.type === "function" && rec.function && typeof rec.function === "object") {
		const fn = rec.function as Record<string, unknown>;
		const schema = (fn.parameters ?? fn.input_schema ?? null) as unknown;
		return {
			name: String(fn.name ?? ""),
			description: String(fn.description ?? ""),
			schema,
		};
	}
	const schema = (rec.parameters ?? rec.input_schema ?? rec.schema ?? null) as unknown;
	const name = String(rec.name ?? "");
	if (!name) return null;
	return {
		name,
		description: String(rec.description ?? ""),
		schema,
	};
}

function parseToolDefinitions(json: string): AgentTool[] {
	const parsed = safeJsonParse<unknown>(json, []);
	const list = Array.isArray(parsed) ? parsed : [parsed];
	return list
		.map((entry) => normalizeTool(entry))
		.filter((t): t is AgentTool => t !== null);
}

/**
 * Compute a stable fingerprint over the parts of an agent's definition we
 * version on: system prompt + tools (name + canonical schema) + primary model
 * + rounded runtime sampling config.
 */
export function fingerprint(args: {
	systemPrompt: string;
	tools: AgentTool[];
	primaryModel: string;
	runtimeConfig: AgentRuntimeConfig;
	providers: string[];
}): string {
	const tools = args.tools
		.map((t) => ({ n: t.name, s: canonicalJson(t.schema ?? null) }))
		// Byte-order (codepoint) sort to match the Python and TypeScript SDKs'
		// fingerprint helpers. Using `localeCompare` here would make the
		// server-computed fingerprint diverge from the SDK-stamped
		// `openlit.agent.version_hash` for non-ASCII tool names, silently
		// creating phantom version churn.
		.sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
	const providersSorted = [...(args.providers || [])].filter(Boolean).sort();
	const payload = canonicalJson({
		sp: normalizeWhitespace(args.systemPrompt || ""),
		tools,
		model: args.primaryModel || "",
		cfg: {
			temperature: roundTo3(args.runtimeConfig.temperature ?? null),
			top_p: roundTo3(args.runtimeConfig.top_p ?? null),
			max_tokens:
				args.runtimeConfig.max_tokens === undefined ||
				args.runtimeConfig.max_tokens === null
					? null
					: Math.trunc(args.runtimeConfig.max_tokens),
			provider:
				args.runtimeConfig.provider || providersSorted[0] || "",
		},
	});
	return createHash("sha1")
		.update(JSON.stringify(payload))
		.digest("hex")
		.slice(0, 16);
}

export interface DeriveSnapshotParams {
	serviceName: string;
	environment?: string;
	clusterId?: string;
	lookbackMinutes?: number;
	dbConfigId?: string;
}

interface SnapshotRow {
	system_prompt: string;
	tool_definitions_json: string;
	tools_fallback: Array<[string, string, string]>;
	primary_model: string;
	models: string[];
	providers: string[];
	temperature: number | null;
	top_p: number | null;
	max_tokens: number | null;
	request_count: number;
	first_seen: string;
	last_seen: string;
}

const DEFAULT_LOOKBACK_MINUTES = 60;

/**
 * Pull the latest `gen_ai.tool.definitions` payload from `otel_logs` for a
 * single service within the lookback window.
 *
 * The OpenLIT Python SDK emits the OTel inference event (a LogRecord) for
 * every provider chat call (OpenAI, Anthropic, Bedrock, Cohere, Ollama,
 * LiteLLM, Azure AI Inference, Google AI Studio, Gradient, LangChain, …) and
 * the event carries the full tool definitions JSON (including parameter
 * schemas). The OTel GenAI semconv explicitly permits recording
 * `gen_ai.tool.definitions` on either the span OR the inference event:
 * https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/
 *
 * We only consult this when the trace-side span attribute aggregation
 * returned nothing, so the materializer stays at one ClickHouse roundtrip
 * per agent for the common (agent-framework) case.
 */
async function fetchToolDefinitionsFromLogs(
	serviceName: string,
	lookbackMinutes: number,
	dbConfigId?: string
): Promise<AgentTool[]> {
	const query = `
		SELECT argMaxIf(
			LogAttributes['gen_ai.tool.definitions'],
			Timestamp,
			LogAttributes['gen_ai.tool.definitions'] != ''
		) AS tool_definitions_json
		FROM ${OTEL_LOGS_TABLE_NAME}
		WHERE ServiceName = '${escape(serviceName)}'
			AND Timestamp >= now() - INTERVAL ${lookbackMinutes} MINUTE
			AND ScopeName LIKE 'openlit.instrumentation.%'
	`;
	const res = await dataCollector({ query }, "query", dbConfigId);
	if (res.err) {
		agentsLogger.error("fetch_tool_definitions_failed", {
			err: res.err,
			serviceName,
			lookbackMinutes,
		});
		return [];
	}
	const rows = (res.data as Array<{ tool_definitions_json: string }>) || [];
	if (!rows.length) return [];
	return parseToolDefinitions(rows[0].tool_definitions_json || "");
}

/**
 * Pull the latest snapshot from otel_traces for a single service.
 *
 * Scoped to ServiceName (cheap; indexed column) and a short window so the
 * scan stays bounded regardless of total trace volume. Returns null if no
 * GenAI spans exist in the window.
 */
export async function deriveSnapshot(
	params: DeriveSnapshotParams
): Promise<AgentSnapshot | null> {
	const lookback = Math.max(
		1,
		Math.min(params.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES, 60 * 24)
	);
	const env = params.environment || "default";
	const cluster = params.clusterId || "default";

	const query = `
		SELECT
			argMaxIf(SpanAttributes['gen_ai.system_instructions'], Timestamp, SpanAttributes['gen_ai.system_instructions'] != '') AS system_prompt,
			argMaxIf(SpanAttributes['gen_ai.tool.definitions'], Timestamp, SpanAttributes['gen_ai.tool.definitions'] != '') AS tool_definitions_json,
			arrayDistinct(arrayFilter(t -> t.1 != '',
				groupArray((
					SpanAttributes['gen_ai.tool.name'],
					SpanAttributes['gen_ai.tool.description'],
					SpanAttributes['gen_ai.tool.type']
				))
			)) AS tools_fallback,
			argMaxIf(SpanAttributes['gen_ai.request.model'], Timestamp, SpanAttributes['gen_ai.request.model'] != '') AS primary_model,
			arrayDistinct(arrayFilter(m -> m != '', groupArray(SpanAttributes['gen_ai.request.model']))) AS models,
			-- OTel GenAI conventions renamed gen_ai.system -> gen_ai.provider.name
			-- in 1.30. The openlit SDK emits the new key, OBI / legacy spans
			-- still emit the old one. Coalesce so the providers chip is
			-- populated from either attribute and old + new spans on the same
			-- agent do not split into duplicate provider entries.
			arrayDistinct(arrayFilter(p -> p != '', groupArray(
				if(SpanAttributes['gen_ai.provider.name'] != '',
				   SpanAttributes['gen_ai.provider.name'],
				   SpanAttributes['gen_ai.system'])
			))) AS providers,
			toNullable(argMaxIf(toFloat64OrNull(SpanAttributes['gen_ai.request.temperature']), Timestamp, SpanAttributes['gen_ai.request.temperature'] != '')) AS temperature,
			toNullable(argMaxIf(toFloat64OrNull(SpanAttributes['gen_ai.request.top_p']), Timestamp, SpanAttributes['gen_ai.request.top_p'] != '')) AS top_p,
			toNullable(argMaxIf(toInt64OrNull(SpanAttributes['gen_ai.request.max_tokens']), Timestamp, SpanAttributes['gen_ai.request.max_tokens'] != '')) AS max_tokens,
			count() AS request_count,
			min(Timestamp) AS first_seen,
			max(Timestamp) AS last_seen
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ServiceName = '${escape(params.serviceName)}'
			AND Timestamp >= now() - INTERVAL ${lookback} MINUTE
			AND (
				SpanAttributes['gen_ai.system'] != ''
				OR SpanAttributes['gen_ai.provider.name'] != ''
				OR SpanAttributes['gen_ai.system_instructions'] != ''
				OR SpanAttributes['gen_ai.tool.name'] != ''
				OR SpanAttributes['gen_ai.request.model'] != ''
			)
		FORMAT JSON
	`;

	const res = await dataCollector(
		{ query: query.replace(/\s+FORMAT\s+JSON\s*$/i, "") },
		"query",
		params.dbConfigId
	);
	if (res.err) {
		agentsLogger.error("derive_snapshot_failed", {
			err: res.err,
			serviceName: params.serviceName,
			environment: params.environment,
		});
		return null;
	}
	const rows = (res.data as SnapshotRow[]) || [];
	// ClickHouse serializes UInt64 (count()) as a JSON *string* — e.g. "0" —
	// which is truthy in JS, so `!rows[0].request_count` would silently let the
	// zero-row case through and stamp an empty-fingerprint version on every
	// cron tick. Coerce explicitly.
	if (!rows.length || Number(rows[0].request_count || 0) <= 0) return null;
	const row = rows[0];

	// Tier order for tool definitions, in priority:
	//   1. trace SpanAttributes['gen_ai.tool.definitions']
	//      Set by agent-framework instrumentations (LangChain, CrewAI, Agno,
	//      openai_agents, smolagents, google_adk, agent_framework, …) on the
	//      agent span. Richest, agent-designed view.
	//   2. otel_logs LogAttributes['gen_ai.tool.definitions']
	//      Provider chat instrumentations (OpenAI, Anthropic, Bedrock, …) emit
	//      this on the OTel inference event (LogRecord), not the chat span —
	//      per OTel GenAI semconv, either surface is compliant.
	//   3. trace per-tool aggregation (tools_fallback) — names + descriptions
	//      only, no schema. Last-ditch.
	let tools = parseToolDefinitions(row.tool_definitions_json || "");
	if (!tools.length) {
		const logTools = await fetchToolDefinitionsFromLogs(
			params.serviceName,
			lookback,
			params.dbConfigId
		);
		if (logTools.length) {
			tools = logTools;
		}
	}
	if (!tools.length && Array.isArray(row.tools_fallback)) {
		tools = row.tools_fallback
			.filter((t) => Array.isArray(t) && t[0])
			.map(([name, description]) => ({
				name: String(name),
				description: String(description || ""),
				schema: null,
			}));
	}

	const runtimeConfig: AgentRuntimeConfig = {};
	if (row.temperature !== null && row.temperature !== undefined) runtimeConfig.temperature = Number(row.temperature);
	if (row.top_p !== null && row.top_p !== undefined) runtimeConfig.top_p = Number(row.top_p);
	if (row.max_tokens !== null && row.max_tokens !== undefined) runtimeConfig.max_tokens = Number(row.max_tokens);
	// Canonicalize provider names (OTel semconv "gcp.gemini" -> short "gemini")
	// so the stored version + fingerprint + provider chips are consistent with
	// the controller's vocabulary and don't double-count one provider.
	const providers = mergeProviders((row.providers as string[]) || []);
	if (providers.length) runtimeConfig.provider = providers.slice().sort()[0];

	const hash = fingerprint({
		systemPrompt: row.system_prompt || "",
		tools,
		primaryModel: row.primary_model || "",
		runtimeConfig,
		providers,
	});

	return {
		agent_key: computeAgentKey(cluster, env, params.serviceName),
		service_name: params.serviceName,
		environment: env,
		cluster_id: cluster,
		system_prompt: row.system_prompt || "",
		tools,
		primary_model: row.primary_model || "",
		models: (row.models || []).filter(Boolean),
		providers,
		runtime_config: runtimeConfig,
		request_count: Number(row.request_count || 0),
		first_seen: String(row.first_seen),
		last_seen: String(row.last_seen),
		version_hash: hash,
	};
}

/**
 * Insert a row into `openlit_agent_versions`. Idempotent on
 * (agent_key, version_hash).
 *
 * Computes `version_number`, `first_seen` and the aggregated `request_count`
 * inside ClickHouse in a single statement so two writers racing on the same
 * `agent_key` cannot both pick the same `max(version_number) + 1`. We still
 * need a final SELECT to learn the chosen version_number / isNewVersion for
 * the caller — that SELECT runs after the INSERT, so it reads what was just
 * written.
 *
 * Combined with the distributed lease in `POST /api/agents/materialize` this
 * is overkill for the common single-writer case, but it makes the table
 * resilient to operator mistakes (manual scripts, retries, multi-replica
 * cron) without relying on lock semantics.
 */
export async function upsertVersion(
	snapshot: AgentSnapshot,
	dbConfigId?: string
): Promise<{ versionNumber: number; isNewVersion: boolean }> {
	const ak = escape(snapshot.agent_key);
	const vh = escape(snapshot.version_hash);
	const systemPrompt = escape(snapshot.system_prompt || "");
	const toolsJson = escape(JSON.stringify(snapshot.tools));
	const primaryModel = escape(snapshot.primary_model || "");
	const models = (snapshot.models || []).map((m) => `'${escape(m)}'`).join(",");
	const providers = (snapshot.providers || [])
		.map((p) => `'${escape(p)}'`)
		.join(",");
	const runtimeConfig = escape(JSON.stringify(snapshot.runtime_config));
	const firstSeen = toAgentTimestamp(snapshot.first_seen);
	const lastSeen = toAgentTimestamp(snapshot.last_seen);
	const incRequests = Number(snapshot.request_count || 0);
	const updatedAt = toAgentTimestamp(new Date());

	// SELECT-based row builder. `latest` is the most recent FINAL row for the
	// agent (or empty). The CASE branches decide whether we're continuing an
	// existing version (hash match) or starting a new one.
	const insertQuery = `
		INSERT INTO ${AGENT_VERSIONS_TABLE}
		(agent_key, version_hash, version_number, system_prompt, tools,
		 primary_model, models, providers, runtime_config, first_seen,
		 last_seen, request_count, updated_at)
		SELECT
			'${ak}' AS agent_key,
			'${vh}' AS version_hash,
			multiIf(
				_existing_hash = '${vh}', _existing_number,
				_existing_number > 0, _existing_number + 1,
				1
			) AS version_number,
			'${systemPrompt}' AS system_prompt,
			'${toolsJson}' AS tools,
			'${primaryModel}' AS primary_model,
			[${models}] AS models,
			[${providers}] AS providers,
			'${runtimeConfig}' AS runtime_config,
			if(_existing_hash = '${vh}', _existing_first_seen,
				parseDateTimeBestEffort('${firstSeen}')) AS first_seen,
			parseDateTimeBestEffort('${lastSeen}') AS last_seen,
			if(_existing_hash = '${vh}',
				_existing_request_count + ${incRequests},
				${incRequests}) AS request_count,
			parseDateTimeBestEffort('${updatedAt}') AS updated_at
		FROM (
			SELECT
				argMax(version_hash, version_number) AS _existing_hash,
				max(version_number) AS _existing_number,
				argMaxIf(first_seen, version_number,
					version_hash = '${vh}') AS _existing_first_seen,
				argMaxIf(request_count, version_number,
					version_hash = '${vh}') AS _existing_request_count
			FROM ${AGENT_VERSIONS_TABLE} FINAL
			WHERE agent_key = '${ak}'
		)
	`;

	const insertRes = await dataCollector(
		{ query: insertQuery },
		"exec",
		dbConfigId
	);
	if (insertRes.err) {
		agentsLogger.error("atomic_version_insert_failed", {
			err: insertRes.err,
			agentKey: snapshot.agent_key,
			versionHash: snapshot.version_hash,
		});
		throw insertRes.err;
	}

	// Re-read to inform the caller what was written.
	const readQuery = `
		SELECT
			version_number,
			version_hash,
			request_count
		FROM ${AGENT_VERSIONS_TABLE} FINAL
		WHERE agent_key = '${ak}' AND version_hash = '${vh}'
		LIMIT 1
	`;
	const readRes = await dataCollector(
		{ query: readQuery },
		"query",
		dbConfigId
	);
	const readRows =
		((readRes.data as Array<{
			version_number: number;
			version_hash: string;
			request_count: number;
		}>) || []);
	const written = readRows[0];
	if (!written) {
		// Fallback: report 1 / new — defensive only, INSERT...SELECT above is
		// expected to always produce a row.
		return { versionNumber: 1, isNewVersion: true };
	}

	// We rely on a second small query rather than parsing INSERT...SELECT
	// return data (clickhouse-client `exec` doesn't surface row counts in a
	// stable shape). To know whether the row is genuinely new vs. a request
	// count increment, compare request_count against the snapshot's
	// contribution: if the value is exactly `incRequests`, the hash was new.
	const isNewVersion = Number(written.request_count) === incRequests;
	return { versionNumber: Number(written.version_number), isNewVersion };
}

/** Map a raw row from openlit_agent_versions to the AgentVersion DTO. */
function rowToVersion(row: Record<string, unknown>): AgentVersion {
	return {
		agent_key: String(row.agent_key),
		version_hash: String(row.version_hash),
		version_number: Number(row.version_number),
		system_prompt: String(row.system_prompt || ""),
		tools: safeJsonParse<AgentTool[]>(String(row.tools || "[]"), []),
		primary_model: String(row.primary_model || ""),
		models: Array.isArray(row.models) ? (row.models as string[]) : [],
		providers: Array.isArray(row.providers) ? (row.providers as string[]) : [],
		runtime_config: safeJsonParse<AgentRuntimeConfig>(
			String(row.runtime_config || "{}"),
			{}
		),
		first_seen: String(row.first_seen),
		last_seen: String(row.last_seen),
		request_count: Number(row.request_count || 0),
		updated_at: String(row.updated_at),
	};
}

const VERSION_SELECT_COLUMNS = `
	agent_key,
	version_hash,
	version_number,
	system_prompt,
	tools,
	primary_model,
	models,
	providers,
	runtime_config,
	first_seen,
	last_seen,
	request_count,
	updated_at
`;

export async function getVersions(
	agentKey: string,
	limit = 50,
	dbConfigId?: string
): Promise<AgentVersion[]> {
	const query = `
		SELECT ${VERSION_SELECT_COLUMNS}
		FROM ${AGENT_VERSIONS_TABLE} FINAL
		WHERE agent_key = '${escape(agentKey)}'
		ORDER BY version_number DESC
		LIMIT ${Math.max(1, Math.min(limit, 200))}
	`;
	const res = await dataCollector({ query }, "query", dbConfigId);
	if (res.err) {
		agentsLogger.error("get_versions_failed", {
			err: res.err,
			agentKey,
		});
		return [];
	}
	return ((res.data as Record<string, unknown>[]) || []).map(rowToVersion);
}

export async function getVersion(
	agentKey: string,
	versionHash: string,
	dbConfigId?: string
): Promise<AgentVersion | null> {
	const query = `
		SELECT ${VERSION_SELECT_COLUMNS}
		FROM ${AGENT_VERSIONS_TABLE} FINAL
		WHERE agent_key = '${escape(agentKey)}'
			AND version_hash = '${escape(versionHash)}'
		LIMIT 1
	`;
	const res = await dataCollector({ query }, "query", dbConfigId);
	if (res.err) {
		agentsLogger.error("get_version_failed", {
			err: res.err,
			agentKey,
			versionHash,
		});
		return null;
	}
	const rows = (res.data as Record<string, unknown>[]) || [];
	if (!rows.length) return null;
	return rowToVersion(rows[0]);
}

export interface VersionTimelineBucket {
	ts: string;
	versionHash: string;
	requests: number;
}

export interface VersionTimeline {
	bucketSeconds: number;
	start: string;
	end: string;
	buckets: VersionTimelineBucket[];
}

const BUCKET_PRESETS: Record<string, number> = {
	"5m": 5 * 60,
	"15m": 15 * 60,
	"30m": 30 * 60,
	"1h": 60 * 60,
	"6h": 6 * 60 * 60,
	"1d": 24 * 60 * 60,
};

/**
 * Per-bucket request counts grouped by version. Hybrid attribution:
 *  - Spans carrying `openlit.agent.version_hash` go directly to that version.
 *  - Spans without the attribute are attributed (in TS, post-query) to the
 *    most recent version whose [first_seen, last_seen] window contains the
 *    bucket midpoint. This keeps history-versions chart correctly even when
 *    older SDK versions emitted no hash.
 *
 * Inputs:
 *  - `windowHours`: lookback window, default 168h (7d).
 *  - `bucketSeconds`: bucket granularity in seconds; defaults to 1h.
 */
export async function getVersionTimeline(
	agentKey: string,
	options: { bucketSeconds?: number; windowHours?: number; dbConfigId?: string } = {}
): Promise<VersionTimeline> {
	const bucketSeconds = Math.max(60, options.bucketSeconds || 60 * 60);
	const windowHours = Math.max(1, options.windowHours || 24 * 7);

	const [agentRow] = await (async () => {
		const q = `
			SELECT service_name, environment, cluster_id
			FROM openlit_agents_summary FINAL
			WHERE agent_key = '${escape(agentKey)}'
			LIMIT 1
		`;
		const r = await dataCollector({ query: q }, "query", options.dbConfigId);
		return (r.data as Array<{
			service_name: string;
			environment: string;
			cluster_id: string;
		}>) || [];
	})();
	if (!agentRow || !agentRow.service_name) {
		return {
			bucketSeconds,
			start: "",
			end: "",
			buckets: [],
		};
	}

	const versions = await getVersions(agentKey, 200, options.dbConfigId);
	const orderedVersions = [...versions].sort(
		(a, b) => a.version_number - b.version_number
	);

	const env = agentRow.environment || "default";
	const envPredicate =
		env === "default"
			? `(ResourceAttributes['deployment.environment'] = 'default' OR ResourceAttributes['deployment.environment'] = '')`
			: `ResourceAttributes['deployment.environment'] = '${escape(env)}'`;

	// Count every span tied to the agent's ServiceName, not just LLM
	// chat-completions. Agent-framework workloads (CrewAI, LangGraph,
	// LangChain orchestration, etc.) emit task/crew/tool spans without
	// `gen_ai.operation.name = 'chat'`, so a chat-only filter renders the
	// timeline empty even when there is real traffic. Aligning the WHERE
	// clause with `fetchRequestCounts` in materialize.ts keeps the bar
	// chart consistent with the REQUESTS (24H) stat above it.
	const query = `
		SELECT
			toStartOfInterval(Timestamp, INTERVAL ${bucketSeconds} SECOND) AS bucket,
			SpanAttributes['openlit.agent.version_hash'] AS direct_hash,
			count() AS requests
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE Timestamp >= now() - INTERVAL ${windowHours} HOUR
			AND ServiceName = '${escape(agentRow.service_name)}'
			AND ${envPredicate}
		GROUP BY bucket, direct_hash
		ORDER BY bucket ASC
	`;

	const res = await dataCollector({ query }, "query", options.dbConfigId);
	if (res.err) {
		agentsLogger.error("version_timeline_failed", {
			err: res.err,
			agentKey,
			windowHours,
			bucketSeconds,
		});
		return {
			bucketSeconds,
			start: "",
			end: "",
			buckets: [],
		};
	}

	const rows = (res.data as Array<{
		bucket: string;
		direct_hash: string;
		requests: number;
	}>) || [];

	const lookupFallbackHash = (bucketTimestamp: string): string => {
		if (!orderedVersions.length) return "";
		const t = new Date(bucketTimestamp).getTime();
		if (Number.isNaN(t)) return "";
		// Pick the highest-numbered version whose first_seen <= bucket.
		let candidate = orderedVersions[0];
		for (const v of orderedVersions) {
			const firstSeenMs = new Date(v.first_seen).getTime();
			if (!Number.isNaN(firstSeenMs) && firstSeenMs <= t) {
				candidate = v;
			} else {
				break;
			}
		}
		return candidate?.version_hash || "";
	};

	// Aggregate (bucket, attributed-version) -> requests in a map so the
	// stamped + fallback rows for the same bucket/version coalesce.
	const totals = new Map<string, VersionTimelineBucket>();
	let minBucket: string | undefined;
	let maxBucket: string | undefined;
	for (const row of rows) {
		const ts = String(row.bucket);
		if (!minBucket || ts < minBucket) minBucket = ts;
		if (!maxBucket || ts > maxBucket) maxBucket = ts;
		const versionHash = row.direct_hash || lookupFallbackHash(ts);
		const key = `${ts}|${versionHash}`;
		const existing = totals.get(key);
		const requests = Number(row.requests || 0);
		if (existing) {
			existing.requests += requests;
		} else {
			totals.set(key, { ts, versionHash, requests });
		}
	}

	const buckets = Array.from(totals.values()).sort((a, b) =>
		a.ts === b.ts ? a.versionHash.localeCompare(b.versionHash) : a.ts < b.ts ? -1 : 1
	);

	return {
		bucketSeconds,
		start: minBucket || "",
		end: maxBucket || "",
		buckets,
	};
}

export const _bucketPresets = BUCKET_PRESETS;

export async function getLatestVersion(
	agentKey: string,
	dbConfigId?: string
): Promise<AgentVersion | null> {
	const query = `
		SELECT ${VERSION_SELECT_COLUMNS}
		FROM ${AGENT_VERSIONS_TABLE} FINAL
		WHERE agent_key = '${escape(agentKey)}'
		ORDER BY version_number DESC
		LIMIT 1
	`;
	const res = await dataCollector({ query }, "query", dbConfigId);
	if (res.err) {
		agentsLogger.error("get_latest_version_failed", {
			err: res.err,
			agentKey,
		});
		return null;
	}
	const rows = (res.data as Record<string, unknown>[]) || [];
	if (!rows.length) return null;
	return rowToVersion(rows[0]);
}

/**
 * Batch counterpart to `getLatestVersion`. Returns a map of
 * `agent_key -> AgentVersion` containing only the keys that have at least
 * one row in `openlit_agent_versions`. Uses a single query with
 * `argMax(..., version_number)` to pull the latest row per agent.
 *
 * The materializer calls this once per tick to amortize a per-agent
 * round-trip over N agents.
 */
export async function getLatestVersionsBatch(
	agentKeys: string[],
	dbConfigId?: string
): Promise<Map<string, AgentVersion>> {
	if (!agentKeys.length) return new Map();
	const escaped = agentKeys.map((k) => `'${escape(k)}'`).join(",");
	const query = `
		WITH latest AS (
			SELECT
				agent_key,
				max(version_number) AS version_number
			FROM ${AGENT_VERSIONS_TABLE} FINAL
			WHERE agent_key IN (${escaped})
			GROUP BY agent_key
		)
		SELECT ${VERSION_SELECT_COLUMNS}
		FROM ${AGENT_VERSIONS_TABLE} FINAL
		INNER JOIN latest USING (agent_key, version_number)
	`;
	const res = await dataCollector({ query }, "query", dbConfigId);
	if (res.err) {
		agentsLogger.error("get_latest_versions_batch_failed", {
			err: res.err,
			agentCount: agentKeys.length,
		});
		return new Map();
	}
	const rows = (res.data as Record<string, unknown>[]) || [];
	const map = new Map<string, AgentVersion>();
	for (const row of rows) {
		const v = rowToVersion(row);
		map.set(v.agent_key, v);
	}
	return map;
}

// Exported for tests.
export const _internals = {
	normalizeWhitespace,
	canonicalJson,
	roundTo3,
	normalizeTool,
	parseToolDefinitions,
};
