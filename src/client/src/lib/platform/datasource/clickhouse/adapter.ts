/**
 * ClickHouse reference DataSourceAdapter (CE).
 *
 * This is the default/reference implementation of the pluggable telemetry
 * contract. It reads OpenLIT's own `otel_traces|logs|metrics` tables via the
 * existing `dataCollector` choke point and the already-tested query builders,
 * normalizing results into the vendor-agnostic contract shapes. External
 * vendor adapters (EE) implement the same contract against their APIs.
 *
 * It advertises the full ClickHouse capability set (trace tree, span events,
 * server-side aggregation, span mutation, distinct values, cross-trace coding
 * sessions, raw queries), so surfaces never degrade on the native path.
 */

import { dataCollector } from "@/lib/platform/common";
import {
	OTEL_TRACES_TABLE_NAME,
	OTEL_LOGS_TABLE_NAME,
} from "@/lib/platform/common";
import {
	getRequests,
	getRequestViaSpanId,
	getAttributeKeys,
} from "@/lib/platform/request";
import {
	getLogs,
	getLogByRowId,
	getMetrics,
	getMetricsConfig,
	getLogAttributeKeys,
	getMetricAttributeKeys,
} from "@/lib/platform/observability";
import {
	aiSelectorToClickHouse,
	AI_SELECTOR_MARKERS,
} from "../ai-selector";
import type {
	AISignalValidation,
	DataFrame,
	DataSourceAdapter,
	DiscoveredService,
	HealthCheckResult,
	NormalizedLog,
	NormalizedMetricPoint,
	NormalizedSpan,
	OpenLITQuery,
	QueryTimeRange,
	ServiceRollup,
	Signal,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { normalizeLogRow, normalizeMetricRow, normalizeSpanRow } from "./normalize";
import { toMetricParams } from "./query-map";

function escapeCH(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Format a Date to a ClickHouse UTC datetime literal. */
function chDateTime(date: Date): string {
	return date.toISOString().replace("T", " ").replace("Z", "").split(".")[0];
}

function timeRangeClause(range: QueryTimeRange, column = "Timestamp"): string {
	return `${column} >= '${chDateTime(range.start)}' AND ${column} <= '${chDateTime(
		range.end
	)}'`;
}

/** Map a normalized interval string to a ClickHouse DATE_TRUNC unit. */
function intervalToTruncUnit(interval?: string): string {
	if (!interval) return "minute";
	if (/h$/i.test(interval)) return "hour";
	if (/d$/i.test(interval)) return "day";
	if (/s$/i.test(interval)) return "second";
	return "minute";
}

const AGG_FN_MAP: Record<string, (field: string) => string> = {
	count: () => "count()",
	sum: (f) => `sum(toFloat64OrZero(${f}))`,
	avg: (f) => `avg(toFloat64OrZero(${f}))`,
	min: (f) => `min(toFloat64OrZero(${f}))`,
	max: (f) => `max(toFloat64OrZero(${f}))`,
	p50: (f) => `quantile(0.5)(toFloat64OrZero(${f}))`,
	p90: (f) => `quantile(0.9)(toFloat64OrZero(${f}))`,
	p95: (f) => `quantile(0.95)(toFloat64OrZero(${f}))`,
	p99: (f) => `quantile(0.99)(toFloat64OrZero(${f}))`,
	cardinality: (f) => `uniqExact(${f})`,
};

/** Resolve a group-by / field key to a ClickHouse expression. */
function fieldToExpr(field: string): string {
	if (field === "SpanName" || field === "ServiceName" || field === "Duration") {
		return field;
	}
	// Treat dotted keys as span attributes by default.
	if (field.includes(".")) {
		return `SpanAttributes['${escapeCH(field)}']`;
	}
	return field;
}

export class ClickHouseAdapter implements DataSourceAdapter {
	readonly type = "clickhouse";
	private readonly descriptor: TelemetrySourceDescriptor;

	constructor(descriptor: TelemetrySourceDescriptor) {
		this.descriptor = descriptor;
	}

	private get dbConfigId(): string | undefined {
		return this.descriptor.dbConfigId;
	}

	capabilities(): SourceCapabilities {
		return {
			signals: ["traces", "logs", "metrics"],
			traceTree: true,
			spanEvents: true,
			serverAggregation: true,
			spanMutation: true,
			distinctValues: true,
			crossTraceSession: true,
			rawQuery: true,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const start = Date.now();
		const { err, data } = await dataCollector({}, "ping", this.dbConfigId);
		return {
			ok: !err && !!data,
			message: err ? String(err) : undefined,
			latencyMs: Date.now() - start,
		};
	}

	async validateAISignal(window: QueryTimeRange): Promise<AISignalValidation> {
		const query = `SELECT CAST(COUNT(*) AS INTEGER) AS c
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${timeRangeClause(window)} AND ${aiSelectorToClickHouse()}`;
		const { data, err } = await dataCollector({ query }, "query", this.dbConfigId);
		const sampleCount = (data as { c?: number }[])?.[0]?.c ?? 0;
		return {
			ok: !err && sampleCount > 0,
			sampleCount,
			missingAttributes: [],
			message: err ? String(err) : undefined,
		};
	}

	// ---- Traces -----------------------------------------------------------

	async listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		const start = Date.now();
		const result = await getRequests(toMetricParams(query));
		const rows = ((result.records as Record<string, unknown>[]) || []).map(
			normalizeSpanRow
		);
		return {
			fields: spanFields(),
			rows,
			meta: {
				latencyMs: Date.now() - start,
				rowsScanned: Number(result.total) || rows.length,
			},
		};
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		const { record } = await getRequestViaSpanId(spanId);
		return record ? normalizeSpanRow(record as Record<string, unknown>) : null;
	}

	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		const query = `SELECT * FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE TraceId = '${escapeCH(traceId)}'
			ORDER BY Timestamp ASC
			LIMIT 5000`;
		const { data } = await dataCollector({ query }, "query", this.dbConfigId);
		return ((data as Record<string, unknown>[]) || []).map(normalizeSpanRow);
	}

	async getSpansBySession(sessionId: string): Promise<NormalizedSpan[]> {
		const s = escapeCH(sessionId);
		const query = `SELECT * FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE SpanAttributes['${AI_SELECTOR_MARKERS.codingSessionId}'] = '${s}'
				OR ResourceAttributes['coding_agent.agent.parent_id'] = '${s}'
				OR SpanAttributes['coding_agent.agent.parent_id'] = '${s}'
			ORDER BY Timestamp ASC
			LIMIT 5000`;
		const { data } = await dataCollector({ query }, "query", this.dbConfigId);
		return ((data as Record<string, unknown>[]) || []).map(normalizeSpanRow);
	}

	async aggregateSpans(query: OpenLITQuery): Promise<DataFrame> {
		const start = Date.now();
		const groupExprs = (query.groupBy || []).map(
			(g, i) => `${fieldToExpr(g)} AS g${i}`
		);
		const aggExprs = (query.aggregations || [{ fn: "count" as const }]).map(
			(a, i) => {
				const fn = AGG_FN_MAP[a.fn] || AGG_FN_MAP.count;
				const field = a.field ? fieldToExpr(a.field) : "";
				return `${fn(field)} AS ${a.as || `agg${i}`}`;
			}
		);
		const selects = [...groupExprs, ...aggExprs].join(", ");
		const groupBy = query.groupBy?.length
			? `GROUP BY ${query.groupBy.map((_, i) => `g${i}`).join(", ")}`
			: "";
		const where = [
			timeRangeClause(query.timeRange),
			query.aiSelector !== false ? aiSelectorToClickHouse() : "",
		]
			.filter(Boolean)
			.join(" AND ");
		const sql = `SELECT ${selects} FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${where} ${groupBy}
			${query.limit ? `LIMIT ${Number(query.limit)}` : ""}`;
		const { data, err } = await dataCollector({ query: sql }, "query", this.dbConfigId);
		return {
			fields: [],
			rows: (data as Record<string, unknown>[]) || [],
			meta: { latencyMs: Date.now() - start, degraded: err ? [String(err)] : undefined },
		};
	}

	async spanTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		const start = Date.now();
		const unit = intervalToTruncUnit(query.interval);
		const aggExprs = (query.aggregations || [{ fn: "count" as const }]).map(
			(a, i) => {
				const fn = AGG_FN_MAP[a.fn] || AGG_FN_MAP.count;
				const field = a.field ? fieldToExpr(a.field) : "";
				return `${fn(field)} AS ${a.as || `agg${i}`}`;
			}
		);
		const where = [
			timeRangeClause(query.timeRange),
			query.aiSelector !== false ? aiSelectorToClickHouse() : "",
		]
			.filter(Boolean)
			.join(" AND ");
		const sql = `SELECT DATE_TRUNC('${unit}', Timestamp) AS bucket, ${aggExprs.join(
			", "
		)}
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${where}
			GROUP BY bucket
			ORDER BY bucket ASC`;
		const { data } = await dataCollector({ query: sql }, "query", this.dbConfigId);
		return {
			fields: [],
			rows: (data as Record<string, unknown>[]) || [],
			meta: { latencyMs: Date.now() - start },
		};
	}

	async distinctValues(key: string, query: OpenLITQuery): Promise<string[]> {
		const expr = fieldToExpr(key);
		const where = [
			timeRangeClause(query.timeRange),
			query.aiSelector !== false ? aiSelectorToClickHouse() : "",
		]
			.filter(Boolean)
			.join(" AND ");
		const sql = `SELECT DISTINCT ${expr} AS v FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${where} AND notEmpty(toString(${expr}))
			ORDER BY v
			LIMIT 1000`;
		const { data } = await dataCollector({ query: sql }, "query", this.dbConfigId);
		return ((data as { v?: unknown }[]) || [])
			.map((r) => String(r.v ?? ""))
			.filter(Boolean);
	}

	async attributeKeys(signal: Signal, _window: QueryTimeRange): Promise<string[]> {
		if (signal === "logs") {
			const r = await getLogAttributeKeys(paramsForWindow(_window));
			return dedupeKeys(r);
		}
		if (signal === "metrics") {
			const r = await getMetricAttributeKeys(paramsForWindow(_window));
			return dedupeKeys(r);
		}
		const r = await getAttributeKeys(paramsForWindow(_window));
		return [
			...(r.spanAttributeKeys || []),
			...(r.resourceAttributeKeys || []),
		];
	}

	// ---- Logs -------------------------------------------------------------

	async listLogs(query: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		const start = Date.now();
		const result = await getLogs(toMetricParams(query));
		const rows = ((result.records as Record<string, unknown>[]) || []).map(
			normalizeLogRow
		);
		return {
			fields: [],
			rows,
			meta: { latencyMs: Date.now() - start, rowsScanned: Number(result.total) || rows.length },
		};
	}

	async getLog(logId: string): Promise<NormalizedLog | null> {
		const { record } = await getLogByRowId(logId);
		return record ? normalizeLogRow(record as Record<string, unknown>) : null;
	}

	async logTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		const start = Date.now();
		const unit = intervalToTruncUnit(query.interval);
		const sql = `SELECT DATE_TRUNC('${unit}', Timestamp) AS bucket,
				CAST(COUNT(*) AS INTEGER) AS count
			FROM ${OTEL_LOGS_TABLE_NAME}
			WHERE ${timeRangeClause(query.timeRange)}
			GROUP BY bucket
			ORDER BY bucket ASC`;
		const { data } = await dataCollector({ query: sql }, "query", this.dbConfigId);
		return {
			fields: [],
			rows: (data as Record<string, unknown>[]) || [],
			meta: { latencyMs: Date.now() - start },
		};
	}

	// ---- Metrics ----------------------------------------------------------

	async listMetricSeries(
		query: OpenLITQuery
	): Promise<DataFrame<NormalizedMetricPoint>> {
		const start = Date.now();
		const result = await getMetrics(toMetricParams(query));
		const records =
			(result as { records?: Record<string, unknown>[] }).records ||
			((result as { data?: Record<string, unknown>[] }).data as
				| Record<string, unknown>[]
				| undefined) ||
			[];
		const rows = records.map(normalizeMetricRow);
		return { fields: [], rows, meta: { latencyMs: Date.now() - start } };
	}

	async metricTimeSeries(
		query: OpenLITQuery
	): Promise<DataFrame<NormalizedMetricPoint>> {
		// getMetrics already returns time-ordered points for charting.
		return this.listMetricSeries(query);
	}

	async metricNames(window: QueryTimeRange): Promise<string[]> {
		const { data } = await getMetricsConfig(paramsForWindow(window));
		const cfg = (data as { metricNames?: string[] }[])?.[0];
		return cfg?.metricNames || [];
	}

	// ---- Discovery --------------------------------------------------------

	async discoverServices(window: QueryTimeRange): Promise<DiscoveredService[]> {
		const sql = `SELECT
				ServiceName AS serviceName,
				any(ResourceAttributes['deployment.environment']) AS environment,
				any(ResourceAttributes['k8s.cluster.name']) AS clusterId,
				any(ResourceAttributes['telemetry.sdk.name']) AS sdkName,
				any(ResourceAttributes['telemetry.sdk.language']) AS sdkLanguage,
				any(ResourceAttributes['telemetry.sdk.version']) AS sdkVersion,
				min(Timestamp) AS firstSeen,
				max(Timestamp) AS lastSeen
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${timeRangeClause(window)} AND ${aiSelectorToClickHouse()}
			GROUP BY ServiceName`;
		const { data } = await dataCollector({ query: sql }, "query", this.dbConfigId);
		return ((data as Record<string, unknown>[]) || []).map((r) => ({
			serviceName: String(r.serviceName ?? ""),
			environment: String(r.environment ?? ""),
			clusterId: String(r.clusterId ?? ""),
			sdkName: r.sdkName ? String(r.sdkName) : undefined,
			sdkLanguage: r.sdkLanguage ? String(r.sdkLanguage) : undefined,
			sdkVersion: r.sdkVersion ? String(r.sdkVersion) : undefined,
			firstSeen: r.firstSeen ? String(r.firstSeen) : undefined,
			lastSeen: r.lastSeen ? String(r.lastSeen) : undefined,
		}));
	}

	async aggregateByService(window: QueryTimeRange): Promise<ServiceRollup[]> {
		const sql = `SELECT
				ServiceName AS serviceName,
				any(ResourceAttributes['deployment.environment']) AS environment,
				any(ResourceAttributes['k8s.cluster.name']) AS clusterId,
				CAST(COUNT(*) AS INTEGER) AS requestCount,
				groupUniqArray(SpanAttributes['gen_ai.request.model']) AS models,
				groupUniqArray(SpanAttributes['gen_ai.system']) AS providers
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${timeRangeClause(window)} AND ${aiSelectorToClickHouse()}
			GROUP BY ServiceName`;
		const { data } = await dataCollector({ query: sql }, "query", this.dbConfigId);
		return ((data as Record<string, unknown>[]) || []).map((r) => ({
			serviceName: String(r.serviceName ?? ""),
			environment: String(r.environment ?? ""),
			clusterId: String(r.clusterId ?? ""),
			requestCount: Number(r.requestCount) || 0,
			models: ((r.models as string[]) || []).filter(Boolean),
			providers: ((r.providers as string[]) || []).filter(Boolean),
		}));
	}

	async sampleTracesForGraph(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		const traceIdSql = `SELECT DISTINCT TraceId FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${timeRangeClause(query.timeRange)} AND ${aiSelectorToClickHouse()}
			ORDER BY TraceId
			LIMIT ${Number(maxTraces) || 100}`;
		const { data: idRows } = await dataCollector(
			{ query: traceIdSql },
			"query",
			this.dbConfigId
		);
		const traceIds = ((idRows as { TraceId?: string }[]) || [])
			.map((r) => r.TraceId)
			.filter((id): id is string => !!id)
			.map((id) => `'${escapeCH(id)}'`);
		if (traceIds.length === 0) return [];
		const spanSql = `SELECT * FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE TraceId IN (${traceIds.join(", ")})
			ORDER BY Timestamp ASC
			LIMIT 50000`;
		const { data } = await dataCollector({ query: spanSql }, "query", this.dbConfigId);
		return ((data as Record<string, unknown>[]) || []).map(normalizeSpanRow);
	}
}

function spanFields() {
	return [
		{ name: "traceId", type: "string" as const },
		{ name: "spanId", type: "string" as const },
		{ name: "name", type: "string" as const },
		{ name: "timestamp", type: "time" as const },
		{ name: "durationNs", type: "number" as const },
	];
}

function paramsForWindow(window: QueryTimeRange) {
	return {
		timeLimit: { start: window.start, end: window.end, type: "CUSTOM" },
	} as unknown as Parameters<typeof getAttributeKeys>[0];
}

function dedupeKeys(result: unknown): string[] {
	const r = result as Record<string, unknown>;
	const out = new Set<string>();
	for (const value of Object.values(r)) {
		if (Array.isArray(value)) {
			for (const v of value) if (typeof v === "string") out.add(v);
		}
	}
	return Array.from(out);
}

/** Factory used by the registry. */
export const clickHouseAdapterFactory = {
	type: "clickhouse",
	create: (descriptor: TelemetrySourceDescriptor): DataSourceAdapter =>
		new ClickHouseAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "clickhouse",
		displayName: "ClickHouse (built-in)",
		declaredSignals: ["traces", "logs", "metrics"],
		capabilities: {
			traceTree: true,
			spanEvents: true,
			serverAggregation: true,
			spanMutation: true,
			distinctValues: true,
			crossTraceSession: true,
			rawQuery: true,
		},
		correlation: {
			crossSignal: true,
			keys: ["traceId", "spanId", "service", "session"],
		},
		// Built-in source: connection comes from the project's DB config, so the
		// external add/edit form needs no config fields.
		configFields: [],
		authStyle: "none",
	}),
};
