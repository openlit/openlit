/**
 * Bounded span sampling for L1 (in-process) aggregation.
 *
 * External trace backends without serverAggregation download a capped set of
 * full traces, then group/bucket in-process. This module owns the sample
 * budget and a short TTL cache so Telemetry summary + grouped + filter-config
 * requests share one sample instead of re-downloading the same traces.
 */

import type {
	DataFrame,
	DiscoveredService,
	NormalizedFilter,
	NormalizedSpan,
	OpenLITQuery,
	QueryTimeRange,
} from "../types";
import { clampQueryBudget } from "../http/limits";
import { cacheKey, cachedQuery } from "../http/cache";
import { mapPool } from "./map-pool";
import { looksLikeRootsOnly } from "./sample-aggregate";

export interface SampleFetchSource {
	sampleTracesForGraph?(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]>;
	listSpans?(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>>;
	getTraceSpans?(traceId: string): Promise<NormalizedSpan[]>;
	discoverServices?(window: QueryTimeRange): Promise<DiscoveredService[]>;
	/**
	 * When true, `sampleTracesForGraph` already fans out per service (e.g.
	 * Jaeger). Shared stratification must not wrap it again.
	 */
	samplesAreServiceStratified?: boolean;
	/** Stable id for cross-route L1 sample caching (usually source descriptor id). */
	sampleCacheKey?: string;
}

/** Cap for flat list / detail samples. */
export const DEFAULT_SAMPLE_TRACE_CAP = 100;
/** Cap for aggregate / timeseries / distinct L1 samples (shared across panels). */
export const AGGREGATE_SAMPLE_TRACE_CAP = 200;
export const DEFAULT_SAMPLE_CONCURRENCY = 6;
const MAX_SERVICES_IN_SAMPLE = 24;
const MIN_TRACES_PER_SERVICE = 8;
const STRATIFY_CONCURRENCY = 4;
/** Share L1 samples across summary/grouped/config for the poll window. */
const L1_SAMPLE_TTL_MS = 45_000;

function uniqueTraceIds(spans: NormalizedSpan[], maxTraces: number): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const span of spans) {
		const id = span.traceId;
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
		if (ids.length >= maxTraces) break;
	}
	return ids;
}

function extractServiceNames(filters: NormalizedFilter[] | undefined): string[] {
	const names: string[] = [];
	for (const filter of filters || []) {
		if (filter.target !== "attribute" || filter.key !== "service.name") continue;
		if (Array.isArray(filter.value)) {
			names.push(...filter.value.map(String).filter(Boolean));
		} else if (filter.value !== undefined && filter.value !== "") {
			names.push(String(filter.value));
		}
	}
	return Array.from(new Set(names));
}

function withServiceEq(query: OpenLITQuery, serviceName: string): OpenLITQuery {
	const filters = (query.filters || []).filter(
		(f) => !(f.target === "attribute" && f.key === "service.name")
	);
	filters.push({
		target: "attribute",
		scope: "resource",
		key: "service.name",
		op: "eq",
		value: serviceName,
	});
	return { ...query, filters };
}

function resolveCacheId(source: SampleFetchSource): string {
	return source.sampleCacheKey || "anon";
}

async function sampleOnce(
	source: SampleFetchSource,
	query: OpenLITQuery,
	maxTraces: number
): Promise<NormalizedSpan[]> {
	if (typeof source.sampleTracesForGraph === "function") {
		return source.sampleTracesForGraph(query, maxTraces);
	}
	return [];
}

/**
 * Fan out across discovered services so one high-volume app cannot dominate
 * the sample (Tempo search is recency-ordered and otherwise returns one service).
 */
async function fetchStratifiedSample(
	source: SampleFetchSource,
	query: OpenLITQuery,
	maxTraces: number
): Promise<{ spans: NormalizedSpan[]; truncated: boolean } | null> {
	if (source.samplesAreServiceStratified) return null;
	if (typeof source.sampleTracesForGraph !== "function") return null;
	if (typeof source.discoverServices !== "function") return null;

	const filtered = extractServiceNames(query.filters);
	if (filtered.length === 1) return null;

	let names = filtered;
	if (!names.length) {
		try {
			const discovered = await source.discoverServices(query.timeRange);
			names = discovered.map((d) => d.serviceName).filter(Boolean);
		} catch {
			return null;
		}
	}
	if (names.length <= 1) return null;

	names = names.slice(0, MAX_SERVICES_IN_SAMPLE);
	const perService = Math.max(
		MIN_TRACES_PER_SERVICE,
		Math.ceil(maxTraces / names.length)
	);

	const batches = await mapPool(names, STRATIFY_CONCURRENCY, (name) =>
		sampleOnce(source, withServiceEq(query, name), perService)
	);
	const spans = batches.flat();
	const traceCount = new Set(spans.map((s) => s.traceId).filter(Boolean)).size;
	return { spans, truncated: traceCount >= maxTraces || names.length > 1 };
}

async function fetchUnstratified(
	source: SampleFetchSource,
	query: OpenLITQuery,
	maxTraces: number
): Promise<{ spans: NormalizedSpan[]; truncated: boolean }> {
	const sampleQuery: OpenLITQuery = { ...query, limit: maxTraces };

	if (typeof source.sampleTracesForGraph === "function") {
		const spans = await source.sampleTracesForGraph(sampleQuery, maxTraces);
		const traceCount = new Set(spans.map((s) => s.traceId).filter(Boolean)).size;
		return { spans, truncated: traceCount >= maxTraces };
	}

	if (typeof source.listSpans !== "function") {
		return { spans: [], truncated: false };
	}

	const frame = await source.listSpans(sampleQuery);
	const rows = frame.rows || [];
	const listTruncated = !!frame.meta?.truncated || rows.length >= maxTraces;

	if (looksLikeRootsOnly(rows) && typeof source.getTraceSpans === "function") {
		const ids = uniqueTraceIds(rows, maxTraces);
		const perTrace = await mapPool(ids, DEFAULT_SAMPLE_CONCURRENCY, (id) =>
			source.getTraceSpans!(id)
		);
		return {
			spans: perTrace.flat(),
			truncated: listTruncated || ids.length >= maxTraces,
		};
	}

	return { spans: rows, truncated: listTruncated };
}

/**
 * Pull a bounded set of spans suitable for in-process aggregation.
 * Prefers stratified sampling when the adapter can discover services.
 * Results are cached briefly so Telemetry panels share one download.
 */
export async function fetchSpansForAggregation(
	source: SampleFetchSource,
	query: OpenLITQuery,
	opts?: { maxTraces?: number; skipCache?: boolean }
): Promise<{ spans: NormalizedSpan[]; truncated: boolean }> {
	const { query: clamped } = clampQueryBudget(query);
	const requested =
		opts?.maxTraces ?? clamped.limit ?? AGGREGATE_SAMPLE_TRACE_CAP;
	const maxTraces = Math.min(requested, AGGREGATE_SAMPLE_TRACE_CAP);

	const load = async () => {
		const stratified = await fetchStratifiedSample(source, clamped, maxTraces);
		if (stratified) return stratified;
		return fetchUnstratified(source, clamped, maxTraces);
	};

	if (opts?.skipCache) return load();

	const key = cacheKey(resolveCacheId(source), [
		"l1-sample",
		clamped.timeRange.start.toISOString(),
		clamped.timeRange.end.toISOString(),
		clamped.aiSelector !== false,
		clamped.filters || [],
		maxTraces,
	]);
	return cachedQuery(key, L1_SAMPLE_TTL_MS, load);
}

const ROOT_PARENT_IDS = new Set(["", "0".repeat(16)]);

/** Pick the root (or earliest) span for a single trace. */
export function pickRootSpan(spans: NormalizedSpan[]): NormalizedSpan | undefined {
	if (spans.length === 0) return undefined;
	return (
		spans.find(
			(s) => !s.parentSpanId || ROOT_PARENT_IDS.has(s.parentSpanId)
		) || spans[0]
	);
}

/** Collapse full-trace spans to one root row per trace, newest first. */
export function collapseToRootSpans(spans: NormalizedSpan[]): NormalizedSpan[] {
	const byTrace = new Map<string, NormalizedSpan[]>();
	for (const span of spans) {
		if (!span.traceId) continue;
		const list = byTrace.get(span.traceId) || [];
		list.push(span);
		byTrace.set(span.traceId, list);
	}
	const roots: NormalizedSpan[] = [];
	for (const group of Array.from(byTrace.values())) {
		const root = pickRootSpan(group);
		if (root) roots.push(root);
	}
	roots.sort((a, b) => {
		const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
		const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
		return tb - ta;
	});
	return roots;
}

/**
 * Stratified flat-list sample for Telemetry tables.
 * Fans out across services (unless already scoped to one), then collapses to
 * one root span per trace so a single high-volume app cannot monopolize the page.
 */
export async function fetchSpansForList(
	source: SampleFetchSource,
	query: OpenLITQuery,
	opts?: { maxRows?: number; skipCache?: boolean }
): Promise<{ spans: NormalizedSpan[]; truncated: boolean }> {
	const { query: clamped } = clampQueryBudget(query);
	const maxRows = Math.min(
		opts?.maxRows ?? clamped.limit ?? DEFAULT_SAMPLE_TRACE_CAP,
		DEFAULT_SAMPLE_TRACE_CAP
	);

	const load = async () => {
		const sample = await fetchSpansForAggregation(source, clamped, {
			maxTraces: Math.max(maxRows, MIN_TRACES_PER_SERVICE * 4),
			skipCache: true,
		});
		const roots = collapseToRootSpans(sample.spans).slice(0, maxRows);
		return {
			spans: roots,
			truncated: sample.truncated || roots.length >= maxRows,
		};
	};

	if (opts?.skipCache) return load();

	const key = cacheKey(resolveCacheId(source), [
		"l1-list",
		clamped.timeRange.start.toISOString(),
		clamped.timeRange.end.toISOString(),
		clamped.aiSelector !== false,
		clamped.filters || [],
		maxRows,
		clamped.offset || 0,
	]);
	return cachedQuery(key, L1_SAMPLE_TTL_MS, load);
}
