/**
 * Traces read facade — the choke point for Telemetry list/detail/hierarchy.
 *
 * Every source, including built-in ClickHouse, resolves through the shared
 * signal facade and executes the DataSourceAdapter contract.
 */

import type { MetricParams } from "@/lib/platform/common";
import { getSummaryBucket } from "@/lib/platform/observability";
import { buildHierarchy } from "@/helpers/server/trace";
import { getFilterPreviousParams } from "@/helpers/server/platform";
import { metricParamsToOpenLITQuery } from "@/lib/platform/connectors/datasource/clickhouse/query-map";
import { denormalizeSpanToTraceRow } from "@/lib/platform/connectors/datasource/clickhouse/normalize";
import type {
	NormalizedSpan,
	OpenLITQuery,
} from "@/lib/platform/connectors/datasource/types";
import { UnsupportedCapabilityError } from "@/lib/platform/connectors/datasource/types";
import {
	intervalFromTimeRange,
	planAndAggregateSpans,
	planAndSpanTimeSeries,
} from "@/lib/platform/connectors/datasource/query-planner";
import { resolveSignalReadContext } from "@/lib/platform/connectors/datasource/facade";
import getMessage from "@/constants/messages";
import { consoleLog } from "@/utils/log";
import { AdapterError } from "@openplait/adapter-sdk";

async function resolveTracesAdapter(sourceId?: string, environment?: string) {
	const { adapter, descriptor } = await resolveSignalReadContext("traces", {
		sourceId,
		environment,
	});
	consoleLog("[traces] resolved read adapter", {
		sourceId: sourceId || null,
		environment: environment || null,
		descriptorId: descriptor.id,
		type: descriptor.type,
		isBuiltIn: descriptor.isBuiltIn,
	});
	return { adapter, descriptor };
}

/** Drop the synthetic ClickHouse "default" environment when querying Tempo. */
function externalTraceQuery(params: MetricParams, opts?: { aiSelector?: boolean }) {
	const query = metricParamsToOpenLITQuery(params, "traces", opts);
	const filters = query.filters?.filter((filter) => {
		if (filter.target !== "attribute" || filter.key !== "deployment.environment") {
			return true;
		}
		const values = Array.isArray(filter.value) ? filter.value : [filter.value];
		return !(values.length === 1 && String(values[0]) === "default");
	});
	return { ...query, filters: filters?.length ? filters : undefined };
}

function asErrorMessage(err: unknown): string {
	if (err instanceof UnsupportedCapabilityError) return err.message;
	if (err instanceof AdapterError) {
		const body = err.details?.body;
		if (typeof body === "string" && body.trim()) {
			// Tempo's response body contains the actionable parser/range reason;
			// auth headers are never included in OpenPlait error details.
			return `${err.message} ${body.trim().slice(0, 500)}`;
		}
	}
	if (err instanceof Error) return err.message;
	return typeof err === "string" ? err : getMessage().WIDGET_RUN_FAILED;
}

/** List spans for the Telemetry table (same shape as `getRequests`). */
export async function listTraceRecords(params: MetricParams) {
	const { adapter, descriptor } = await resolveTracesAdapter(params.sourceId, params.environment);

	try {
		const query = externalTraceQuery(params, { aiSelector: false });
		// Interactive lists always query the selected adapter directly. Sampling
		// caches are reserved for aggregate/intelligence computation.
		const frame = await adapter.listSpans(query);
		const spans = frame.rows || [];
		const truncated =
			!!frame.meta?.truncated || spans.length >= (params.limit || 25);
		const records = spans.map((row) => denormalizeSpanToTraceRow(row));
		let total = truncated
			? records.length + (params.offset || 0) + 1
			: records.length + (params.offset || 0);
		let totalIsSampled = true;
		if (adapter.countTraces) {
			try {
				const count = await adapter.countTraces(query);
				total = count.total;
				totalIsSampled = count.truncated;
			} catch {
				// Keep the bounded-list sentinel when the backend cannot count.
			}
		} else if (typeof frame.meta?.rowsScanned === "number") {
			total = frame.meta.rowsScanned;
			totalIsSampled = false;
		}
		consoleLog("[traces] external list result", {
			descriptorId: descriptor.id,
			type: descriptor.type,
			spanCount: spans.length,
			recordCount: records.length,
			truncated,
			total,
			totalIsSampled,
		});
		return {
			err: null,
			records,
			total,
			freshness: totalIsSampled ? ("sampled" as const) : ("live" as const),
		};
	} catch (err) {
		return { err: asErrorMessage(err) };
	}
}

/** Single span by id (same shape as `getRequestViaSpanId`). */
export async function getTraceSpanRecord(
	spanId: string,
	opts?: { traceId?: string; environment?: string }
) {
	const startedAt = Date.now();
	consoleLog("[traces] span detail start", {
		spanId,
		traceId: opts?.traceId || null,
		environment: opts?.environment || null,
	});
	const { adapter, descriptor } = await resolveTracesAdapter(
		undefined,
		opts?.environment
	);
	try {
		// Grafana Explore already knows the TraceId from search metadata. Fetch
		// that trace first; a span-id-only TraceQL search is eventually
		// consistent and can intermittently return an empty result immediately
		// after the list request.
		let span: NormalizedSpan | null = null;
		if (opts?.traceId) {
			consoleLog("[traces] span detail fetching trace", {
				descriptorId: descriptor.id,
				traceId: opts.traceId,
				spanId,
			});
			const spans = await adapter.getTraceSpans(opts.traceId);
			consoleLog("[traces] span detail trace fetched", {
				descriptorId: descriptor.id,
				traceId: opts.traceId,
				requestedSpanId: spanId,
				spanCount: spans.length,
				matched: spans.some((s) => s.spanId === spanId),
			});
			span =
				spans.find((s) => s.spanId === spanId) ||
				null;
			if (!span) {
				return {
					err: "Span not found in the selected trace and telemetry source",
					record: undefined,
				};
			}
		}
		if (!opts?.traceId) span = await adapter.getSpan(spanId);
		if (!span) {
			consoleLog("[traces] span not found", {
				descriptorId: descriptor.id,
				type: descriptor.type,
				spanId,
				traceId: opts?.traceId || null,
				elapsedMs: Date.now() - startedAt,
			});
			return { err: "Span not found in the selected telemetry source", record: undefined };
		}
		consoleLog("[traces] span detail success", {
			descriptorId: descriptor.id,
			spanId,
			traceId: span.traceId,
			elapsedMs: Date.now() - startedAt,
		});
		return { err: null, record: denormalizeSpanToTraceRow(span) };
	} catch (err) {
		consoleLog("[traces] span detail failed", {
			descriptorId: descriptor.id,
			spanId,
			traceId: opts?.traceId || null,
			elapsedMs: Date.now() - startedAt,
			error: asErrorMessage(err),
		});
		return { err: asErrorMessage(err), record: undefined };
	}
}

/** First span for a trace id (same shape as `getRequestViaTraceId`). */
export async function getTraceRecordByTraceId(traceId: string, environment?: string) {
	const { adapter } = await resolveTracesAdapter(undefined, environment);

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
	opts?: { traceId?: string; environment?: string }
) {
	const { adapter } = await resolveTracesAdapter(undefined, opts?.environment);

	try {
		let span: NormalizedSpan | null = null;
		if (opts?.traceId) {
			const spans = await adapter.getTraceSpans(opts.traceId);
			span =
				spans.find((s) => s.spanId === spanId) ||
				null;
			if (!span) {
				return {
					err: "Span not found in the selected trace and telemetry source",
					record: {},
				};
			}
		}
		if (!opts?.traceId) span = await adapter.getSpan(spanId);
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
	const { adapter } = await resolveTracesAdapter(params.sourceId, params.environment);

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
		const query = externalTraceQuery(params, { aiSelector: false });
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
			"@/lib/platform/connectors/datasource/graph/sample-fetch"
		);
		const { distinctFromSpans } = await import(
			"@/lib/platform/connectors/datasource/graph/sample-aggregate"
		);
		const { spans } = await fetchSpansForAggregation(adapter, query);
		const models = distinctFromSpans(spans, "gen_ai.request.model");
		const providers = distinctFromSpans(spans, "gen_ai.system");
		// Prefer adapter-native enums (Jaeger /api/services/{svc}/operations) when
		// available so Span Names match the Jaeger Search UI instead of a sample.
		let spanNames: string[] = [];
		try {
			spanNames = await adapter.distinctValues("SpanName", query);
		} catch {
			spanNames = distinctFromSpans(spans, "SpanName");
		}
		if (!spanNames.length) {
			spanNames = distinctFromSpans(spans, "SpanName");
		}
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
	const { adapter } = await resolveTracesAdapter(params.sourceId, params.environment);

	const empty = { err: null, spanAttributeKeys: [], resourceAttributeKeys: [] };
	try {
		const query = externalTraceQuery(params, { aiSelector: false });
		const keys = await adapter.attributeKeys("traces", query.timeRange);
		return { err: null, spanAttributeKeys: keys, resourceAttributeKeys: [] };
	} catch {
		return empty;
	}
}

/** Grouped rollup (count / cost / tokens / avg duration) for a groupBy key. */
export async function getTraceGrouped(params: MetricParams, groupBy: string) {
	const { adapter } = await resolveTracesAdapter(params.sourceId, params.environment);

	try {
		const base = externalTraceQuery(params, { aiSelector: false });
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
		const frame = await planAndAggregateSpans(adapter, query);
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
	const { adapter } = await resolveTracesAdapter(params.sourceId, params.environment);

	const bucket = getSummaryBucket(params);
	const empty = { err: null, bucket, buckets: [], total: 0, peak: 0 };

	try {
		const base = externalTraceQuery(params, { aiSelector: false });
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
							{ target: "status", op: "in", value: ["STATUS_CODE_ERROR", "Error", "ERROR"] },
						]
					: base.filters,
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "avg", field: "duration", as: "avgDuration" },
				{ fn: "sum", field: "gen_ai.usage.cost", as: "cost" },
				{ fn: "sum", field: "gen_ai.usage.total_tokens", as: "tokens" },
			],
		};
		// Trace backends such as Tempo can return lightweight trace summaries
		// without downloading every span. Prefer that trace-level series when
		// available so a 200-trace L1 sample is never presented as the volume.
		const frame = adapter.traceTimeSeries
			? await adapter.traceTimeSeries(query)
			: await planAndSpanTimeSeries(adapter, query);
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
			truncated: frame.meta?.truncated || false,
		};
	} catch (err) {
		return { ...empty, err: asErrorMessage(err) };
	}
}

/** Total request count with previous-period comparison (dashboard graphs). */
export async function getTraceTotalRequests(params: MetricParams) {
	const { adapter } = await resolveTracesAdapter(params.sourceId, params.environment);

	try {
		const current = await planAndAggregateSpans(
			adapter,
			{
				...externalTraceQuery(params, { aiSelector: false }),
				aggregations: [{ fn: "count", as: "total_requests" }],
			},
			{}
		);
		const previousParams = getFilterPreviousParams(params);
		const previous = await planAndAggregateSpans(adapter, {
			...externalTraceQuery(previousParams, { aiSelector: false }),
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
	const { adapter } = await resolveTracesAdapter(params.sourceId, params.environment);

	try {
		const query = externalTraceQuery(params, { aiSelector: false });
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
			{}
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
	const { adapter } = await resolveTracesAdapter(params.sourceId, params.environment);

	try {
		const current = await planAndAggregateSpans(adapter, {
			...externalTraceQuery(params, { aiSelector: false }),
			aggregations: [{ fn: "avg", field: "duration", as: "average_duration" }],
		});
		const previousParams = getFilterPreviousParams(params);
		const previous = await planAndAggregateSpans(adapter, {
			...externalTraceQuery(previousParams, { aiSelector: false }),
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
	const { adapter } = await resolveTracesAdapter();

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
