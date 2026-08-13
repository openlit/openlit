/**
 * Grafana Tempo adapter (traces).
 *
 * TraceQL search (`GET /api/search`) with the AI selector pushed down, plus
 * `GET /api/traces/{id}` for full spans (including events, so chat view + evals
 * work). Trace-volume summaries bucket lightweight Tempo search rows, while
 * product aggregations and the aggregate agent DAG can use TraceQL metrics or
 * a bounded sample of full traces; cost/token rollups are gated accordingly.
 */

import { BaseExternalAdapter } from "../base-adapter";
import {
	OPENPLAIT_API_VERSION,
	type NativeQuery,
} from "@openplait/core";
import {
	TempoAdapter as OpenPlaitTempoAdapter,
	type TempoAdapterConfig,
	type TempoServerCapabilities,
} from "@openplait/adapter-tempo";
import { AdapterError } from "@openplait/adapter-sdk";
import type {
	AISignalValidation,
	DataFrame,
	DiscoveredService,
	HealthCheckResult,
	NormalizedSpan,
	OpenLITQuery,
	QueryTimeRange,
	ServiceRollup,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { applyHttpAuthCredentials } from "../http/auth-headers";
import { httpVendorFields } from "../config-fields";
import { computeIntervalMs, clampStepMs } from "../downsample";
import getMessage from "@/constants/messages";
import {
	safeFetch,
	selfHostedNetworkOptions,
	SourceResponseError,
} from "../http/safe-fetch";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";
import { normalizeOtlpId } from "../otlp-json";
import { openPlaitFramesToRows } from "@/lib/platform/openplait/frames";
import {
	buildAITelemetrySelector,
	type AITelemetrySelector,
	type SelectorCondition,
} from "../ai-selector";
import type { NormalizedFilter } from "../types";
import { mapPool } from "../graph/map-pool";
import {
	computeAggregateSpansL1,
	computeDistinctValuesL1,
	computeSpanTimeSeriesL1,
} from "../l1-compute";
import { bucketSpansByInterval } from "../graph/sample-aggregate";
import { clampQueryToSource } from "../http/limits";

const TTL_MS = 30_000;
const MAX_TRACE_FETCH = 200;
/** Lightweight Tempo search summaries used for the trace-volume chart. */
const TRACE_SUMMARY_CAP = 5_000;
/** Request one extra row so truncation can be reported honestly. */
const MAX_TRACE_SEARCH = TRACE_SUMMARY_CAP + 1;
/** Parallel full-trace downloads after TraceQL search (Grafana Explore loads lazily). */
const TRACE_FETCH_CONCURRENCY = 4;
/** Cap how many span ids we remember for detail/hierarchy lookups. */
const SPAN_INDEX_MAX = 5_000;
const DEFAULT_TEMPO_METRICS_WINDOW_MS = 24 * 60 * 60 * 1_000;
const TEMPO_PROFILE_TTL_MS = 10 * 60 * 1000;

type CachedTempoProfile = TempoServerCapabilities & { expiresAt: number };
const tempoProfileBySource = new Map<string, CachedTempoProfile>();
const learnedSearchRangeBySource = new Map<string, number>();
const learnedSearchLimitBySource = new Map<string, number>();

function adapterErrorDiagnostics(error: unknown): Record<string, unknown> {
	if (!(error instanceof AdapterError)) {
		return { message: String((error as Error)?.message || error) };
	}
	const details = error.details || {};
	return {
		message: error.message,
		code: error.code,
		...(typeof details.status === "number" ? { status: details.status } : {}),
		...(typeof details.body === "string"
			? { upstreamBody: details.body.slice(0, 1000) }
			: {}),
		...(typeof details.endpoint === "string"
			? { endpoint: details.endpoint }
			: {}),
		...(typeof details.queryLength === "number"
			? { queryLength: details.queryLength }
			: {}),
		...(typeof details.upstreamRequestId === "string"
			? { upstreamRequestId: details.upstreamRequestId }
			: {}),
	};
}

function adapterErrorStatus(error: unknown): number | undefined {
	const value = error instanceof AdapterError ? error.details?.status : undefined;
	return typeof value === "number" ? value : undefined;
}

function adapterErrorBody(error: unknown): string {
	const value = error instanceof AdapterError ? error.details?.body : undefined;
	return typeof value === "string" ? value : "";
}

function withoutMostRecentHint(traceql: string): string {
	return traceql.replace(/\s+with\s*\(\s*most_recent\s*=\s*true\s*\)\s*$/i, "");
}

function goDurationMs(value: string): number | undefined {
	let total = 0;
	let matched = 0;
	const unitMs: Record<string, number> = {
		h: 3_600_000,
		m: 60_000,
		s: 1_000,
		ms: 1,
	};
	const expression = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
	let match: RegExpExecArray | null;
	while ((match = expression.exec(value)) !== null) {
		total += Number(match[1]) * unitMs[match[2]];
		matched += match[0].length;
	}
	return matched === value.length && total > 0 ? total : undefined;
}

/** Extract a Tempo-reported search ceiling without guessing from generic 400s. */
function reportedMaxDurationMs(body: string): number | undefined {
	if (!/(?:max(?:imum)?|limit).{0,40}duration|duration.{0,40}(?:max(?:imum)?|limit)/i.test(body)) {
		return undefined;
	}
	const candidates: string[] = [];
	const expression = /\b(\d+(?:\.\d+)?(?:ms|h|m|s)(?:\d+(?:\.\d+)?(?:ms|h|m|s))*)\b/g;
	let match: RegExpExecArray | null;
	while ((match = expression.exec(body)) !== null) candidates.push(match[1]);
	for (let index = candidates.length - 1; index >= 0; index--) {
		const parsed = goDurationMs(candidates[index]);
		if (parsed) return parsed;
	}
	return undefined;
}

/** Extract a Tempo-reported search result ceiling (for example, max limit 1000). */
function reportedMaxSearchLimit(body: string): number | undefined {
	const patterns = [
		/limit\s+\d+\s+exceeds\s+max(?:imum)?\s+limit\s+(\d+)/i,
		/max(?:imum)?(?:\s+search)?\s+limit(?:\s+is|:)?\s*(\d+)/i,
		/search[^\n]{0,80}max_result_limit[^\d]*(\d+)/i,
	];
	for (const pattern of patterns) {
		const value = Number(body.match(pattern)?.[1]);
		if (Number.isSafeInteger(value) && value > 0) return value;
	}
	return undefined;
}

function safeRequestId(sourceId: string, operation: string): string {
	const source = sourceId.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 72);
	return `openlit:tempo:${source}:${operation}:${Date.now()}`;
}

function stringMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, item]) => [
			key,
			typeof item === "string" ? item : JSON.stringify(item),
		])
	);
}

function eventTimestamp(value: unknown): string | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	try {
		const nanos = BigInt(value);
		return new Date(Number(nanos / BigInt(1_000_000))).toISOString();
	} catch {
		return undefined;
	}
}

function eventAttributes(value: unknown): Record<string, string> {
	if (!Array.isArray(value)) return stringMap(value);
	const out: Record<string, string> = {};
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const entry = item as { key?: unknown; value?: Record<string, unknown> };
		if (typeof entry.key !== "string") continue;
		const wrapped = entry.value || {};
		const raw =
			wrapped.stringValue ??
			wrapped.intValue ??
			wrapped.doubleValue ??
			wrapped.boolValue ??
			"";
		out[entry.key] = typeof raw === "string" ? raw : String(raw);
	}
	return out;
}

function normalizedEvents(value: unknown): NormalizedSpan["events"] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => {
		const event =
			item && typeof item === "object"
				? (item as Record<string, unknown>)
				: {};
		return {
			name: String(event.name || ""),
			timestamp: eventTimestamp(event.timeUnixNano ?? event.timestamp),
			attributes: eventAttributes(event.attributes),
		};
	});
}

function normalizedStatus(value: unknown): string {
	const status = String(value || "").toLowerCase();
	if (status === "error" || status === "status_code_error") {
		return "STATUS_CODE_ERROR";
	}
	if (status === "ok" || status === "status_code_ok") {
		return "STATUS_CODE_OK";
	}
	return status === "unset" ? "STATUS_CODE_UNSET" : String(value || "");
}

function normalizedSpanKind(value: unknown): string | undefined {
	const kind = String(value || "").toLowerCase();
	const number = {
		unspecified: "0",
		internal: "1",
		server: "2",
		client: "3",
		producer: "4",
		consumer: "5",
	}[kind as "unspecified" | "internal" | "server" | "client" | "producer" | "consumer"];
	return number || (value === undefined || value === null ? undefined : String(value));
}

function openPlaitRowsToSpans(rows: Record<string, unknown>[]): NormalizedSpan[] {
	return rows.map((row) => {
		const resourceAttributes = stringMap(row["resource.attributes"]);
		return {
			traceId: normalizeOtlpId(String(row["trace.id"] || "")),
			spanId: normalizeOtlpId(String(row["span.id"] || "")),
			parentSpanId: normalizeOtlpId(String(row["span.parent_id"] || "")),
			name: String(row["span.name"] || ""),
			serviceName: String(
				row["service.name"] || resourceAttributes["service.name"] || ""
			),
			timestamp: String(row.timestamp || ""),
			durationNs: Math.max(0, Number(row.duration || 0) * 1_000_000),
			statusCode: normalizedStatus(row["status.code"]),
			statusMessage: String(row["status.message"] || ""),
			spanKind: normalizedSpanKind(row["span.kind"]),
			spanAttributes: stringMap(row["span.attributes"]),
			resourceAttributes,
			events: normalizedEvents(row.events),
		};
	});
}

/**
 * Process-wide span index so Telemetry list → detail works across separate
 * HTTP handlers in the same Node process (adapters are constructed per request).
 */
const spanIndexBySource = new Map<string, Map<string, NormalizedSpan>>();

function rememberSpans(sourceId: string, spans: NormalizedSpan[]) {
	let map = spanIndexBySource.get(sourceId);
	if (!map) {
		map = new Map();
		spanIndexBySource.set(sourceId, map);
	}
	for (const span of spans) {
		if (!span.spanId) continue;
		if (map.size >= SPAN_INDEX_MAX) {
			const oldest = map.keys().next().value;
			if (oldest) map.delete(oldest);
		}
		map.set(span.spanId, span);
	}
}

function lookupIndexedSpan(
	sourceId: string,
	spanId: string
): NormalizedSpan | undefined {
	const map = spanIndexBySource.get(sourceId);
	if (!map) return undefined;
	return map.get(spanId) || map.get(normalizeOtlpId(spanId));
}

/** Test-only: clear the process-wide Tempo span index. */
export function __clearTempoSpanIndex() {
	spanIndexBySource.clear();
	tempoProfileBySource.clear();
	learnedSearchRangeBySource.clear();
	learnedSearchLimitBySource.clear();
}

function pickRootSpan(spans: NormalizedSpan[]): NormalizedSpan | undefined {
	if (spans.length === 0) return undefined;
	return (
		spans.find((s) => !s.parentSpanId || s.parentSpanId === "0".repeat(16)) ||
		spans[0]
	);
}

function traceqlValue(v: string): string {
	return `"${v.replace(/"/g, '\\"')}"`;
}

function conditionToTraceQL(cond: SelectorCondition): string {
	if (cond.target === "spanName") {
		const values = Array.isArray(cond.value) ? cond.value : [cond.value || ""];
		return `(${values.map((v) => `name = ${traceqlValue(String(v))}`).join(" || ")})`;
	}
	const scope = cond.scope === "resource" ? "resource" : "span";
	const key = `${scope}.${cond.key}`;
	if (cond.op === "exists") return `${key} != ""`;
	if (cond.op === "eq") return `${key} = ${traceqlValue(String(cond.value ?? ""))}`;
	if (cond.op === "in") {
		const values = Array.isArray(cond.value) ? cond.value : [cond.value || ""];
		return `(${values.map((v) => `${key} = ${traceqlValue(String(v))}`).join(" || ")})`;
	}
	return "";
}

function filterToTraceQL(filter: NormalizedFilter): string {
	if (filter.target === "spanName") {
		const values = Array.isArray(filter.value)
			? filter.value
			: [filter.value || ""];
		return `(${values.map((v) => `name = ${traceqlValue(String(v))}`).join(" || ")})`;
	}
	if (filter.target === "status") {
		const values = Array.isArray(filter.value)
			? filter.value.map(String)
			: [String(filter.value || "")];
		const wantsError = values.some((v) =>
			/error/i.test(v) || v === "STATUS_CODE_ERROR"
		);
		return wantsError ? `status = error` : `status != error`;
	}
	if (filter.target === "attribute" && filter.key) {
		const scope =
			filter.scope === "resource"
				? "resource"
				: filter.key.startsWith("service.") ||
					  filter.key === "deployment.environment" ||
					  filter.key.startsWith("k8s.") ||
					  filter.key.startsWith("telemetry.sdk")
					? "resource"
					: "span";
		const key = `${scope}.${filter.key}`;
		if (filter.op === "exists") return `${key} != ""`;
		if (filter.op === "eq")
			return `${key} = ${traceqlValue(String(filter.value ?? ""))}`;
		if (filter.op === "in") {
			const values = Array.isArray(filter.value)
				? filter.value
				: [filter.value || ""];
			return `(${values.map((v) => `${key} = ${traceqlValue(String(v))}`).join(" || ")})`;
		}
	}
	return "";
}

/** Build TraceQL `{ … }` from AI selector + OpenLITQuery filters. */
export function buildTempoSearchQuery(
	query: OpenLITQuery,
	opts?: { mostRecent?: boolean }
): string {
	const parts: string[] = [];
	if (query.aiSelector !== false) {
		const ai = tempoAISelectorQuery().replace(/^\{\s*|\s*\}$/g, "").trim();
		// The AI selector is a multi-group OR (`g1 || g2 || …`). TraceQL binds
		// `&&` tighter than `||`, so joining it with filters unparenthesized
		// (`g1 || g2 && service = "x"`) would scope only the LAST group and leak
		// every other service. Wrap it so filters constrain the whole selector.
		if (ai) parts.push(`(${ai})`);
	}
	for (const filter of query.filters || []) {
		const clause = filterToTraceQL(filter);
		if (clause) parts.push(clause);
	}
	const body = parts.length === 0 ? "{}" : `{ ${parts.join(" && ")} }`;
	// Tempo 2.8+: prefer time-ordered search so the newest traces surface first
	// within each service sample (still needs per-service fan-out for fairness).
	// Opt-in only — TraceQL metrics pipelines reject the `with` hint.
	if (opts?.mostRecent === true) {
		return `${body} with (most_recent=true)`;
	}
	return body;
}

export function tempoAISelectorQuery(
	selector: AITelemetrySelector = buildAITelemetrySelector()
): string {
	const groups = selector.anyOf.map((p) => {
		const parts = p.allOf.map(conditionToTraceQL).filter(Boolean);
		return parts.length === 1 ? parts[0] : `(${parts.join(" && ")})`;
	});
	return `{ ${groups.join(" || ")} }`;
}

// ─── TraceQL metrics helpers (server-side aggregation, Grafana-style) ──────────
//
// Tempo has no generic aggregation endpoint, but it exposes a Prometheus-style
// TraceQL metrics API (`/api/metrics/query_range`) that computes counts/sums/avgs
// over EVERY matching span in the window — not a bounded sample. Dashboards must
// use this so totals are accurate (a 200-trace sample reports "200" for every
// busy service). We fall back to the L1 sample only when metrics are unavailable.

/** Map an OpenLIT numeric field to a scoped TraceQL attribute reference. */
function metricAttrRef(field?: string): string {
	const f = (field || "").trim();
	if (!f) return "";
	if (f === "duration" || f === "Duration" || f === "durationNs") return "duration";
	if (f.startsWith("span.") || f.startsWith("resource.")) return f;
	if (
		f === "service.name" ||
		f.startsWith("service.") ||
		f === "deployment.environment" ||
		f.startsWith("k8s.") ||
		f.startsWith("telemetry.sdk")
	) {
		return `resource.${f}`;
	}
	return `span.${f}`;
}

/** Map a groupBy field to the attribute used in a metrics `by (...)` clause. */
function metricGroupByAttr(field: string): string | null {
	const f = (field || "").trim();
	if (!f) return null;
	if (f === "SpanName" || f === "spanName" || f === "name" || f === "Name") {
		return "name";
	}
	if (
		f === "service.name" ||
		f === "ServiceName" ||
		f === "serviceName" ||
		f === "resource.service.name" ||
		f === "applicationName"
	) {
		return "resource.service.name";
	}
	return metricAttrRef(f);
}

/** The TraceQL metric pipeline function for an aggregation, or null if unsupported. */
function aggregationToMetricExpr(
	fn: string,
	field?: string
): string | null {
	if (fn === "count") return "count_over_time()";
	const attr = metricAttrRef(field);
	if (!attr) return null;
	if (fn === "sum") return `sum_over_time(${attr})`;
	if (fn === "avg") return `avg_over_time(${attr})`;
	if (fn === "min") return `min_over_time(${attr})`;
	if (fn === "max") return `max_over_time(${attr})`;
	return null;
}

/**
 * Valid Tempo `step` (Go duration — no `d`/`w` units, so days become hours).
 * The count query and every companion metric query share this so their bucket
 * timestamps line up for a clean per-bucket merge.
 */
function msToTempoDuration(ms: number): string {
	// Tempo `step` is a Go duration and does not support `d`/`w`; days collapse
	// to hours (e.g. 24h) so bucket timestamps still line up.
	const s = Math.max(1, Math.round(ms / 1000));
	if (s % 3600 === 0) return `${s / 3600}h`;
	if (s % 60 === 0) return `${s / 60}m`;
	return `${s}s`;
}

/**
 * Pixel-bounded Tempo metrics `step`. Derives the bucket from the range and
 * `maxDataPoints` (Grafana math) — or an explicit `interval` — and clamps the
 * point count so a wide window can't return an unbounded series. The count
 * query and every companion metric query share this so bucket timestamps line
 * up for a clean per-bucket merge.
 */
function metricsStepForQuery(query: OpenLITQuery): string {
	const rangeMs =
		query.timeRange.end.getTime() - query.timeRange.start.getTime();
	const stepMs = clampStepMs(rangeMs, computeIntervalMs(query));
	return msToTempoDuration(stepMs);
}

interface TempoMetricsSample {
	timestampMs?: string | number;
	timestamp_ms?: string | number;
	value?: string | number;
}
interface TempoMetricsSeriesLabel {
	key?: string;
	value?: { stringValue?: string; string_value?: string } | string;
}
interface TempoMetricsSeries {
	labels?: TempoMetricsSeriesLabel[];
	samples?: TempoMetricsSample[];
	values?: [number, number][];
}
function splitTempoMetricWindows(
	timeRange: QueryTimeRange,
	maxWindowMs: number
): QueryTimeRange[] {
	const windows: QueryTimeRange[] = [];
	let cursor = timeRange.start.getTime();
	const end = timeRange.end.getTime();
	while (cursor < end) {
		const next = Math.min(end, cursor + maxWindowMs);
		windows.push({ start: new Date(cursor), end: new Date(next) });
		cursor = next;
	}
	return windows.length ? windows : [timeRange];
}

function normalizedMetricRowsToSeries(
	rows: Record<string, unknown>[]
): TempoMetricsSeries[] {
	const grouped = new Map<
		string,
		{ labels: Record<string, string>; samples: Map<number, number> }
	>();
	for (const row of rows) {
		const labels = stringMap(row.labels);
		const key = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
		let series = grouped.get(key);
		if (!series) {
			series = { labels, samples: new Map() };
			grouped.set(key, series);
		}
		const timestamp = Date.parse(String(row.timestamp || ""));
		const value = Number(row.value);
		if (Number.isFinite(timestamp) && Number.isFinite(value)) {
			// Adjacent inclusive Tempo windows can repeat their boundary bucket.
			// Overwrite that identical timestamp instead of double-counting it.
			series.samples.set(timestamp, value);
		}
	}
	return Array.from(grouped.values()).map(({ labels, samples }) => ({
		labels: Object.entries(labels).map(([key, value]) => ({ key, value })),
		samples: Array.from(samples.entries())
			.sort(([left], [right]) => left - right)
			.map(([timestampMs, value]) => ({ timestampMs, value })),
	}));
}

/** Extract a series' grouping label value (defensive across JSON shapes). */
function seriesLabelValue(series: TempoMetricsSeries, attr: string | null): string {
	if (!attr) return "";
	// Tempo emits the group label under the bare attribute name (e.g.
	// `service.name`) as well as the scoped form; accept either.
	const bare = attr.replace(/^(resource|span)\./, "");
	for (const label of series.labels || []) {
		if (label.key !== attr && label.key !== bare) continue;
		const v = label.value;
		if (typeof v === "string") return v;
		if (v && typeof v === "object") {
			return String(v.stringValue ?? v.string_value ?? "");
		}
	}
	return "";
}

/** Parse a series' data points into `{ tsMs, value }`, tolerating both shapes. */
function seriesBuckets(
	series: TempoMetricsSeries
): Array<{ ts: number; value: number }> {
	if (Array.isArray(series.samples)) {
		return series.samples.map((s) => ({
			ts: Number(s.timestampMs ?? s.timestamp_ms ?? 0),
			value: Number(s.value ?? 0),
		}));
	}
	if (Array.isArray(series.values)) {
		// `[secondsEpoch, value]` tuples.
		return series.values.map(([ts, v]) => ({ ts: Number(ts) * 1000, value: Number(v) }));
	}
	return [];
}

export class TempoAdapter extends BaseExternalAdapter {
	readonly type = "tempo";
	private authCache?: {
		expiresAt: number;
		headers: Record<string, string>;
		redact: string[];
	};

	private get baseUrl(): string {
		return String(this.descriptor.settings.url || "").replace(/\/$/, "");
	}

	private get networkOpts() {
		return selfHostedNetworkOptions(this.descriptor.settings);
	}

	private get configuredMaxTimeRangeMs(): number | undefined {
		const explicitMs = Number(this.descriptor.settings.maxTimeRangeMs);
		const explicitDays = Number(this.descriptor.settings.maxTimeRangeDays);
		return (
			Number.isFinite(explicitMs) && explicitMs > 0
				? Math.max(60_000, Math.floor(explicitMs))
				: Number.isFinite(explicitDays) && explicitDays > 0
					? Math.max(60_000, Math.floor(explicitDays * 24 * 60 * 60 * 1_000))
					: undefined
		);
	}

	private get maxTimeRangeMs(): number | undefined {
		const configured = this.configuredMaxTimeRangeMs;
		const learned = learnedSearchRangeBySource.get(this.descriptor.id);
		if (configured === undefined) return learned;
		return learned === undefined ? configured : Math.min(configured, learned);
	}

	private get configuredMaxSearchResults(): number | undefined {
		const value = Number(
			this.descriptor.settings.maxSearchResults ??
				this.descriptor.settings.maxResultRows
		);
		return Number.isSafeInteger(value) && value > 0 ? value : undefined;
	}

	private searchResultLimit(requested: number): number {
		const limits = [
			Math.max(1, Math.floor(requested)),
			this.configuredMaxSearchResults,
			learnedSearchLimitBySource.get(this.descriptor.id),
		].filter((value): value is number => value !== undefined);
		return Math.max(1, Math.min(...limits));
	}

	private cachedTempoProfile(): CachedTempoProfile | undefined {
		const cached = tempoProfileBySource.get(this.descriptor.id);
		return cached && cached.expiresAt > Date.now() ? cached : undefined;
	}

	private rememberTempoProfile(profile: TempoServerCapabilities): void {
		tempoProfileBySource.set(this.descriptor.id, {
			...profile,
			expiresAt: Date.now() + TEMPO_PROFILE_TTL_MS,
		});
	}

	private async authHeaders() {
		if (this.authCache && this.authCache.expiresAt > Date.now()) {
			return this.authCache;
		}
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId,
			this.descriptor.projectId
		);
		const headers = applyHttpAuthCredentials(secret.credentials, {
			authType: this.descriptor.settings.authType as string | undefined,
			tenantHeader: "X-Scope-OrgID",
		});
		const authType = String(
			this.descriptor.settings.authType || "auto"
		).toLowerCase();
		if ((authType === "basic" || authType === "bearer") && !headers.Authorization) {
			throw new Error(
				getMessage().DATA_SOURCE_AUTH_REQUIRED(this.descriptor.name, authType)
			);
		}
		this.authCache = {
			expiresAt: Date.now() + TTL_MS,
			headers,
			redact: redactableSecretValues(secret),
		};
		return this.authCache;
	}

	/**
	 * Bind OpenPlait's Tempo adapter to OpenLIT's guarded HTTP transport. The
	 * package owns TraceQL execution and response normalization; OpenLIT keeps
	 * project-scoped secrets, SSRF policy, redaction, caching, and concurrency.
	 */
	private async openPlaitAdapter(): Promise<OpenPlaitTempoAdapter> {
		const { headers, redact } = await this.authHeaders();
		const guardedFetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit
		): Promise<Response> => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			const requestHeaders = Object.fromEntries(
				new Headers(init?.headers).entries()
			);
			let payload: unknown;
			try {
				payload = await safeFetch<unknown>(url, {
					method: init?.method || "GET",
					headers: requestHeaders,
					...this.networkOpts,
					redactValues: redact,
					timeoutMs: 15_000,
					concurrencyKey: this.descriptor.id,
					maxConcurrent: TRACE_FETCH_CONCURRENCY,
					retry: true,
				});
			} catch (error) {
				if (error instanceof SourceResponseError) {
					return {
						ok: false,
						status: error.status,
						statusText: "Upstream Tempo error",
						headers: new Headers({ "Content-Type": "text/plain" }),
						json: async () => ({ error: error.message }),
						text: async () => error.message,
					} as Response;
				}
				throw error;
			}
			// safeFetch has already performed the HTTP request and parsed JSON. A
			// lightweight Fetch Response keeps the OpenPlait transport boundary
			// portable across Node and Jest/jsdom without serializing it twice.
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Headers({ "Content-Type": "application/json" }),
				json: async () => payload,
				text: async () => JSON.stringify(payload),
			} as Response;
		}) as typeof fetch;
		const profile = this.cachedTempoProfile();
		const maxTimeRangeMs = this.maxTimeRangeMs;
		const configuredVersion = String(
			this.descriptor.settings.tempoVersion || profile?.version || ""
		).trim();
		const config: TempoAdapterConfig = {
			url: this.baseUrl,
			httpHeaders: headers,
			allowNativeQueries: true,
			requestTimeoutMs: 15_000,
			queryTimeoutMs: 15_000,
			maxResultRows: this.searchResultLimit(MAX_TRACE_SEARCH),
			maxSpansPerSpanSet: 100,
			...(maxTimeRangeMs === undefined ? {} : { maxTimeRangeMs }),
			...(configuredVersion ? { tempoVersion: configuredVersion } : {}),
			...(typeof this.descriptor.settings.enableMostRecent === "boolean"
				? { enableMostRecent: this.descriptor.settings.enableMostRecent }
				: profile?.features.mostRecent === null || profile?.features.mostRecent === undefined
					? {}
					: { enableMostRecent: profile.features.mostRecent }),
			...(profile?.features.traceqlMetrics === null || profile?.features.traceqlMetrics === undefined
				? {}
				: { enableTraceqlMetrics: profile.features.traceqlMetrics }),
			...(profile?.features.tagSearchV2 === null || profile?.features.tagSearchV2 === undefined
				? {}
				: { enableTagSearchV2: profile.features.tagSearchV2 }),
		};
		return new OpenPlaitTempoAdapter(config, { fetch: guardedFetch });
	}

	private async inspectTempoServer(): Promise<TempoServerCapabilities> {
		const cached = this.cachedTempoProfile();
		if (cached) return cached;
		const adapter = await this.openPlaitAdapter();
		const profile = await adapter.inspectServer({ timeoutMs: 8_000 });
		this.rememberTempoProfile(profile);
		return profile;
	}

	private async openPlaitTraceSearchRows(
		traceql: string,
		timeRange: QueryTimeRange,
		limit: number,
		compatibility: { hint?: boolean; range?: boolean; resultLimit?: boolean } = {}
	): Promise<Record<string, unknown>[]> {
		const requestLimit = this.searchResultLimit(limit);
		const adapter = await this.openPlaitAdapter();
		const resource: NativeQuery = {
			apiVersion: OPENPLAIT_API_VERSION,
			kind: "Query",
			metadata: { name: "openlit-tempo-search" },
			spec: {
				mode: "native",
				datasource: {
					kind: "TempoDatasource",
					name: this.descriptor.id,
				},
				native: { language: "traceql", statement: traceql },
				extensions: {
					"io.openplait.tempo": {
						timeRange: {
							from: timeRange.start.toISOString(),
							to: timeRange.end.toISOString(),
						},
						limit: requestLimit,
						spansPerSpanSet: 100,
					},
				},
			},
		};
		try {
			const result = await adapter.execute(resource, {
				audit: {
					requestId: safeRequestId(this.descriptor.id, "search"),
				},
			});
			return openPlaitFramesToRows(result.frames);
		} catch (error) {
			const rangeMs = timeRange.end.getTime() - timeRange.start.getTime();
			const status = adapterErrorStatus(error);
			const body = adapterErrorBody(error);
			const reportedMaxResults =
				status === 400 ? reportedMaxSearchLimit(body) : undefined;
			if (
				compatibility.resultLimit !== false &&
				reportedMaxResults !== undefined &&
				reportedMaxResults < requestLimit
			) {
				learnedSearchLimitBySource.set(
					this.descriptor.id,
					reportedMaxResults
				);
				return this.openPlaitTraceSearchRows(
					traceql,
					timeRange,
					reportedMaxResults,
					{ ...compatibility, resultLimit: false }
				);
			}
			if (
				compatibility.hint !== false &&
				status === 400 &&
				withoutMostRecentHint(traceql) !== traceql
			) {
				const cached = this.cachedTempoProfile();
				if (cached) {
					this.rememberTempoProfile({
						...cached,
						features: { ...cached.features, mostRecent: false },
					});
				}
				return this.openPlaitTraceSearchRows(
					withoutMostRecentHint(traceql),
					timeRange,
					limit,
					{ ...compatibility, hint: false }
				);
			}
			const reportedMaxMs = status === 400 ? reportedMaxDurationMs(body) : undefined;
			if (
				compatibility.range !== false &&
				reportedMaxMs !== undefined &&
				rangeMs > reportedMaxMs
			) {
				learnedSearchRangeBySource.set(this.descriptor.id, reportedMaxMs);
				const compatibleRange = {
					start: new Date(
						timeRange.end.getTime() - reportedMaxMs
					),
					end: timeRange.end,
				};
				return this.openPlaitTraceSearchRows(
					traceql,
					compatibleRange,
					limit,
					{ ...compatibility, range: false }
				);
			}
			throw error;
		}
	}

	private async openPlaitTraceSearch(
		traceql: string,
		timeRange: QueryTimeRange,
		limit: number
	): Promise<string[]> {
		return (await this.openPlaitTraceSearchRows(traceql, timeRange, limit))
			.map((row) => normalizeOtlpId(String(row["trace.id"] || "")))
			.filter(Boolean);
	}

	capabilities(): SourceCapabilities {
		const maxTimeRangeMs = this.maxTimeRangeMs;
		return {
			signals: ["traces"],
			traceTree: true,
			spanEvents: true,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			...(maxTimeRangeMs === undefined ? {} : { maxTimeRangeMs }),
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const start = Date.now();
		try {
			await this.inspectTempoServer();
			return { ok: true, latencyMs: Date.now() - start };
		} catch (err) {
			const status = adapterErrorStatus(err);
			// Some managed Tempo gateways deliberately hide `/api/status/buildinfo`.
			// A small, hint-free search still proves endpoint/auth compatibility,
			// while leaving version-dependent capabilities conservatively disabled.
			if (status === 403 || status === 404) {
				try {
					const end = new Date();
					await this.openPlaitTraceSearchRows(
						"{}",
						{ start: new Date(end.getTime() - 5 * 60 * 1_000), end },
						1,
						{ hint: false, range: false }
					);
					return { ok: true, latencyMs: Date.now() - start };
				} catch (searchErr) {
					err = searchErr;
				}
			}
			return { ok: false, message: String((err as Error)?.message || err) };
		}
	}

	private async searchTraceIds(
		query: OpenLITQuery,
		limit: number
	): Promise<string[]> {
		const boundedQuery = clampQueryToSource(this, query).query;
		const traceql = buildTempoSearchQuery(boundedQuery, {
			mostRecent:
				this.descriptor.settings.enableMostRecent === true ||
				this.cachedTempoProfile()?.features.mostRecent === true,
		});
		const key = cacheKey(this.descriptor.id, [
			"openplait-search",
			traceql,
			boundedQuery.timeRange.start.toISOString(),
			boundedQuery.timeRange.end.toISOString(),
			limit,
		]);
		return cachedQuery(key, TTL_MS, () =>
			this.openPlaitTraceSearch(traceql, boundedQuery.timeRange, limit)
		);
	}

	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		const id = normalizeOtlpId(traceId) || traceId;
		const key = cacheKey(this.descriptor.id, ["openplait-trace", id]);
		const result = await cachedQuery(key, TTL_MS, async () => {
			const adapter = await this.openPlaitAdapter();
			return adapter.getTrace(id, {
				audit: {
					requestId: safeRequestId(this.descriptor.id, "trace"),
				},
			});
		});
		const spans = openPlaitRowsToSpans(openPlaitFramesToRows(result.frames));
		rememberSpans(this.descriptor.id, spans);
		return spans;
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		const id = normalizeOtlpId(spanId) || spanId;
		const cached = lookupIndexedSpan(this.descriptor.id, id);
		if (cached) {
			return cached;
		}

		// Tempo has no direct span API. Prefer OpenPlait TraceQL by hex span id
		// (Grafana Explore pattern: resolve trace, then fetch once).
		// Tempo's search endpoint otherwise uses its short default lookback,
		// which makes a valid span appear missing when the detail request is
		// made after the list query. Keep the span-only fallback aligned with
		// the normal observability lookback.
		const end = new Date();
		const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1_000);
		const traceql = `{ span:id = ${traceqlValue(id)} }`;
		try {
			const traceIds = await this.openPlaitTraceSearch(
				traceql,
				{ start, end },
				1
			);
			const traceId = traceIds[0];
			if (!traceId) {
				return null;
			}
			const spans = await this.getTraceSpans(traceId);
			const result =
				spans.find((s) => s.spanId === id || s.spanId === spanId) || null;
			return result;
		} catch {
			return null;
		}
	}

	/**
	 * Download full OTLP for each TraceQL hit (needed for events / gen_ai
	 * bodies). Fetches in parallel with a concurrency cap — Grafana Explore
	 * only loads one trace on click; we still need samples for list/agents.
	 */
	private async fetchSampledSpans(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		// Keep a reserve of candidates so an oversized/deleted trace does not
		// collapse the list. Grafana Cloud can return a valid search hit whose
		// full OTLP payload exceeds its per-trace response limit (HTTP 422).
		const candidateLimit = Math.min(
			MAX_TRACE_FETCH,
			Math.max(maxTraces, maxTraces * 2)
		);
		const ids = await this.searchTraceIds(query, candidateLimit);
		const perTrace = await mapPool(
			ids,
			TRACE_FETCH_CONCURRENCY,
			async (id) => {
				try {
					return await this.getTraceSpans(id);
				} catch (error) {
					const status = adapterErrorStatus(error);
					if (status !== 404 && status !== 413 && status !== 422) throw error;
					return [];
				}
			}
		);
		return perTrace.filter((spans) => spans.length > 0).slice(0, maxTraces).flat();
	}

	async listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		const start = Date.now();
		const pageSize = Math.min(query.limit || 20, MAX_TRACE_FETCH);
		const offset = Math.max(0, query.offset || 0);
		// Prefer TraceQL search summaries for the Telemetry list (one row per
		// trace). Full OTLP downloads are reserved for detail / graph sample
		// paths — Explore also only loads a full tree on click.
		const { rows: summaries, truncated, effectiveLimit } =
			await this.traceSummaryRows(query);
		const page = summaries.slice(offset, offset + pageSize);
		const rows: NormalizedSpan[] = page.map((row) => {
			const traceId = normalizeOtlpId(String(row["trace.id"] || ""));
			return {
				traceId,
				spanId: traceId,
				parentSpanId: "",
				name: String(row["root.span.name"] || ""),
				serviceName: String(row["root.service.name"] || ""),
				timestamp: String(row.timestamp || ""),
				durationNs: Math.max(0, Number(row.duration || 0) * 1_000_000),
				statusCode: "",
				spanAttributes: {},
				resourceAttributes: {},
			};
		});
		return {
			fields: [],
			rows,
			meta: {
				latencyMs: Date.now() - start,
				rowsScanned: summaries.length,
				truncated: truncated || summaries.length >= effectiveLimit,
				degraded: ["serverAggregation"],
			},
		};
	}

	async sampleTracesForGraph(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		// Stratification (multi-service fan-out) lives in shared
		// `fetchSpansForAggregation` so all L1 backends benefit. Per-service
		// calls land here with a single service.name filter.
		return this.fetchSampledSpans(query, Math.min(maxTraces, MAX_TRACE_FETCH));
	}

	/**
	 * Server-side aggregation via Tempo TraceQL metrics (accurate over the whole
	 * window), falling back to the bounded L1 sample only when metrics are
	 * unavailable. This is what stops dashboards from reporting the 200-trace
	 * sample cap as the "total".
	 */
	async aggregateSpans(query: OpenLITQuery): Promise<DataFrame> {
		try {
			const native = await this.nativeAggregate(query);
			if (native) return native;
		} catch {
			// Any metrics failure -> sample fallback below.
		}
		return computeAggregateSpansL1(this, query);
	}

	private async traceSummaryRows(
		query: OpenLITQuery
	): Promise<{
		rows: Record<string, unknown>[];
		truncated: boolean;
		effectiveLimit: number;
	}> {
		const boundedQuery = clampQueryToSource(this, query).query;
		const traceql = buildTempoSearchQuery(boundedQuery, {
			mostRecent:
				this.descriptor.settings.enableMostRecent === true ||
				this.cachedTempoProfile()?.features.mostRecent === true,
		});
		const key = cacheKey(this.descriptor.id, [
			"openplait-trace-summaries",
			traceql,
			boundedQuery.timeRange.start.toISOString(),
			boundedQuery.timeRange.end.toISOString(),
		]);
		const rows = await cachedQuery(key, TTL_MS, () =>
			this.openPlaitTraceSearchRows(
				traceql,
				boundedQuery.timeRange,
				MAX_TRACE_SEARCH
			)
		);
		const effectiveLimit = this.searchResultLimit(MAX_TRACE_SEARCH);
		return {
			rows: rows.slice(0, TRACE_SUMMARY_CAP),
			// Tempo search has no offset/cursor. Hitting either OpenLIT's cap or
			// the negotiated server cap means the result must be presented as a
			// bounded sample, even when the backend returned exactly that limit.
			truncated:
				rows.length > TRACE_SUMMARY_CAP ||
				(effectiveLimit <= TRACE_SUMMARY_CAP && rows.length >= effectiveLimit),
			effectiveLimit,
		};
	}

	/** Trace-row count for stable Tempo list pagination (not child-span count). */
	async countTraces(
		query: OpenLITQuery
	): Promise<{ total: number; truncated: boolean }> {
		const result = await this.traceSummaryRows(query);
		return { total: result.rows.length, truncated: result.truncated };
	}

	/** Exact matching span count for list pagination, independent of the sample cap. */
	async countSpans(query: OpenLITQuery): Promise<number | null> {
		const boundedQuery = clampQueryToSource(this, query).query;
		const series = await this.fetchMetricsSeries(
			`${buildTempoSearchQuery(boundedQuery)} | count_over_time()`,
			boundedQuery.timeRange,
			metricsStepForQuery(boundedQuery)
		);
		if (!series) return null;
		return series.reduce(
			(total, item) =>
				total + seriesBuckets(item).reduce((sum, bucket) => sum + bucket.value, 0),
			0
		);
	}

	/**
	 * Build the Telemetry trace-volume chart from Tempo search summaries.
	 * Search already returns one row per trace with its start time and duration,
	 * so this stays trace-correct and avoids downloading every child span when
	 * TraceQL metrics are unavailable.
	 */
	async traceTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		const startedAt = Date.now();
		const { rows, truncated, effectiveLimit } = await this.traceSummaryRows(query);
		const summaries: NormalizedSpan[] = rows
			.map((row) => {
				const traceId = normalizeOtlpId(String(row["trace.id"] || ""));
				return {
					traceId,
					spanId: traceId,
					parentSpanId: "",
					name: String(row["root.span.name"] || ""),
					serviceName: String(row["root.service.name"] || ""),
					timestamp: String(row.timestamp || ""),
					durationNs: Math.max(0, Number(row.duration || 0) * 1_000_000),
					statusCode: "",
					spanAttributes: {},
					resourceAttributes: {},
				};
			})
			.filter((span) => span.traceId && !Number.isNaN(Date.parse(span.timestamp)));
		const frame = bucketSpansByInterval(
			summaries,
			query.interval || "1h",
			query.aggregations || [{ fn: "count" }],
			query.timeRange
		);
		return {
			...frame,
			meta: {
				...frame.meta,
				truncated,
				rowsScanned: summaries.length,
				latencyMs: Date.now() - startedAt,
				freshness: truncated ? "sampled" : "live",
				...(truncated ? { degraded: ["traceSummaryLimit"] } : {}),
			},
		};
	}

	async spanTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		try {
			const native = await this.nativeSpanTimeSeries(query);
			if (native) return native;
		} catch {
			// fall through to sample compute
		}
		return computeSpanTimeSeriesL1(this, query);
	}

	/** GET `/api/metrics/query_range` and return raw series (null on failure). */
	private async fetchMetricsSeries(
		metricQuery: string,
		timeRange: QueryTimeRange,
		step: string
	): Promise<TempoMetricsSeries[] | null> {
		if (this.cachedTempoProfile()?.features.traceqlMetrics === false) return null;
		const explicitMs = Number(this.descriptor.settings.metricsMaxTimeRangeMs);
		const explicitHours = Number(
			this.descriptor.settings.metricsMaxTimeRangeHours
		);
		const maxWindowMs =
			Number.isFinite(explicitMs) && explicitMs > 0
				? explicitMs
				: Number.isFinite(explicitHours) && explicitHours > 0
					? explicitHours * 60 * 60 * 1000
					: DEFAULT_TEMPO_METRICS_WINDOW_MS;
		const windows = splitTempoMetricWindows(timeRange, maxWindowMs);
		const key = cacheKey(this.descriptor.id, [
			"openplait-metrics-range",
			metricQuery,
			timeRange.start.toISOString(),
			timeRange.end.toISOString(),
			step,
			maxWindowMs,
		]);
		try {
			return await cachedQuery(key, TTL_MS, async () => {
				const adapter = await this.openPlaitAdapter();
				const windowResults = await mapPool(
					windows,
					TRACE_FETCH_CONCURRENCY,
					async (window) => {
						const result = await adapter.queryMetrics(
							{
								query: metricQuery,
								from: window.start.toISOString(),
								to: window.end.toISOString(),
								step,
							},
							{
								audit: {
									requestId: safeRequestId(this.descriptor.id, "metrics"),
								},
							}
						);
						return openPlaitFramesToRows(result.frames);
					}
				);
				return normalizedMetricRowsToSeries(windowResults.flat());
			});
		} catch (error) {
			if (adapterErrorStatus(error) === 404) {
				const profile = this.cachedTempoProfile();
				if (profile) {
					this.rememberTempoProfile({
						...profile,
						features: { ...profile.features, traceqlMetrics: false },
					});
				}
			}
			return null;
		}
	}

	/**
	 * Compute count / sum / avg (optionally grouped) via TraceQL metrics. Returns
	 * null when the anchor count query can't run so the caller can fall back to
	 * the L1 sample. An empty result (no matching spans) is a valid "0", not a
	 * fallback trigger.
	 */
	private async nativeAggregate(
		query: OpenLITQuery
	): Promise<DataFrame | null> {
		const aggregations = query.aggregations?.length
			? query.aggregations
			: [{ fn: "count" as const, as: "count" }];
		const groupField = query.groupBy?.[0];
		const groupAttr = groupField ? metricGroupByAttr(groupField) : null;
		const selector = buildTempoSearchQuery(query);
		const step = metricsStepForQuery(query);
		const byClause = groupAttr ? ` by (${groupAttr})` : "";

		const sumSeries = async (expr: string) => {
			const series = await this.fetchMetricsSeries(
				`${selector} | ${expr}${byClause}`,
				query.timeRange,
				step
			);
			if (!series) return null;
			const totals = new Map<string, number>();
			for (const s of series) {
				const gv = seriesLabelValue(s, groupAttr);
				const total = seriesBuckets(s).reduce((a, b) => a + b.value, 0);
				totals.set(gv, (totals.get(gv) ?? 0) + total);
			}
			return totals;
		};

		// Anchor on count: it both establishes the groups and weights averages.
		const countTotals = await sumSeries("count_over_time()");
		if (!countTotals) return null;

		const groups = groupField
			? Array.from(countTotals.keys())
			: [""];
		const rows: Record<string, unknown>[] = groups.map((gv) => {
			const row: Record<string, unknown> = { group_value: gv };
			if (groupField) row[groupField] = gv;
			return row;
		});
		const rowFor = (gv: string) =>
			rows.find((r) => r.group_value === gv) ?? rows[0];

		for (const agg of aggregations) {
			const as = agg.as || agg.fn;
			if (agg.fn === "count") {
				for (const gv of groups) rowFor(gv)[as] = countTotals.get(gv) ?? 0;
				continue;
			}
			if (agg.fn === "avg") {
				// Weighted average over the window: sum(field) / count.
				const attr = metricAttrRef(agg.field);
				const sums = attr ? await sumSeries(`sum_over_time(${attr})`) : null;
				for (const gv of groups) {
					const count = countTotals.get(gv) ?? 0;
					const sum = sums?.get(gv) ?? 0;
					let v = count > 0 ? sum / count : 0;
					if (agg.field === "duration") v = v / 1e9; // ns -> seconds
					rowFor(gv)[as] = v;
				}
				continue;
			}
			// sum / min / max
			const expr = aggregationToMetricExpr(agg.fn, agg.field);
			const totals = expr ? await sumSeries(expr) : null;
			for (const gv of groups) {
				let v = totals?.get(gv) ?? 0;
				if (agg.field === "duration") v = v / 1e9;
				rowFor(gv)[as] = v;
			}
		}

		return {
			fields: [],
			rows,
			meta: { freshness: "live", truncated: false },
		};
	}

	/**
	 * Per-bucket time series via TraceQL metrics. Count is the anchor; cost /
	 * tokens / duration are merged onto the same buckets (identical step keeps
	 * timestamps aligned). `avg_over_time` is already a per-bucket average, so no
	 * weighting is needed here.
	 */
	private async nativeSpanTimeSeries(
		query: OpenLITQuery
	): Promise<DataFrame | null> {
		const selector = buildTempoSearchQuery(query);
		const step = metricsStepForQuery(query);
		const aggregations = query.aggregations?.length
			? query.aggregations
			: [{ fn: "count" as const, as: "count" }];

		const countSeries = await this.fetchMetricsSeries(
			`${selector} | count_over_time()`,
			query.timeRange,
			step
		);
		if (!countSeries) return null;

		const buckets = new Map<number, Record<string, number>>();
		const bucketAt = (ts: number) => {
			let b = buckets.get(ts);
			if (!b) {
				b = {};
				buckets.set(ts, b);
			}
			return b;
		};
		for (const s of countSeries) {
			for (const p of seriesBuckets(s)) {
				bucketAt(p.ts).count = (bucketAt(p.ts).count ?? 0) + p.value;
			}
		}

		for (const agg of aggregations) {
			if (agg.fn === "count") continue;
			const expr = aggregationToMetricExpr(agg.fn, agg.field);
			if (!expr) continue;
			const series = await this.fetchMetricsSeries(
				`${selector} | ${expr}`,
				query.timeRange,
				step
			);
			if (!series) continue;
			const as = agg.as || agg.fn;
			const perTs = new Map<number, number[]>();
			for (const s of series) {
				for (const p of seriesBuckets(s)) {
					const arr = perTs.get(p.ts) ?? [];
					arr.push(p.value);
					perTs.set(p.ts, arr);
				}
			}
			for (const [ts, arr] of Array.from(perTs.entries())) {
				let v =
					agg.fn === "avg"
						? arr.reduce((a, b) => a + b, 0) / arr.length
						: arr.reduce((a, b) => a + b, 0);
				if (agg.field === "duration") v = v / 1e9;
				bucketAt(ts)[as] = v;
			}
		}

		const sorted = Array.from(buckets.keys()).sort((a, b) => a - b);
		const rows = sorted.map((ts) => {
			const iso = new Date(ts).toISOString();
			return {
				bucket: iso,
				label: iso,
				request_time: iso,
				count: 0,
				...buckets.get(ts),
			};
		});
		return {
			fields: [],
			rows,
			meta: { freshness: "live", truncated: false },
		};
	}

	async distinctValues(key: string, query: OpenLITQuery): Promise<string[]> {
		if (key === "service.name" || key === "ServiceName") {
			try {
				const discovered = await this.discoverServices(query.timeRange);
				if (discovered.length) {
					return discovered.map((d) => d.serviceName).filter(Boolean);
				}
			} catch {
				// Fall through to L1 sample.
			}
		}
		return computeDistinctValuesL1(this, key, query);
	}

	/**
	 * Enumerate tag values via Tempo's search-tag APIs (v2 then v1).
	 * This is how we discover *all* services in the window without depending
	 * on a recency-biased TraceQL search sample.
	 */
	private async searchTagValues(
		tag: string,
		window: QueryTimeRange,
		traceQlFilter?: string
	): Promise<string[]> {
		const boundedWindow = clampQueryToSource(this, {
			signal: "traces",
			timeRange: window,
			limit: 50,
		}).query.timeRange;
		try {
			const key = cacheKey(this.descriptor.id, [
				"openplait-tag-values",
				tag,
				boundedWindow.start.toISOString(),
				boundedWindow.end.toISOString(),
				traceQlFilter || "",
			]);
			const values = await cachedQuery(key, TTL_MS, async () => {
				const adapter = await this.openPlaitAdapter();
				return adapter.discoverTagValues(
					tag,
					{ timeoutMs: 15_000 },
					{
						...(traceQlFilter ? { query: traceQlFilter } : {}),
						range: {
							from: boundedWindow.start.toISOString(),
							to: boundedWindow.end.toISOString(),
						},
					}
				);
			});
			if (values.length) return Array.from(new Set(values)).slice(0, 50);
		} catch {
			// Older Tempo releases may not expose the v2 endpoint; use v1 below.
		}

		const { headers, redact } = await this.authHeaders();
		try {
			const url = new URL(
				`${this.baseUrl}/api/search/tag/${encodeURIComponent(tag)}/values`
			);
			url.searchParams.set(
				"start",
				String(Math.floor(boundedWindow.start.getTime() / 1000))
			);
			url.searchParams.set(
				"end",
				String(Math.floor(boundedWindow.end.getTime() / 1000))
			);
			url.searchParams.set("limit", "50");
			const response = await safeFetch<{ tagValues?: string[] }>(url.toString(), {
				headers,
				...this.networkOpts,
				redactValues: redact,
				timeoutMs: 15_000,
			});
			return Array.from(new Set(response?.tagValues || [])).filter(Boolean);
		} catch {
			return [];
		}
	}

	async discoverServices(window: QueryTimeRange): Promise<DiscoveredService[]> {
		const aiFilter = tempoAISelectorQuery();
		let names = await this.searchTagValues(
			"resource.service.name",
			window,
			aiFilter
		);
		if (!names.length) {
			names = await this.searchTagValues("service.name", window, aiFilter);
		}
		if (!names.length) {
			names = await this.searchTagValues("resource.service.name", window);
		}
		if (!names.length) {
			names = await this.searchTagValues("service.name", window);
		}

		if (names.length > 0) {
			return names.slice(0, 50).map((serviceName) => ({
				serviceName,
				environment: "default",
				clusterId: "default",
			}));
		}

		// Fallback: biased sample (last resort when tag APIs are disabled).
		const spans = await this.fetchSampledSpans(
			{ signal: "traces", timeRange: window, aiSelector: true, limit: 100 },
			100
		);
		const byService = new Map<string, DiscoveredService>();
		for (const span of spans) {
			const name = span.serviceName || span.resourceAttributes["service.name"];
			if (!name || byService.has(name)) continue;
			byService.set(name, {
				serviceName: name,
				environment:
					span.resourceAttributes["deployment.environment"] || "default",
				clusterId: span.resourceAttributes["k8s.cluster.name"] || "default",
				sdkName: span.resourceAttributes["telemetry.sdk.name"],
				sdkLanguage: span.resourceAttributes["telemetry.sdk.language"],
				sdkVersion: span.resourceAttributes["telemetry.sdk.version"],
				firstSeen: span.timestamp,
				lastSeen: span.timestamp,
			});
		}
		return Array.from(byService.values());
	}

	async aggregateByService(window: QueryTimeRange): Promise<ServiceRollup[]> {
		const spans = await this.fetchSampledSpans(
			{ signal: "traces", timeRange: window, aiSelector: true, limit: 100 },
			100
		);
		const byKey = new Map<
			string,
			ServiceRollup & { modelSet: Set<string>; providerSet: Set<string> }
		>();
		for (const span of spans) {
			const serviceName =
				span.serviceName || span.resourceAttributes["service.name"] || "";
			if (!serviceName) continue;
			const environment =
				span.resourceAttributes["deployment.environment"] || "default";
			const clusterId =
				span.resourceAttributes["k8s.cluster.name"] || "default";
			const key = `${clusterId}|${environment}|${serviceName}`;
			let row = byKey.get(key);
			if (!row) {
				row = {
					serviceName,
					environment,
					clusterId,
					requestCount: 0,
					models: [],
					providers: [],
					modelSet: new Set(),
					providerSet: new Set(),
				};
				byKey.set(key, row);
			}
			row.requestCount += 1;
			const model = span.spanAttributes["gen_ai.request.model"];
			const provider = span.spanAttributes["gen_ai.system"];
			if (model) row.modelSet.add(model);
			if (provider) row.providerSet.add(provider);
		}
		return Array.from(byKey.values()).map(
			({ modelSet, providerSet, ...rest }) => ({
				...rest,
				models: Array.from(modelSet),
				providers: Array.from(providerSet),
			})
		);
	}

	async validateAISignal(window: QueryTimeRange): Promise<AISignalValidation> {
		try {
			const ids = await this.searchTraceIds(
				{ signal: "traces", timeRange: window, aiSelector: true },
				1
			);
			return { ok: ids.length > 0, sampleCount: ids.length, missingAttributes: [] };
		} catch (err) {
			return {
				ok: false,
				sampleCount: 0,
				missingAttributes: [],
				message: String((err as Error)?.message || err),
			};
		}
	}
}

export const tempoAdapterFactory = {
	type: "tempo",
	create: (descriptor: TelemetrySourceDescriptor) => new TempoAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "tempo",
		displayName: "Grafana Tempo",
		declaredSignals: ["traces"],
		capabilities: {
			traceTree: true,
			spanEvents: true,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: {
			crossSignal: true,
			keys: ["traceId", "spanId", "service"],
		},
		configFields: [
			...httpVendorFields({
				placeholder: "https://tempo-prod-xxx.grafana.net/tempo",
				tenant: true,
			}),
			{
				key: "maxTimeRangeDays",
				label: getMessage().DATA_SOURCE_FIELD_MAX_TIME_RANGE_DAYS,
				kind: "text",
				group: "settings",
				placeholder:
					getMessage().DATA_SOURCE_FIELD_MAX_TIME_RANGE_DAYS_PLACEHOLDER,
			},
			{
				key: "tempoVersion",
				label: "Tempo version (optional)",
				kind: "text",
				group: "settings",
				placeholder: "2.8.0 (auto-detected by health check)",
			},
			{
				key: "enableMostRecent",
				label: "Enable experimental most-recent search hint",
				kind: "switch",
				group: "settings",
				defaultValue: false,
			},
			{
				key: "metricsMaxTimeRangeHours",
				label: "TraceQL metrics window hours",
				kind: "text",
				group: "settings",
				placeholder: "24",
			},
		],
		authStyle: "http",
		authHelp: getMessage().DATA_SOURCE_AUTH_HELP_HTTP,
	}),
};
