/**
 * SigNoz DataSourceAdapter (traces + logs).
 *
 * The first CE adapter with a fully hand-written HTTP layer: there is no
 * OpenPlait SigNoz package, so reads go through the shared `safeFetch`
 * boundary (SSRF policy, redirect re-validation, redaction, retry,
 * per-source concurrency) directly. Every read is a
 * `POST {baseUrl}/api/v5/query_range` - SigNoz's unified querier, GA since
 * SigNoz v0.92.0 and the canonical query API (v3/v4 are being deprecated).
 * `GET /api/v1/version` is used only for reachability; health requires one
 * tiny authenticated query_range so a bad API key reports as unhealthy.
 *
 * Deliberately out of scope in v1: metrics. SigNoz metric builder queries use
 * a different aggregation model (metricName + temporality + time/space
 * aggregation) that does not map onto the normalized OpenLITQuery shape
 * cheaply; the metric methods throw `UnsupportedCapabilityError` instead of
 * returning silent wrong results.
 */

import { BaseExternalAdapter } from "../base-adapter";
import type {
	Aggregation,
	DataFrame,
	DiscoveredService,
	HealthCheckResult,
	NormalizedFilter,
	NormalizedLog,
	NormalizedSpan,
	OpenLITQuery,
	QueryTimeRange,
	ServiceRollup,
	Signal,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { endpointField, allowHttpField, allowPrivateNetworkField } from "../config-fields";
import getMessage from "@/constants/messages";
import {
	safeFetch,
	selfHostedNetworkOptions,
	SourceResponseError,
} from "../http/safe-fetch";
import {
	normalizeDatasourceEndpointUrl,
	rewriteLoopbackEndpointForDocker,
	joinDatasourceRequestUrl,
} from "../http/endpoint-url";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";
import { computeIntervalMs } from "../downsample";
import { clampQueryToSource } from "../http/limits";
import { mapPool } from "../graph/map-pool";
import {
	buildAISelectorExpression,
	buildSignozFilterExpression,
	escapeLiteral,
	safeFieldName,
} from "./selector";

/** SigNoz rejects builder limits above 10000. */
const SIGNOZ_MAX_LIMIT = 10_000;
// Cap the phase-B trace_id IN list; longer lists are chunked into sequential
// queries so the filter expression stays a sane size.
const SIGNOZ_TRACE_ID_CHUNK = 500;
/** Oldest SigNoz server exposing /api/v5/query_range (GA). */
const MIN_SERVER_VERSION = "0.92.0";
const QUERY_RANGE_PATH = "api/v5/query_range";
const VERSION_PATH = "api/v1/version";
const AUTH_HEADER = "SIGNOZ-API-KEY";
const AUTH_TTL_MS = 30_000;
/** Span/log index bounds so list -> detail lookups survive across requests. */
const SPAN_INDEX_MAX = 5_000;
const LOG_INDEX_MAX = 5_000;
/** Detail lookups without a time hint search a trailing 7d window. */
const DETAIL_FALLBACK_RANGE_MS = 7 * 24 * 60 * 60 * 1_000;
const ZERO_PARENT = new Set(["", "0".repeat(16), "0".repeat(32)]);

const spanIndexBySource = new Map<string, Map<string, NormalizedSpan>>();
const logIndexBySource = new Map<string, Map<string, NormalizedLog>>();

function rememberSpans(sourceId: string, spans: NormalizedSpan[]) {
	let index = spanIndexBySource.get(sourceId);
	if (!index) {
		index = new Map();
		spanIndexBySource.set(sourceId, index);
	}
	for (const span of spans) {
		if (!span.spanId) continue;
		if (index.size >= SPAN_INDEX_MAX && !index.has(span.spanId)) {
			const oldest = index.keys().next().value;
			if (oldest) index.delete(oldest);
		}
		index.set(span.spanId, span);
	}
}

function rememberLogs(sourceId: string, logs: NormalizedLog[]) {
	let index = logIndexBySource.get(sourceId);
	if (!index) {
		index = new Map();
		logIndexBySource.set(sourceId, index);
	}
	for (const log of logs) {
		const id = log.logAttributes["signoz.log.id"];
		if (!id) continue;
		if (index.size >= LOG_INDEX_MAX && !index.has(id)) {
			const oldest = index.keys().next().value;
			if (oldest) index.delete(oldest);
		}
		index.set(id, log);
	}
}

/** Test-only: clear the in-process span/log indexes (one source, or all). */
export function __resetSignozForTests(sourceId?: string) {
	if (sourceId) {
		spanIndexBySource.delete(sourceId);
		logIndexBySource.delete(sourceId);
		return;
	}
	spanIndexBySource.clear();
	logIndexBySource.clear();
}

/* ------------------------- v5 request/response types ------------------- */

type SignozField = { name: string; fieldContext?: string };

type SignozBuilderQuery = {
	type: "builder_query";
	spec: {
		name: string;
		signal: "traces" | "logs";
		filter?: { expression: string };
		selectFields?: SignozField[];
		aggregations?: { expression: string; alias?: string }[];
		groupBy?: SignozField[];
		order?: { key: SignozField; direction: "asc" | "desc" }[];
		limit?: number;
		offset?: number;
		stepInterval?: string | number;
		cursor?: string;
	};
};

interface SignozQueryRangeRequest {
	schemaVersion: "v1";
	start: number;
	end: number;
	requestType: "scalar" | "time_series" | "raw";
	compositeQuery: { queries: SignozBuilderQuery[] };
	formatOptions?: { formatTableResultForUI?: boolean };
}

interface SignozRawRow {
	timestamp: string;
	data: Record<string, unknown>;
}

interface SignozRawData {
	queryName: string;
	nextCursor?: string;
	rows?: SignozRawRow[];
}

interface SignozScalarData {
	queryName: string;
	columns?: { name: string; columnType?: string }[];
	data?: unknown[][];
}

interface SignozSeriesValue {
	timestamp: number;
	value: number;
	partial?: boolean;
}

interface SignozTimeSeriesData {
	queryName: string;
	aggregations?: {
		series?: {
			labels?: { key: { name: string }; value: unknown }[];
			values?: SignozSeriesValue[];
		}[];
	}[];
}

interface SignozQueryRangeResponse {
	status?: string;
	data?: {
		type?: string;
		data?: {
			results?: (SignozRawData | SignozScalarData | SignozTimeSeriesData)[];
		};
	};
}

/* ----------------------------- normalization ---------------------------- */

function stringValue(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return undefined;
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const num = Number(value);
		if (Number.isFinite(num)) return num;
	}
	return undefined;
}

/** SigNoz raw timestamps arrive as RFC3339 strings or unix-nano strings. */
function isoTimestamp(value: unknown): string | undefined {
	const raw = stringValue(value);
	if (!raw) return undefined;
	if (/^\d+$/.test(raw)) {
		const num = Number(raw);
		// nanoseconds (>= ~2001-09-09 in ns) vs milliseconds
		const ms = num > 1e15 ? num / 1e6 : num > 1e12 ? num : num * 1000;
		return new Date(Math.floor(ms)).toISOString();
	}
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function attributeMap(
	row: Record<string, unknown>,
	prefix: string
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(row)) {
		if (!key.startsWith(prefix)) continue;
		const str = stringValue(value);
		if (str !== undefined) out[key.slice(prefix.length)] = str;
	}
	const mapColumn = row[prefix.replace(/\.$/, "")];
	if (mapColumn && typeof mapColumn === "object" && !Array.isArray(mapColumn)) {
		for (const [key, value] of Object.entries(
			mapColumn as Record<string, unknown>
		)) {
			const str = stringValue(value);
			if (str !== undefined && out[key] === undefined) out[key] = str;
		}
	}
	return out;
}

/** Coerce a nested SigNoz attribute/resources map into string values. */
function stringMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (raw === null || raw === undefined) continue;
		out[key] = typeof raw === "string" ? raw : String(raw);
	}
	return out;
}

/** Pull explicitly selected attribute keys off a raw row (null when absent). */
function flatSelectedAttributes(
	data: Record<string, unknown>,
	keys: string[]
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of keys) {
		const raw = data[key];
		if (raw === null || raw === undefined || raw === "") continue;
		out[key] = typeof raw === "string" ? raw : String(raw);
	}
	return out;
}

function rawRowToSpan(row: SignozRawRow): NormalizedSpan | null {
	const data = row.data || {};
	// A span without a parseable timestamp is corrupt; never render epoch 0.
	const timestamp = isoTimestamp(data["timestamp"] ?? row.timestamp);
	if (!timestamp) return null;
	const resourceMap = stringMap(data["resource"]);
	const statusCodeString = stringValue(data["status_code_string"]);
	return {
		traceId: stringValue(data["trace_id"]) || "",
		spanId: stringValue(data["span_id"]) || "",
		parentSpanId: stringValue(data["parent_span_id"]) || "",
		name: stringValue(data["name"]) || "",
		serviceName:
			stringValue(data["service.name"]) || resourceMap["service.name"] || "",
		timestamp,
		durationNs: numberValue(data["duration_nano"]) || 0,
		statusCode:
			statusCodeString || (data["has_error"] === true ? "ERROR" : "UNSET"),
		...(stringValue(data["status_message"])
			? { statusMessage: stringValue(data["status_message"]) }
			: {}),
		...(stringValue(data["kind_string"])
			? { spanKind: stringValue(data["kind_string"]) }
			: {}),
		spanAttributes: {
			...stringMap(data["attributes"]),
			...flatSelectedAttributes(data, SPAN_ATTRIBUTE_KEYS),
			...attributeMap(data, "attributes_string."),
		},
		resourceAttributes: {
			...resourceMap,
			// List responses carry the selected resource field as a flat key.
			...(stringValue(data["service.name"])
				? { "service.name": stringValue(data["service.name"])! }
				: {}),
			...attributeMap(data, "resources_string."),
		},
	};
}

function rowsToSpans(rows: SignozRawRow[] | undefined): NormalizedSpan[] {
	return (rows || [])
		.map(rawRowToSpan)
		.filter((span): span is NormalizedSpan => span !== null);
}

function rawRowToLog(row: SignozRawRow): NormalizedLog {
	const data = row.data || {};
	const attributes = {
		...stringMap(data["attributes_string"]),
		...stringMap(data["attributes_number"]),
		...stringMap(data["attributes_bool"]),
		...attributeMap(data, "attributes_string."),
	};
	const id = stringValue(data["id"]);
	if (id) attributes["signoz.log.id"] = id;
	return {
		timestamp:
			isoTimestamp(data["timestamp"] ?? row.timestamp) || row.timestamp,
		body: stringValue(data["body"]) || "",
		traceId: stringValue(data["trace_id"]),
		spanId: stringValue(data["span_id"]),
		severityText: stringValue(data["severity_text"]),
		severityNumber: numberValue(data["severity_number"]),
		serviceName: stringValue(data["service.name"]),
		logAttributes: attributes,
		resourceAttributes: {
			...stringMap(data["resources_string"]),
			...attributeMap(data, "resources_string."),
		},
	};
}

/**
 * Span attribute keys the AI telemetry selector can match on. List queries
 * select them explicitly so the selector never sees an empty attribute map;
 * SigNoz returns each as a flat row key (null when absent on the span).
 */
const SPAN_ATTRIBUTE_KEYS = [
	"telemetry.sdk.name",
	"telemetry.distro.name",
	"gen_ai.operation.name",
	"gen_ai.request.model",
	"gen_ai.system",
	"gen_ai.provider.name",
	"gen_ai.tool.name",
	"coding_agent.session.id",
	"session.id",
];

const SPAN_SELECT_FIELDS: SignozField[] = [
	{ name: "trace_id" },
	{ name: "span_id" },
	{ name: "parent_span_id" },
	{ name: "name" },
	{ name: "timestamp" },
	{ name: "duration_nano" },
	{ name: "status_code_string" },
	{ name: "status_message" },
	{ name: "kind_string" },
	{ name: "has_error" },
	{ name: "service.name", fieldContext: "resource" },
	...SPAN_ATTRIBUTE_KEYS.map((name) => ({ name })),
];

const LOG_SELECT_FIELDS: SignozField[] = [
	{ name: "id" },
	{ name: "timestamp" },
	{ name: "body" },
	{ name: "severity_text" },
	{ name: "severity_number" },
	{ name: "trace_id" },
	{ name: "span_id" },
	{ name: "service.name", fieldContext: "resource" },
];

const AGGREGATION_EXPRESSION: Record<string, (field?: string) => string> = {
	count: () => "count()",
	sum: (field) => `sum(${field})`,
	avg: (field) => `avg(${field})`,
	min: (field) => `min(${field})`,
	max: (field) => `max(${field})`,
	p50: (field) => `p50(${field})`,
	p90: (field) => `p90(${field})`,
	p95: (field) => `p95(${field})`,
	p99: (field) => `p99(${field})`,
	cardinality: (field) => `count_distinct(${field})`,
};

function aggregationExpression(agg: Aggregation): string | null {
	const builder = AGGREGATION_EXPRESSION[agg.fn];
	if (!builder) return null;
	if (agg.fn === "count") return builder(undefined);
	const field = safeFieldName(agg.field);
	if (!field) return null;
	return builder(field);
}

/** groupBy keys SigNoz stores as resource attributes (need fieldContext). */
const RESOURCE_GROUP_KEYS = new Set([
	"service.name",
	"deployment.environment",
	"service.namespace",
	"telemetry.sdk.name",
	"telemetry.distro.name",
	"host.name",
	"k8s.cluster.name",
]);

/* ------------------------------- adapter -------------------------------- */

export class SignozAdapter extends BaseExternalAdapter {
	readonly type = "signoz";
	private authCache?: {
		expiresAt: number;
		headers: Record<string, string>;
		redact: string[];
	};

	constructor(descriptor: TelemetrySourceDescriptor) {
		super(descriptor);
	}

	private get baseUrl(): string {
		const url = normalizeDatasourceEndpointUrl(
			String(this.descriptor.settings.url || "")
		);
		const network = selfHostedNetworkOptions(this.descriptor.settings);
		return network.allowPrivateNetwork
			? rewriteLoopbackEndpointForDocker(url)
			: url;
	}

	private async auth() {
		if (this.authCache && this.authCache.expiresAt > Date.now()) {
			return this.authCache;
		}
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId,
			this.descriptor.projectId
		);
		const apiKey = (secret.credentials.apiKey || secret.credentials.token || "").trim();
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (apiKey) headers[AUTH_HEADER] = apiKey;
		this.authCache = {
			expiresAt: Date.now() + AUTH_TTL_MS,
			headers,
			redact: redactableSecretValues(secret),
		};
		return this.authCache;
	}

	/** POST a v5 query_range request through the SSRF-safe boundary. */
	private async queryRange(
		request: SignozQueryRangeRequest,
		queryTag = "query"
	): Promise<SignozQueryRangeResponse> {
		const { headers, redact } = await this.auth();
		const network = selfHostedNetworkOptions(this.descriptor.settings);
		// Provenance for the SigNoz server's query logs (Grafana X-Query-Tags idiom).
		headers["X-Query-Tags"] = `source=openlit,feature=${queryTag}`;
		return safeFetch<SignozQueryRangeResponse>(
			joinDatasourceRequestUrl(this.baseUrl, QUERY_RANGE_PATH),
			{
				method: "POST",
				headers,
				body: JSON.stringify(request),
				...network,
				redactValues: redact,
				timeoutMs: 30_000,
				concurrencyKey: this.descriptor.id,
				maxConcurrent: 6,
				retry: true,
			}
		);
	}

	private async rawRows(
		request: SignozQueryRangeRequest,
		queryTag?: string
	): Promise<SignozRawData> {
		const response = await this.queryRange(request, queryTag);
		const result = response.data?.data?.results?.[0] as SignozRawData | undefined;
		return result || { queryName: "A", rows: [] };
	}

	private timeRangeMs(range: QueryTimeRange): { start: number; end: number } {
		return { start: range.start.getTime(), end: range.end.getTime() };
	}

	private buildRequest(
		query: OpenLITQuery,
		opts: {
			requestType: SignozQueryRangeRequest["requestType"];
			selectFields?: SignozField[];
			aggregations?: { expression: string; alias?: string }[];
			groupBy?: SignozField[];
			extraFilters?: string[];
			order?: { key: SignozField; direction: "asc" | "desc" }[];
			limit?: number;
			offset?: number;
			stepInterval?: string | number;
			cursor?: string;
		}
	): SignozQueryRangeRequest {
		const expression = buildSignozFilterExpression(query, opts.extraFilters || []);
		const spec: SignozBuilderQuery["spec"] = {
			name: "A",
			signal: query.signal as "traces" | "logs",
		};
		if (expression) spec.filter = { expression };
		if (opts.selectFields) spec.selectFields = opts.selectFields;
		if (opts.aggregations) spec.aggregations = opts.aggregations;
		if (opts.groupBy) spec.groupBy = opts.groupBy;
		if (opts.order) spec.order = opts.order;
		if (opts.limit !== undefined) {
			spec.limit = Math.min(Math.max(1, opts.limit), SIGNOZ_MAX_LIMIT);
		}
		if (opts.offset !== undefined) spec.offset = opts.offset;
		if (opts.stepInterval !== undefined) spec.stepInterval = opts.stepInterval;
		if (opts.cursor) spec.cursor = opts.cursor;
		const { start, end } = this.timeRangeMs(query.timeRange);
		return {
			schemaVersion: "v1",
			start,
			end,
			requestType: opts.requestType,
			compositeQuery: { queries: [{ type: "builder_query", spec }] },
		};
	}

	capabilities(): SourceCapabilities {
		return {
			signals: ["traces", "logs"],
			traceTree: true,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			// SigNoz trace/log retention is deployment-configured; 14d is the
			// common default, and one query window may not exceed 30d.
			maxLookbackMs: 14 * 24 * 60 * 60 * 1000,
			maxTimeRangeMs: 30 * 24 * 60 * 60 * 1000,
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const started = Date.now();
		try {
			const { headers, redact } = await this.auth();
			const network = selfHostedNetworkOptions(this.descriptor.settings);
			// Reachability: /api/v1/version is unauthenticated.
			const versionBody = await safeFetch<Record<string, unknown>>(
				joinDatasourceRequestUrl(this.baseUrl, VERSION_PATH),
				{ ...network, redactValues: redact, timeoutMs: 10_000 }
			);
			const rawVersion =
				stringValue(versionBody?.version) || stringValue(versionBody?.data);
			const version = rawVersion === "<unset>" ? undefined : rawVersion;
			// Auth: one tiny authenticated query_range so a bad key fails health.
			const end = Date.now();
			await this.rawRows({
				schemaVersion: "v1",
				start: end - 15 * 60_000,
				end,
				requestType: "raw",
				compositeQuery: {
					queries: [
						{
							type: "builder_query",
							spec: { name: "A", signal: "logs", limit: 1 },
						},
					],
				},
			});
			return {
				ok: true,
				latencyMs: Date.now() - started,
				message: version ? `SigNoz ${version}` : undefined,
			};
		} catch (error) {
			const status =
				error instanceof SourceResponseError ? error.status : undefined;
			let message = String((error as Error)?.message || error);
			if (status === 401 || status === 403) {
				message = "SigNoz rejected the API key (check the SIGNOZ-API-KEY value).";
			} else if (status === 404) {
				message = `SigNoz query API not found - check the endpoint is the SigNoz server root (a trailing /api or /v1 path breaks routing). This connector requires SigNoz >= v${MIN_SERVER_VERSION}.`;
			}
			return { ok: false, latencyMs: Date.now() - started, message };
		}
	}

	async validateAISignal(window: QueryTimeRange) {
		try {
			const sample = await this.listSpans({
				signal: "traces",
				timeRange: window,
				limit: 100,
				aiSelector: true,
			});
			return {
				ok: sample.rows.length > 0,
				sampleCount: sample.rows.length,
				missingAttributes: [] as string[],
				supported: true,
			};
		} catch (error) {
			return {
				ok: false,
				sampleCount: 0,
				missingAttributes: [] as string[],
				supported: true,
				message: String((error as Error)?.message || error),
			};
		}
	}

	/* ------------------------------- traces ------------------------------- */

	async listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		const started = Date.now();
		const clamped = clampQueryToSource(this, {
			...query,
			signal: "traces" as const,
		}).query;
		const limit = Math.min(Math.max(1, clamped.limit || 500), SIGNOZ_MAX_LIMIT);
		const listFields: DataFrame["fields"] = [
			{ name: "timestamp", type: "time" },
			{ name: "name", type: "string" },
			{ name: "serviceName", type: "string" },
			{ name: "durationNs", type: "number" },
		];
		const selectorExpression =
			clamped.aiSelector === false ? undefined : buildAISelectorExpression();
		const hasUserFilters = (clamped.filters || []).length > 0;

		// Trace-level semantics (Jaeger parity): the AI selector and user
		// filters qualify a trace when ANY of its spans matches - gen_ai.*
		// usually lives on child spans under a non-AI root (HTTP ingress).
		// Phase A resolves the qualifying trace ids server-side (no root
		// restriction, no post-limit local filtering); phase B lists roots.
		if (selectorExpression || hasUserFilters) {
			// Phase A: one row per trace (grouped by trace_id, ordered by the
			// trace's most recent span) so chatty traces do not eat the row
			// budget. Offset windows HERE; phase B lists roots with offset 0.
			const offset = Math.max(0, clamped.offset || 0);
			const matched = await this.scalarRows(clamped, {
				aggregations: [{ expression: "max(timestamp)", alias: "last_seen" }],
				groupBy: [{ name: "trace_id" }],
				extraFilters: selectorExpression ? [selectorExpression] : [],
				order: [{ key: { name: "last_seen" }, direction: "desc" }],
				limit: limit + offset,
			});
			const traceIds = (matched.data || [])
				.map((row) => stringValue(row[0]))
				.filter((id): id is string => !!id)
				.slice(offset, offset + limit);
			if (traceIds.length === 0) {
				return {
					fields: listFields,
					rows: [],
					meta: { latencyMs: Date.now() - started, freshness: "live" },
				};
			}
			// Phase B: chunk the IN list; one root per trace keeps the recency
			// order from phase A stable across chunks.
			const listQuery = { ...clamped, filters: [] };
			const roots: NormalizedSpan[] = [];
			for (let i = 0; i < traceIds.length; i += SIGNOZ_TRACE_ID_CHUNK) {
				const chunk = traceIds.slice(i, i + SIGNOZ_TRACE_ID_CHUNK);
				const request = this.buildRequest(listQuery, {
					requestType: "raw",
					selectFields: SPAN_SELECT_FIELDS,
					extraFilters: [
						`trace_id IN (${chunk.map(escapeLiteral).join(", ")})`,
						"parent_span_id = ''",
					],
					order: [{ key: { name: "timestamp" }, direction: "desc" }],
					limit: chunk.length,
				});
				const key = cacheKey(this.descriptor.id, ["signoz-list", request]);
				const chunkRows = await cachedQuery(key, 15_000, async () => {
					const result = await this.rawRows(request, "list-spans");
					return rowsToSpans(result.rows);
				});
				roots.push(...chunkRows);
			}
			rememberSpans(this.descriptor.id, roots);
			return {
				fields: listFields,
				rows: roots,
				meta: { latencyMs: Date.now() - started, freshness: "live" },
			};
		}

		// No selector and no filters: list roots directly. The traces surface
		// lists traces by their root span.
		const request = this.buildRequest(clamped, {
			requestType: "raw",
			selectFields: SPAN_SELECT_FIELDS,
			extraFilters: ["parent_span_id = ''"],
			order: [{ key: { name: "timestamp" }, direction: "desc" }],
			limit,
			offset: clamped.offset,
		});
		const key = cacheKey(this.descriptor.id, ["signoz-list", request]);
		const rows = await cachedQuery(key, 15_000, async () => {
			const result = await this.rawRows(request, "list-spans");
			return rowsToSpans(result.rows);
		});
		rememberSpans(this.descriptor.id, rows);
		return {
			fields: listFields,
			rows,
			meta: { latencyMs: Date.now() - started, freshness: "live" },
		};
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		const id = String(spanId || "").trim();
		if (!id) return null;
		const cached = spanIndexBySource.get(this.descriptor.id)?.get(id);
		if (cached) return cached;
		const end = new Date();
		const start = new Date(end.getTime() - DETAIL_FALLBACK_RANGE_MS);
		const result = await this.rawRows(
			this.buildRequest(
				{ signal: "traces", timeRange: { start, end } },
				{
					requestType: "raw",
					// No selectFields: detail lookups need full attribute maps.
					extraFilters: [`span_id = ${escapeLiteral(id)}`],
					limit: 1,
				}
			)
		);
		const span = rowsToSpans(result.rows)[0];
		if (span) rememberSpans(this.descriptor.id, [span]);
		return span || null;
	}

	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		const id = String(traceId || "").trim();
		if (!id) return [];
		const end = new Date();
		const start = new Date(end.getTime() - DETAIL_FALLBACK_RANGE_MS);
		const request = this.buildRequest(
			{ signal: "traces", timeRange: { start, end } },
			{
				requestType: "raw",
				// No selectFields: detail lookups need full attribute maps.
				extraFilters: [`trace_id = ${escapeLiteral(id)}`],
				order: [{ key: { name: "timestamp" }, direction: "asc" }],
				limit: SIGNOZ_MAX_LIMIT,
			}
		);
		const key = cacheKey(this.descriptor.id, ["signoz-trace", request]);
		const spans = await cachedQuery(key, 30_000, async () => {
			const result = await this.rawRows(request);
			return rowsToSpans(result.rows);
		});
		rememberSpans(this.descriptor.id, spans);
		return spans;
	}

	private async scalarRows(
		query: OpenLITQuery,
		opts: {
			aggregations: { expression: string; alias?: string }[];
			groupBy?: SignozField[];
			extraFilters?: string[];
			order?: { key: SignozField; direction: "asc" | "desc" }[];
			limit?: number;
		}
	): Promise<SignozScalarData> {
		const response = await this.queryRange(
			this.buildRequest(query, {
				requestType: "scalar",
				aggregations: opts.aggregations,
				groupBy: opts.groupBy,
				extraFilters: opts.extraFilters,
				order: opts.order,
				limit: opts.limit,
			}),
			"aggregate"
		);
		const result = response.data?.data?.results?.[0] as
			| SignozScalarData
			| undefined;
		return result || { queryName: "A", data: [] };
	}

	async aggregateSpans(query: OpenLITQuery): Promise<DataFrame> {
		const started = Date.now();
		const clamped = clampQueryToSource(this, {
			...query,
			signal: "traces" as const,
		}).query;
		const aggregations: { expression: string; alias?: string }[] = [];
		for (const agg of clamped.aggregations || []) {
			const expression = aggregationExpression(agg);
			if (expression) {
				aggregations.push(agg.as ? { expression, alias: agg.as } : { expression });
			}
		}
		if (aggregations.length === 0) {
			aggregations.push({ expression: "count()", alias: "count" });
		}
		const groupBy = (clamped.groupBy || [])
			.map((name) => safeFieldName(name))
			.filter((name): name is string => name !== null)
			.map((name): SignozField =>
				RESOURCE_GROUP_KEYS.has(name)
					? { name, fieldContext: "resource" }
					: { name }
			);
		const result = await this.scalarRows(clamped, {
			aggregations,
			groupBy,
			limit: clamped.limit,
		});
		const resultColumns = result.columns || [];
		const columns = resultColumns.map((column) => column.name);
		const rows = (result.data || []).map((row) =>
			Object.fromEntries(columns.map((name, index) => [name, row[index]]))
		);
		return {
			fields: resultColumns.map((column) => ({
				name: column.name,
				// Aggregation results are numeric; only group columns are labels.
				type: (column.columnType === "group" ? "string" : "number") as
					| "string"
					| "number",
			})),
			rows,
			meta: { latencyMs: Date.now() - started, freshness: "live" },
		};
	}

	private async countSeries(
		query: OpenLITQuery,
		extraFilters: string[] = []
	): Promise<DataFrame> {
		const started = Date.now();
		const clamped = clampQueryToSource(this, query).query;
		// step honors maxDataPoints so wide windows never return huge series.
		const stepMs = computeIntervalMs(clamped);
		const stepSeconds = Math.max(1, Math.round(stepMs / 1000));
		const response = await this.queryRange(
			this.buildRequest(clamped, {
				requestType: "time_series",
				aggregations: [{ expression: "count()", alias: "count" }],
				extraFilters,
				stepInterval: stepSeconds,
			}),
			"series"
		);
		const result = response.data?.data?.results?.[0] as
			| SignozTimeSeriesData
			| undefined;
		const rows: Record<string, unknown>[] = [];
		for (const bucket of result?.aggregations || []) {
			for (const series of bucket.series || []) {
				const label = (series.labels || [])
					.map((l) => String(l.value))
					.join(", ");
				for (const point of series.values || []) {
					// Partial trailing buckets would understate the rate - drop them.
					if (point.partial) continue;
					const timestamp = new Date(point.timestamp).toISOString();
					rows.push({
						timestamp,
						value: point.value,
						label: label || timestamp,
						count: point.value,
					});
				}
			}
		}
		return {
			fields: [
				{ name: "timestamp", type: "time" },
				{ name: "value", type: "number" },
				{ name: "label", type: "string" },
				{ name: "count", type: "number" },
			],
			rows,
			meta: { latencyMs: Date.now() - started, freshness: "live" },
		};
	}

	async spanTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		return this.countSeries({ ...query, signal: "traces" });
	}

	async distinctValues(key: string, query: OpenLITQuery): Promise<string[]> {
		const field = safeFieldName(String(key || "").trim());
		if (!field) return [];
		const signal: Signal = query.signal === "logs" ? "logs" : "traces";
		// service.name is a resource attribute; it needs the resource context
		// or the server silently returns no groups.
		const groupField: SignozField =
			field === "service.name"
				? { name: field, fieldContext: "resource" }
				: { name: field };
		const result = await this.scalarRows(
			{ ...query, signal },
			{
				aggregations: [{ expression: "count()" }],
				groupBy: [groupField],
				limit: 1_000,
			}
		);
		const columns = result.columns || [];
		const groupIndex = columns.findIndex(
			(column) => column.name === field && column.columnType === "group"
		);
		if (groupIndex < 0) return [];
		const values = new Set<string>();
		for (const row of result.data || []) {
			const value = stringValue(row[groupIndex]);
			if (value) values.add(value);
		}
		return Array.from(values).sort();
	}

	async attributeKeys(signal: Signal, _window: QueryTimeRange): Promise<string[]> {
		// SigNoz v5 has no attribute-key discovery endpoint; return none rather
		// than guessing. Filter suggestions degrade to manual entry.
		void signal;
		return [];
	}

	/* -------------------------------- logs -------------------------------- */

	private async listLogsPage(
		query: OpenLITQuery
	): Promise<{ logs: NormalizedLog[]; nextCursor?: string }> {
		const result = await this.rawRows(
			this.buildRequest({ ...query, signal: "logs" }, {
				requestType: "raw",
				selectFields: LOG_SELECT_FIELDS,
				order: [
					{ key: { name: "timestamp" }, direction: "desc" },
					{ key: { name: "id" }, direction: "desc" },
				],
				limit: query.limit || 500,
				offset: query.offset,
			})
		);
		return {
			logs: (result.rows || []).map(rawRowToLog),
			nextCursor: result.nextCursor || undefined,
		};
	}

	// listLogsPage surfaces the server cursor, but DataFrameMeta has no cursor
	// field, so list surfaces paginate with offset/limit; the cursor is kept
	// here for the adapter's own follow-up pages.
	async listLogs(query: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		const started = Date.now();
		const { logs } = await this.listLogsPage(
			clampQueryToSource(this, { ...query, signal: "logs" as const }).query
		);
		rememberLogs(this.descriptor.id, logs);
		return {
			fields: [
				{ name: "timestamp", type: "time" },
				{ name: "body", type: "string" },
				{ name: "logAttributes", type: "map" },
			],
			rows: logs,
			meta: { latencyMs: Date.now() - started, freshness: "live" },
		};
	}

	async getLog(
		logId: string,
		opts?: { aroundTimestamp?: string | Date; timeRange?: QueryTimeRange }
	): Promise<NormalizedLog | null> {
		const id = String(logId || "").trim();
		if (!id) return null;
		const cached = logIndexBySource.get(this.descriptor.id)?.get(id);
		if (cached) return cached;

		let start: Date;
		let end: Date;
		if (opts?.timeRange?.start && opts?.timeRange?.end) {
			start = new Date(opts.timeRange.start);
			end = new Date(opts.timeRange.end);
		} else if (opts?.aroundTimestamp) {
			const center = new Date(opts.aroundTimestamp);
			if (!Number.isNaN(center.getTime())) {
				start = new Date(center.getTime() - 60 * 60_000);
				end = new Date(center.getTime() + 60 * 60_000);
			} else {
				end = new Date();
				start = new Date(end.getTime() - DETAIL_FALLBACK_RANGE_MS);
			}
		} else {
			end = new Date();
			start = new Date(end.getTime() - DETAIL_FALLBACK_RANGE_MS);
		}

		const result = await this.rawRows(
			this.buildRequest(
				{ signal: "logs", timeRange: { start, end } },
				{
					requestType: "raw",
					// No selectFields: detail lookups need full attribute maps.
					extraFilters: [`id = ${escapeLiteral(id)}`],
					limit: 1,
				}
			)
		);
		const log = (result.rows || []).map(rawRowToLog)[0];
		if (log) rememberLogs(this.descriptor.id, [log]);
		return log || null;
	}

	async logTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		return this.countSeries({ ...query, signal: "logs" });
	}

	/* ------------------------------ discovery ----------------------------- */

	async discoverServices(window: QueryTimeRange): Promise<DiscoveredService[]> {
		const result = await this.scalarRows(
			{ signal: "traces", timeRange: window },
			{
				aggregations: [{ expression: "count()" }],
				groupBy: [{ name: "service.name", fieldContext: "resource" }],
				limit: 100,
			}
		);
		const columns = result.columns || [];
		const groupIndex = columns.findIndex(
			(column) => column.name === "service.name"
		);
		if (groupIndex < 0) return [];
		const environment = this.descriptor.environment || "default";
		const services: DiscoveredService[] = [];
		for (const row of result.data || []) {
			const serviceName = stringValue(row[groupIndex]);
			if (!serviceName) continue;
			services.push({ serviceName, environment, clusterId: environment });
		}
		return services;
	}

	async aggregateByService(window: QueryTimeRange): Promise<ServiceRollup[]> {
		const environment = this.descriptor.environment || "default";
		const counts = await this.scalarRows(
			{ signal: "traces", timeRange: window },
			{
				aggregations: [{ expression: "count()", alias: "request_count" }],
				groupBy: [{ name: "service.name", fieldContext: "resource" }],
				limit: 100,
			}
		);
		const models = await this.scalarRows(
			{ signal: "traces", timeRange: window },
			{
				aggregations: [{ expression: "count()" }],
				groupBy: [
					{ name: "service.name", fieldContext: "resource" },
					{ name: "gen_ai.request.model" },
					{ name: "gen_ai.system" },
				],
				extraFilters: ["gen_ai.request.model EXISTS"],
				limit: 1_000,
			}
		);

		const columns = counts.columns || [];
		const serviceIndex = columns.findIndex((c) => c.name === "service.name");
		const countIndex = columns.findIndex((c) => c.name === "request_count");
		const rollups = new Map<string, ServiceRollup>();
		if (serviceIndex >= 0) {
			for (const row of counts.data || []) {
				const serviceName = stringValue(row[serviceIndex]);
				if (!serviceName) continue;
				rollups.set(serviceName, {
					serviceName,
					environment,
					clusterId: environment,
					requestCount: numberValue(row[countIndex]) || 0,
					models: [],
					providers: [],
				});
			}
		}
		const modelColumns = models.columns || [];
		const mService = modelColumns.findIndex((c) => c.name === "service.name");
		const mModel = modelColumns.findIndex(
			(c) => c.name === "gen_ai.request.model"
		);
		const mProvider = modelColumns.findIndex((c) => c.name === "gen_ai.system");
		for (const row of models.data || []) {
			const serviceName = mService >= 0 ? stringValue(row[mService]) : undefined;
			if (!serviceName) continue;
			const rollup = rollups.get(serviceName) || {
				serviceName,
				environment,
				clusterId: environment,
				requestCount: 0,
				models: [],
				providers: [],
			};
			const model = mModel >= 0 ? stringValue(row[mModel]) : undefined;
			const provider = mProvider >= 0 ? stringValue(row[mProvider]) : undefined;
			if (model && !rollup.models.includes(model)) rollup.models.push(model);
			if (provider && !rollup.providers.includes(provider)) {
				rollup.providers.push(provider);
			}
			rollups.set(serviceName, rollup);
		}
		return Array.from(rollups.values());
	}

	async sampleTracesForGraph(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		const list = await this.listSpans({
			...query,
			limit: Math.min(Math.max(1, maxTraces), 100),
		});
		const traceIds = Array.from(
			new Set(list.rows.map((span) => span.traceId).filter(Boolean))
		);
		const trees = await mapPool(traceIds, 6, (traceId) =>
			this.getTraceSpans(traceId)
		);
		return trees.flat();
	}
}

export const signozAdapterFactory = {
	type: "signoz",
	create: (descriptor: TelemetrySourceDescriptor) =>
		new SignozAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "signoz",
		displayName: "SigNoz",
		description:
			"Traces and logs from a SigNoz query API (v5, SigNoz v0.92.0 or later). Queries clamp to 14 days of lookback and 30 days per window.",
		declaredSignals: ["traces", "logs"],
		capabilities: {
			traceTree: true,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: { crossSignal: true, keys: ["traceId", "spanId", "service"] },
		configFields: [
			endpointField("http://localhost:8080"),
			allowHttpField(),
			allowPrivateNetworkField(),
			{
				key: "apiKey",
				label: getMessage().DATA_SOURCE_FIELD_API_KEY,
				kind: "password",
				group: "credentials",
				description: getMessage().DATA_SOURCE_AUTH_HELP_SIGNOZ,
			},
		],
		authStyle: "api-key",
		authHelp: getMessage().DATA_SOURCE_AUTH_HELP_SIGNOZ,
		docsUrl: "https://signoz.io/docs/userguide/query-builder-v5/",
	}),
};
