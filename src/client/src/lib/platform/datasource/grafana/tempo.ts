/**
 * Grafana Tempo adapter (traces).
 *
 * TraceQL search (`GET /api/search`) with the AI selector pushed down, plus
 * `GET /api/traces/{id}` for full spans (including events, so chat view + evals
 * work). Tempo has no server-side aggregation, so summaries and the aggregate
 * agent DAG are built in-process from a bounded sample of full traces
 * (`buildAggregateDag`); cost/token rollups are gated accordingly.
 */

import { BaseExternalAdapter } from "../base-adapter";
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
import { safeFetch, selfHostedNetworkOptions } from "../http/safe-fetch";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";
import { parseOtlpTrace, normalizeOtlpId } from "../otlp-json";
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

const TTL_MS = 30_000;
const MAX_TRACE_FETCH = 200;
/** Parallel full-trace downloads after TraceQL search (Grafana Explore loads lazily). */
const TRACE_FETCH_CONCURRENCY = 8;
/** Cap how many span ids we remember for detail/hierarchy lookups. */
const SPAN_INDEX_MAX = 5_000;

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
interface TempoMetricsResponse {
	series?: TempoMetricsSeries[];
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

	private get baseUrl(): string {
		return String(this.descriptor.settings.url || "").replace(/\/$/, "");
	}

	private get networkOpts() {
		return selfHostedNetworkOptions(this.descriptor.settings);
	}

	private async authHeaders() {
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId
		);
		return {
			headers: applyHttpAuthCredentials(secret.credentials),
			redact: redactableSecretValues(secret),
		};
	}

	capabilities(): SourceCapabilities {
		return {
			signals: ["traces"],
			traceTree: true,
			spanEvents: true,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const start = Date.now();
		try {
			const { headers, redact } = await this.authHeaders();
			await safeFetch(`${this.baseUrl}/api/echo`, {
				headers,
				...this.networkOpts,
				redactValues: redact,
				timeoutMs: 8000,
			});
			return { ok: true, latencyMs: Date.now() - start };
		} catch (err) {
			return { ok: false, message: String((err as Error)?.message || err) };
		}
	}

	private async searchTraceIds(
		query: OpenLITQuery,
		limit: number
	): Promise<string[]> {
		const { headers, redact } = await this.authHeaders();
		const url = new URL(`${this.baseUrl}/api/search`);
		url.searchParams.set("q", buildTempoSearchQuery(query, { mostRecent: true }));
		url.searchParams.set(
			"start",
			String(Math.floor(query.timeRange.start.getTime() / 1000))
		);
		url.searchParams.set(
			"end",
			String(Math.floor(query.timeRange.end.getTime() / 1000))
		);
		url.searchParams.set("limit", String(limit));
		const key = cacheKey(this.descriptor.id, ["search", url.toString()]);
		const response = await cachedQuery(key, TTL_MS, () =>
			safeFetch<{ traces?: { traceID?: string }[] }>(url.toString(), {
				headers,
				...this.networkOpts,
				redactValues: redact,
			})
		);
		return (response?.traces || [])
			.map((t) => t.traceID)
			.filter((id): id is string => !!id);
	}

	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		const { headers, redact } = await this.authHeaders();
		const id = normalizeOtlpId(traceId) || traceId;
		const key = cacheKey(this.descriptor.id, ["trace", id]);
		const payload = await cachedQuery(key, TTL_MS, () =>
			safeFetch(`${this.baseUrl}/api/traces/${encodeURIComponent(id)}`, {
				headers,
				...this.networkOpts,
				redactValues: redact,
				concurrencyKey: this.descriptor.id,
				maxConcurrent: TRACE_FETCH_CONCURRENCY,
			})
		);
		const spans = parseOtlpTrace(payload);
		rememberSpans(this.descriptor.id, spans);
		return spans;
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		const id = normalizeOtlpId(spanId) || spanId;
		const cached = lookupIndexedSpan(this.descriptor.id, id);
		if (cached) return cached;

		// Tempo has no direct span API. Prefer TraceQL by hex span id
		// (Grafana Explore pattern: resolve trace, then fetch once).
		const { headers, redact } = await this.authHeaders();
		const url = new URL(`${this.baseUrl}/api/search`);
		url.searchParams.set("q", `{ span:id = ${traceqlValue(id)} }`);
		url.searchParams.set("limit", "1");
		try {
			const response = await safeFetch<{ traces?: { traceID?: string }[] }>(
				url.toString(),
				{
					headers,
					...this.networkOpts,
					redactValues: redact,
					timeoutMs: 8000,
					concurrencyKey: this.descriptor.id,
				}
			);
			const traceId = response?.traces?.[0]?.traceID;
			if (!traceId) return null;
			const spans = await this.getTraceSpans(traceId);
			return (
				spans.find((s) => s.spanId === id || s.spanId === spanId) ||
				pickRootSpan(spans) ||
				null
			);
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
		const ids = await this.searchTraceIds(
			query,
			Math.min(maxTraces, MAX_TRACE_FETCH)
		);
		const perTrace = await mapPool(
			ids,
			TRACE_FETCH_CONCURRENCY,
			(id) => this.getTraceSpans(id)
		);
		return perTrace.flat();
	}

	async listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		const start = Date.now();
		const traceCap = Math.min(query.limit || 20, MAX_TRACE_FETCH);
		const allSpans = await this.fetchSampledSpans(query, traceCap);
		// Explore-style list: one row per trace (root span). Full trees load
		// on detail via getTraceSpans — avoids 25 traces exploding into 100+ rows.
		const byTrace = new Map<string, NormalizedSpan[]>();
		for (const span of allSpans) {
			const list = byTrace.get(span.traceId) || [];
			list.push(span);
			byTrace.set(span.traceId, list);
		}
		const rows: NormalizedSpan[] = [];
		for (const spans of Array.from(byTrace.values())) {
			const root = pickRootSpan(spans);
			if (root) rows.push(root);
		}
		return {
			fields: [],
			rows,
			meta: {
				latencyMs: Date.now() - start,
				rowsScanned: allSpans.length,
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
		const { headers, redact } = await this.authHeaders();
		const url = new URL(`${this.baseUrl}/api/metrics/query_range`);
		url.searchParams.set("q", metricQuery);
		url.searchParams.set(
			"start",
			String(Math.floor(timeRange.start.getTime() / 1000))
		);
		url.searchParams.set(
			"end",
			String(Math.floor(timeRange.end.getTime() / 1000))
		);
		url.searchParams.set("step", step);
		const key = cacheKey(this.descriptor.id, ["metrics-range", url.toString()]);
		try {
			const payload = await cachedQuery(key, TTL_MS, () =>
				safeFetch<TempoMetricsResponse>(url.toString(), {
					headers: {
						...headers,
						"X-Query-Tags": "source=openlit,type=metrics",
					},
					...this.networkOpts,
					redactValues: redact,
					timeoutMs: 15_000,
					concurrencyKey: this.descriptor.id,
					retry: true,
				})
			);
			return payload?.series ?? null;
		} catch {
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
		const { headers, redact } = await this.authHeaders();
		const start = String(Math.floor(window.start.getTime() / 1000));
		const end = String(Math.floor(window.end.getTime() / 1000));
		const paths = [
			`/api/v2/search/tag/${encodeURIComponent(tag)}/values`,
			`/api/search/tag/${encodeURIComponent(tag)}/values`,
		];
		for (const path of paths) {
			try {
				const url = new URL(`${this.baseUrl}${path}`);
				url.searchParams.set("start", start);
				url.searchParams.set("end", end);
				url.searchParams.set("limit", "50");
				if (traceQlFilter) url.searchParams.set("q", traceQlFilter);
				const key = cacheKey(this.descriptor.id, ["tag-values", url.toString()]);
				const response = await cachedQuery(key, TTL_MS, () =>
					safeFetch<{
						tagValues?: Array<string | { value?: string }>;
					}>(url.toString(), {
						headers,
						...this.networkOpts,
						redactValues: redact,
						timeoutMs: 15_000,
					})
				);
				const raw = response?.tagValues || [];
				const values = raw
					.map((entry) =>
						typeof entry === "string" ? entry : String(entry?.value || "")
					)
					.filter(Boolean);
				if (values.length) return Array.from(new Set(values));
			} catch {
				// Try next path / fall through.
			}
		}
		return [];
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
		configFields: httpVendorFields({
			placeholder: "https://tempo-prod-xxx.grafana.net/tempo",
		}),
		authStyle: "http",
		authHelp: getMessage().DATA_SOURCE_AUTH_HELP_HTTP,
	}),
};
