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
	getGroupedRequests,
	getHeirarchyViaSpanId,
	getRequestViaSpanId,
	getRequestViaTraceId,
	getRequests,
	getRequestsConfig,
} from "@/lib/platform/request";
import { getSignalSummary, getSummaryBucket } from "@/lib/platform/observability";
import { buildHierarchy } from "@/helpers/server/trace";
import { metricParamsToOpenLITQuery } from "@/lib/platform/datasource/clickhouse/query-map";
import { denormalizeSpanToTraceRow } from "@/lib/platform/datasource/clickhouse/normalize";
import type {
	NormalizedSpan,
	OpenLITQuery,
} from "@/lib/platform/datasource/types";
import { UnsupportedCapabilityError } from "@/lib/platform/datasource/types";
import getMessage from "@/constants/messages";

async function resolveTracesAdapter() {
	const { getTelemetryAdapter, resolveTelemetrySourceDescriptor } =
		await import("@/lib/telemetry-source");
	const descriptor = await resolveTelemetrySourceDescriptor({
		signal: "traces",
	});
	const adapter = await getTelemetryAdapter({ signal: "traces" });
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
		const frame = await adapter.listSpans(query);
		const records = frame.rows.map((row) =>
			denormalizeSpanToTraceRow(row as NormalizedSpan)
		);
		return {
			err: null,
			records,
			total: records.length + (params.offset || 0),
		};
	} catch (err) {
		return { err: asErrorMessage(err) };
	}
}

/** Single span by id (same shape as `getRequestViaSpanId`). */
export async function getTraceSpanRecord(spanId: string) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getRequestViaSpanId(spanId);
	}

	try {
		const span = await adapter.getSpan(spanId);
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
export async function getTraceHierarchy(spanId: string) {
	const { adapter, descriptor } = await resolveTracesAdapter();
	if (isBuiltInClickHouse(descriptor)) {
		return getHeirarchyViaSpanId(spanId);
	}

	try {
		const span = await adapter.getSpan(spanId);
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
	const { adapter, descriptor } = await resolveTracesAdapter();
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
		return { err: null, data: [emptyRow] };
	}

	try {
		const query = metricParamsToOpenLITQuery(params, "traces");
		const distinct = async (key: string) => {
			try {
				return await adapter.distinctValues(key, query);
			} catch {
				return [] as string[];
			}
		};
		const [models, providers, spanNames, applicationNames, traceTypes] =
			await Promise.all([
				distinct("gen_ai.request.model"),
				distinct("gen_ai.system"),
				distinct("SpanName"),
				distinct("service.name"),
				distinct("gen_ai.operation.type"),
			]);
		return {
			err: null,
			data: [
				{ ...emptyRow, models, providers, spanNames, applicationNames, traceTypes },
			],
		};
	} catch (err) {
		return { err: asErrorMessage(err), data: [emptyRow] };
	}
}

/** Attribute-key discovery for the custom-filter builder. */
export async function getTraceAttributeKeys(params: MetricParams) {
	const { adapter, descriptor } = await resolveTracesAdapter();
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

	if (!adapter.capabilities().serverAggregation) {
		return { err: null, data: [] };
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
		const frame = await adapter.aggregateSpans(query);
		const data = (frame.rows as Record<string, unknown>[]).map((row) => ({
			group_value: String(row.group_value ?? row[field] ?? ""),
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
 * bucketed SQL; external sources use `spanTimeSeries` when they support
 * aggregation, else return an empty (but well-formed) series.
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
	if (!adapter.capabilities().serverAggregation) return empty;

	try {
		const base = metricParamsToOpenLITQuery(params, "traces");
		const query: OpenLITQuery = {
			...base,
			interval: BUCKET_INTERVAL[bucket] || "1h",
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
		const frame = await adapter.spanTimeSeries(query);
		const buckets = (frame.rows as Record<string, unknown>[]).map((row) => ({
			label: String(row.label ?? row.request_time ?? ""),
			count: Number(row.count ?? 0),
			avgDuration: Number(row.avgDuration ?? 0),
			cost: Number(row.cost ?? 0),
			tokens: Number(row.tokens ?? 0),
		}));
		const total = buckets.reduce((sum, b) => sum + b.count, 0);
		const peak = buckets.reduce((max, b) => Math.max(max, b.count), 0);
		return { err: null, bucket, buckets, total, peak };
	} catch (err) {
		return { ...empty, err: asErrorMessage(err) };
	}
}
