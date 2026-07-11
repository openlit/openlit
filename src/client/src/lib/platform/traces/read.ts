/**
 * Traces read facade — the choke point for Telemetry list/detail/hierarchy.
 *
 * Built-in ClickHouse keeps the existing `lib/platform/request` SQL path
 * (full filter fidelity, no adapter cycle). External sources resolve via
 * `getTelemetryAdapter({ signal: "traces" })` and denormalize to the same
 * ClickHouse-shaped row the UI already consumes.
 */

import type { MetricParams } from "@/lib/platform/common";
import {
	getAttributeKeys,
	getAverageRequestDuration,
	getGroupedRequests,
	getHeirarchyViaSpanId,
	getRequestExist,
	getRequestPerTime,
	getRequestViaSpanId,
	getRequestViaTraceId,
	getRequests,
	getRequestsConfig,
	getTotalRequests,
} from "@/lib/platform/request";
import { getSignalSummary, getSummaryBucket } from "@/lib/platform/observability";
import { buildHierarchy } from "@/helpers/server/trace";
import { getFilterPreviousParams } from "@/helpers/server/platform";
import { metricParamsToOpenLITQuery } from "@/lib/platform/datasource/clickhouse/query-map";
import { denormalizeSpanToTraceRow } from "@/lib/platform/datasource/clickhouse/normalize";
import type {
	NormalizedSpan,
	OpenLITQuery,
} from "@/lib/platform/datasource/types";
import { UnsupportedCapabilityError } from "@/lib/platform/datasource/types";
import {
	intervalFromTimeRange,
	planAndAggregateSpans,
	planAndSpanTimeSeries,
} from "@/lib/platform/datasource/query-planner";
import {
	readSignalBucketRollup,
	readLlmRollup,
} from "@/lib/platform/telemetry/rollups";
import { shouldPreferRollup } from "@/lib/platform/datasource/rollup-policy";
import getMessage from "@/constants/messages";

async function resolveTracesAdapter(sourceId?: string) {
	const { getTelemetryAdapter, resolveTelemetrySourceDescriptor } =
		await import("@/lib/telemetry-source");
	const descriptor = await resolveTelemetrySourceDescriptor({
		signal: "traces",
		sourceId,
	});
	const adapter = await getTelemetryAdapter({ signal: "traces", sourceId });
	return { adapter, descriptor };
}

function isBuiltInClickHouse(descriptor: { type: string; isBuiltIn: boolean }) {
	return descriptor.isBuiltIn || descriptor.type === "clickhouse";
}

function asErrorMessage(err: unknown): string {
	if (err instanceof UnsupportedCapabilityError) return err.message;
	if (err instanceof Error) return err.message;
	return typeof err === "string" ? err : getMessage().WIDGET_RUN_FAILED;
}

/** List spans for the Telemetry table (same shape as `getRequests`). */
export async function listTraceRecords(params: MetricParams) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getRequests(params);
	}

	try {
		const query = metricParamsToOpenLITQuery(params);
		const preferHotCache = shouldPreferRollup(params);
		if (preferHotCache) {
			const { readSpanHotCache } = await import(
				"@/lib/platform/telemetry/rollups"
			);
			const cached = await readSpanHotCache(query, {
				sourceId: descriptor.id,
				dbConfigId: descriptor.dbConfigId,
				maxRows: params.limit || 25,
			});
			if (cached?.spans?.length) {
				const records = cached.spans.map((row) =>
					denormalizeSpanToTraceRow(row)
				);
				return {
					err: null,
					records,
					total: cached.truncated
						? records.length + (params.offset || 0) + 1
						: records.length + (params.offset || 0),
					freshness: "accelerated" as const,
				};
			}
		}
		// Stratified multi-service list so one high-volume app cannot dominate
		// (adapter.listSpans alone is a single recency-biased search).
		const { fetchSpansForList } = await import(
			"@/lib/platform/datasource/graph/sample-fetch"
		);
		const { spans, truncated } = await fetchSpansForList(adapter, query, {
			maxRows: params.limit || 25,
		});
		const records = spans.map((row) => denormalizeSpanToTraceRow(row));
		return {
			err: null,
			records,
			total: truncated
				? records.length + (params.offset || 0) + 1
				: records.length + (params.offset || 0),
			freshness: "sampled" as const,
		};
	} catch (err) {
		return { err: asErrorMessage(err) };
	}
}

/** Single span by id (same shape as `getRequestViaSpanId`). */
export async function getTraceSpanRecord(
	spanId: string,
	opts?: { traceId?: string }
) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getRequestViaSpanId(spanId);
	}

	try {
		let span = await adapter.getSpan(spanId);
		// Grafana Explore already knows the TraceId from search metadata —
		// when the UI passes it, skip the span-id TraceQL round-trip.
		if (!span && opts?.traceId) {
			const spans = await adapter.getTraceSpans(opts.traceId);
			span =
				spans.find((s) => s.spanId === spanId) ||
				spans[0] ||
				null;
		}
		if (!span) return { err: null, record: undefined };
		return { err: null, record: denormalizeSpanToTraceRow(span) };
	} catch (err) {
		return { err: asErrorMessage(err), record: undefined };
	}
}

/** First span for a trace id (same shape as `getRequestViaTraceId`). */
export async function getTraceRecordByTraceId(traceId: string) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getRequestViaTraceId(traceId);
	}

	try {
		const spans = await adapter.getTraceSpans(traceId);
		const first = spans[0];
		if (!first) return { err: null, record: undefined };
		return { err: null, record: denormalizeSpanToTraceRow(first) };
	} catch (err) {
		return { err: asErrorMessage(err), record: undefined };
	}
}

/**
 * Trace hierarchy for the detail tree. External sources get a ParentSpanId
 * tree from `getTraceSpans` (and session spans when the adapter supports it).
 * Coding-agent multi-trace folding stays ClickHouse-native for now.
 */
export async function getTraceHierarchy(
	spanId: string,
	opts?: { traceId?: string }
) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getHeirarchyViaSpanId(spanId);
	}

	try {
		let span = await adapter.getSpan(spanId);
		if (!span && opts?.traceId) {
			const spans = await adapter.getTraceSpans(opts.traceId);
			span =
				spans.find((s) => s.spanId === spanId) ||
				spans[0] ||
				null;
		}
		if (!span) return { err: "Span not found", record: {} };

		let spans = await adapter.getTraceSpans(span.traceId);
		const sessionId =
			span.spanAttributes["coding_agent.session.id"] ||
			span.resourceAttributes["coding_agent.session.id"];
		if (sessionId && adapter.capabilities().crossTraceSession) {
			try {
				const sessionSpans = await adapter.getSpansBySession(sessionId);
				const byId = new Map<string, NormalizedSpan>();
				for (const s of [...spans, ...sessionSpans]) byId.set(s.spanId, s);
				spans = Array.from(byId.values());
			} catch {
				// Session expansion is best-effort on external sources.
			}
		}

		if (spans.length === 0) {
			return { err: "Failed to fetch trace spans", record: {} };
		}

		const rows = spans.map(denormalizeSpanToTraceRow);
		const heirarchy = buildHierarchy(rows);
		if (!heirarchy) return { err: "Error building hierarchy", record: {} };
		return { err: null, record: heirarchy };
	} catch (err) {
		return { err: asErrorMessage(err), record: {} };
	}
}

const BUCKET_INTERVAL: Record<string, string> = {
	hour: "1h",
	day: "1d",
	week: "1w",
	month: "1M",
};

/** Friendly filter-bar groupBy keys -> the attribute/field an adapter groups on. */
const GROUP_BY_FIELD: Record<string, string> = {
	model: "gen_ai.request.model",
	provider: "gen_ai.system",
	spanName: "SpanName",
	applicationName: "service.name",
};

function groupByToField(groupBy: string): string {
	if (groupBy in GROUP_BY_FIELD) return GROUP_BY_FIELD[groupBy];
	const sep = groupBy.indexOf(":");
	return sep === -1 ? groupBy : groupBy.slice(sep + 1);
}

/**
 * Filter-bar config (models / providers / span names / environments / maxCost).
 * Built-in ClickHouse computes it in one pass; external sources enumerate
 * distinct values per field when the adapter supports it, and return an empty
 * config (dropdowns render empty) when it does not.
 */
export async function getTraceFilterConfig(params: MetricParams) {
	const { adapter, descriptor } = await resolveTracesAdapter(params.sourceId);
	if (isBuiltInClickHouse(descriptor)) {
		return getRequestsConfig(params);
	}

	const emptyRow = {
		providers: [] as string[],
		maxCost: 0,
		models: [] as string[],
		traceTypes: [] as string[],
		totalRows: 0,
		applicationNames: [] as string[],
		spanNames: [] as string[],
		environments: [] as string[],
	};
	if (!adapter.capabilities().distinctValues) {
		// Still try planner L1 — adapters may implement via sample compute.
	}

	try {
		const query = metricParamsToOpenLITQuery(params, "traces");
		// Prefer native service discovery for the Application filter (avoids
		// single-service bias from an unstratified L1 sample).
		let applicationNames: string[] = [];
		try {
			const discovered = await adapter.discoverServices(query.timeRange);
			applicationNames = discovered
				.map((d) => d.serviceName)
				.filter(Boolean);
		} catch {
			applicationNames = [];
		}

		// One shared L1 sample powers the remaining distinct probes (models,
		// providers, span names, …) instead of five separate 100-trace downloads.
		const { fetchSpansForAggregation } = await import(
			"@/lib/platform/datasource/graph/sample-fetch"
		);
		const { distinctFromSpans } = await import(
			"@/lib/platform/datasource/graph/sample-aggregate"
		);
		const { spans } = await fetchSpansForAggregation(adapter, query);
		const models = distinctFromSpans(spans, "gen_ai.request.model");
		const providers = distinctFromSpans(spans, "gen_ai.system");
		const spanNames = distinctFromSpans(spans, "SpanName");
		const traceTypes = distinctFromSpans(spans, "gen_ai.operation.type");
		if (!applicationNames.length) {
			applicationNames = distinctFromSpans(spans, "service.name");
		}
		return {
			err: null,
			data: [
				{
					...emptyRow,
					models,
					providers,
					spanNames,
					applicationNames,
					traceTypes,
				},
			],
		};
	} catch (err) {
		return { err: asErrorMessage(err), data: [emptyRow] };
	}
}

/** Attribute-key discovery for the custom-filter builder. */
export async function getTraceAttributeKeys(params: MetricParams) {
	const { adapter, descriptor } = await resolveTracesAdapter(params.sourceId);
	if (isBuiltInClickHouse(descriptor)) {
		return getAttributeKeys(params);
	}

	const empty = { err: null, spanAttributeKeys: [], resourceAttributeKeys: [] };
	try {
		const query = metricParamsToOpenLITQuery(params, "traces");
		const keys = await adapter.attributeKeys("traces", query.timeRange);
		return { err: null, spanAttributeKeys: keys, resourceAttributeKeys: [] };
	} catch {
		return empty;
	}
}

/** Grouped rollup (count / cost / tokens / avg duration) for a groupBy key. */
export async function getTraceGrouped(params: MetricParams, groupBy: string) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getGroupedRequests(params, groupBy);
	}

	try {
		const base = metricParamsToOpenLITQuery(params, "traces");
		const field = groupByToField(groupBy);
		const query: OpenLITQuery = {
			...base,
			groupBy: [field],
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "sum", field: "gen_ai.usage.cost", as: "total_cost" },
				{ fn: "sum", field: "gen_ai.usage.total_tokens", as: "total_tokens" },
				{ fn: "avg", field: "duration", as: "avg_duration_seconds" },
			],
		};
		const frame = await planAndAggregateSpans(adapter, query, {
			preferRollup: shouldPreferRollup(params),
			readRollup: (q) =>
				readLlmRollup(q, {
					sourceId: descriptor.id,
					dbConfigId: descriptor.dbConfigId,
					dimension: groupBy,
				}),
		});
		const data = (frame.rows as Record<string, unknown>[]).map((row) => ({
			group_value: String(row.group_value ?? row[field] ?? row.g0 ?? ""),
			count: Number(row.count ?? 0),
			total_cost: Number(row.total_cost ?? 0),
			total_tokens: Number(row.total_tokens ?? 0),
			avg_duration_seconds: Number(row.avg_duration_seconds ?? 0),
		}));
		return { err: null, data };
	} catch (err) {
		return { err: asErrorMessage(err), data: [] };
	}
}

/**
 * Signal summary bar-chart series. `signal` is "traces" or "exceptions" (the
 * latter adds an error-status filter). Built-in ClickHouse keeps its exact
 * bucketed SQL; external sources use the query planner (L0/L1/L2).
 */
export async function getTraceSummary(
	params: MetricParams,
	signal: "traces" | "exceptions" = "traces"
) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getSignalSummary(params, signal);
	}

	const bucket = getSummaryBucket(params);
	const empty = { err: null, bucket, buckets: [], total: 0, peak: 0 };

	try {
		const base = metricParamsToOpenLITQuery(params, "traces");
		const query: OpenLITQuery = {
			...base,
			interval: BUCKET_INTERVAL[bucket] || intervalFromTimeRange(
				base.timeRange.start,
				base.timeRange.end
			),
			filters:
				signal === "exceptions"
					? [
							...(base.filters || []),
							{ target: "status", op: "in", value: ["STATUS_CODE_ERROR", "Error"] },
						]
					: base.filters,
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "avg", field: "duration", as: "avgDuration" },
				{ fn: "sum", field: "gen_ai.usage.cost", as: "cost" },
				{ fn: "sum", field: "gen_ai.usage.total_tokens", as: "tokens" },
			],
		};
		const frame = await planAndSpanTimeSeries(adapter, query, {
			preferRollup: signal === "traces" && shouldPreferRollup(params),
			readRollup: (q) =>
				readSignalBucketRollup(q, {
					sourceId: descriptor.id,
					dbConfigId: descriptor.dbConfigId,
				}),
		});
		const buckets = (frame.rows as Record<string, unknown>[]).map((row) => ({
			label: String(row.label ?? row.request_time ?? row.bucket ?? ""),
			count: Number(row.count ?? 0),
			avgDuration: Number(row.avgDuration ?? 0),
			cost: Number(row.cost ?? 0),
			tokens: Number(row.tokens ?? 0),
		}));
		const total = buckets.reduce((sum, b) => sum + b.count, 0);
		const peak = buckets.reduce((max, b) => Math.max(max, b.count), 0);
		return {
			err: null,
			bucket,
			buckets,
			total,
			peak,
			freshness: frame.meta?.freshness || "sampled",
		};
	} catch (err) {
		return { ...empty, err: asErrorMessage(err) };
	}
}

/** Total request count with previous-period comparison (dashboard graphs). */
export async function getTraceTotalRequests(params: MetricParams) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getTotalRequests(params);
	}

	try {
		const current = await planAndAggregateSpans(
			adapter,
			{
				...metricParamsToOpenLITQuery(params, "traces"),
				aggregations: [{ fn: "count", as: "total_requests" }],
			},
			{
				preferRollup: shouldPreferRollup(params),
				readRollup: async (q) => {
					const series = await readSignalBucketRollup(q, {
						sourceId: descriptor.id,
						dbConfigId: descriptor.dbConfigId,
					});
					if (!series) return null;
					const total = (series.rows as Record<string, unknown>[]).reduce(
						(sum, row) => sum + Number(row.count ?? row.total ?? 0),
						0
					);
					return {
						fields: [],
						rows: [{ total_requests: total, count: total }],
						meta: series.meta,
					};
				},
			}
		);
		const previousParams = getFilterPreviousParams(params);
		const previous = await planAndAggregateSpans(adapter, {
			...metricParamsToOpenLITQuery(previousParams, "traces"),
			aggregations: [{ fn: "count", as: "total_requests" }],
		});
		const currentTotal = Number(
			(current.rows[0] as Record<string, unknown> | undefined)?.total_requests ??
				(current.rows[0] as Record<string, unknown> | undefined)?.count ??
				0
		);
		const previousTotal = Number(
			(previous.rows[0] as Record<string, unknown> | undefined)
				?.total_requests ??
				(previous.rows[0] as Record<string, unknown> | undefined)?.count ??
				0
		);
		return {
			err: null,
			data: [
				{
					total_requests: currentTotal,
					previous_total_requests: previousTotal,
				},
			],
		};
	} catch (err) {
		return { err: asErrorMessage(err), data: [] };
	}
}

/** Requests-over-time series for dashboard graphs. */
export async function getTraceRequestPerTime(params: MetricParams) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getRequestPerTime(params);
	}

	try {
		const query = metricParamsToOpenLITQuery(params, "traces");
		const interval =
			query.interval ||
			intervalFromTimeRange(query.timeRange.start, query.timeRange.end);
		const frame = await planAndSpanTimeSeries(
			adapter,
			{
				...query,
				interval,
				aggregations: [{ fn: "count", as: "total" }],
			},
			{
				preferRollup: shouldPreferRollup(params),
				readRollup: (q) =>
					readSignalBucketRollup(q, {
						sourceId: descriptor.id,
						dbConfigId: descriptor.dbConfigId,
					}),
			}
		);
		const data = (frame.rows as Record<string, unknown>[]).map((row) => ({
			total: Number(row.total ?? row.count ?? 0),
			request_time: String(row.request_time ?? row.label ?? row.bucket ?? ""),
		}));
		return { err: null, data };
	} catch (err) {
		return { err: asErrorMessage(err), data: [] };
	}
}

/** Average request duration with previous-period comparison. */
export async function getTraceAverageDuration(params: MetricParams) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getAverageRequestDuration(params);
	}

	try {
		const current = await planAndAggregateSpans(adapter, {
			...metricParamsToOpenLITQuery(params, "traces"),
			aggregations: [{ fn: "avg", field: "duration", as: "average_duration" }],
		});
		const previousParams = getFilterPreviousParams(params);
		const previous = await planAndAggregateSpans(adapter, {
			...metricParamsToOpenLITQuery(previousParams, "traces"),
			aggregations: [{ fn: "avg", field: "duration", as: "average_duration" }],
		});
		const average_duration = Number(
			(current.rows[0] as Record<string, unknown> | undefined)
				?.average_duration ?? 0
		);
		const previous_average_duration = Number(
			(previous.rows[0] as Record<string, unknown> | undefined)
				?.average_duration ?? 0
		);
		return {
			err: null,
			data: [{ average_duration, previous_average_duration }],
		};
	} catch (err) {
		return { err: asErrorMessage(err), data: [] };
	}
}

/** Whether any AI traces exist in the bound traces source (onboarding gate). */
export async function getTraceExist() {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getRequestExist();
	}

	try {
		const end = new Date();
		const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: { start, end },
			aiSelector: true,
			limit: 1,
		});
		return {
			err: null,
			data: [{ total_requests: frame.rows.length > 0 ? 1 : 0 }],
		};
	} catch (err) {
		return { err: asErrorMessage(err), data: [{ total_requests: 0 }] };
	}
}
