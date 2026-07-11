/**
 * Bridge legacy ClickHouse SQL widgets onto external traces sources.
 * Seeded LLM dashboards store raw `otel_traces` SQL; when the project traces
 * binding is Tempo/Jaeger/etc., we infer a structured OpenLITQuery and run it
 * through the QueryPlanner instead of silently querying empty ClickHouse.
 */

import type { MetricParams } from "@/lib/platform/common";
import { metricParamsToOpenLITQuery } from "@/lib/platform/datasource/clickhouse/query-map";
import {
	intervalFromTimeRange,
	planAndAggregateSpans,
	planAndSpanTimeSeries,
} from "@/lib/platform/datasource/query-planner";
import { shouldPreferRollup } from "@/lib/platform/datasource/rollup-policy";
import type {
	Aggregation,
	DataSourceAdapter,
	OpenLITQuery,
} from "@/lib/platform/datasource/types";
import { getFilterPreviousParams } from "@/helpers/server/platform";

export type InferredWidgetMode = "aggregate" | "timeseries";

export interface InferredWidgetQuery {
	mode: InferredWidgetMode;
	aggregations: Aggregation[];
	groupBy?: string[];
	/** Merge previous-period values + rate (stat cards). */
	includePrevious: boolean;
	primaryAlias: string;
	previousAlias?: string;
	rateAlias?: string;
}

/** True when SQL targets otel_traces and is not an evaluation-table query. */
export function isLegacyOtelTracesSql(sql: string): boolean {
	if (!/\botel_traces\b/i.test(sql)) return false;
	if (/\bopenlit_evaluation\b/i.test(sql)) return false;
	return true;
}

function firstAlias(sql: string, patterns: RegExp[]): string | undefined {
	for (const re of patterns) {
		const m = sql.match(re);
		if (m?.[1]) return m[1];
	}
	return undefined;
}

/**
 * Heuristic SQL → structured query for common seeded LLM widgets.
 * Returns null when the query cannot be safely mapped (caller should error).
 */
export function inferStructuredFromClickHouseSql(
	sql: string
): InferredWidgetQuery | null {
	if (!isLegacyOtelTracesSql(sql)) return null;

	const includePrevious =
		/prev_start_time|_previous\b/i.test(sql) &&
		!/DATE_TRUNC|request_time\b/i.test(sql);

	const isTimeseries =
		/DATE_TRUNC|AS request_time|toStartOf/i.test(sql) &&
		!includePrevious;

	const aggregations: Aggregation[] = [];
	const groupBy: string[] = [];

	// Cost
	if (/gen_ai\.usage\.cost/i.test(sql) && /sum/i.test(sql)) {
		const as =
			firstAlias(sql, [
				/AS\s+(total_usage_cost)\b/i,
				/AS\s+(total_cost)\b/i,
			]) || "total_cost";
		aggregations.push({
			fn: "sum",
			field: "gen_ai.usage.cost",
			as,
		});
	} else if (/gen_ai\.usage\.cost/i.test(sql) && /avg/i.test(sql)) {
		aggregations.push({
			fn: "avg",
			field: "gen_ai.usage.cost",
			as:
				firstAlias(sql, [/AS\s+(average_usage_cost)\b/i]) ||
				"average_usage_cost",
		});
	}

	// Tokens
	if (/gen_ai\.usage\.total_tokens/i.test(sql) && /avg/i.test(sql)) {
		aggregations.push({
			fn: "avg",
			field: "gen_ai.usage.total_tokens",
			as: firstAlias(sql, [/AS\s+(total_tokens)\b/i]) || "total_tokens",
		});
	} else if (/gen_ai\.usage\.input_tokens|prompt.?token/i.test(sql) && /avg/i.test(sql)) {
		aggregations.push({
			fn: "avg",
			field: "gen_ai.usage.input_tokens",
			as: firstAlias(sql, [/AS\s+(\w+)\b/i]) || "total_tokens",
		});
	} else if (
		/gen_ai\.usage\.output_tokens|completion.?token/i.test(sql) &&
		/avg/i.test(sql)
	) {
		aggregations.push({
			fn: "avg",
			field: "gen_ai.usage.output_tokens",
			as: firstAlias(sql, [/AS\s+(\w+)\b/i]) || "total_tokens",
		});
	} else if (/gen_ai\.usage\.total_tokens/i.test(sql) && /sum/i.test(sql)) {
		aggregations.push({
			fn: "sum",
			field: "gen_ai.usage.total_tokens",
			as: firstAlias(sql, [/AS\s+(total_tokens)\b/i]) || "total_tokens",
		});
	}

	// Duration (seconds)
	if (/\bDuration\b/i.test(sql) && /avg/i.test(sql)) {
		aggregations.push({
			fn: "avg",
			field: "duration",
			as:
				firstAlias(sql, [/AS\s+(average_duration)\b/i]) ||
				"average_duration",
		});
	}

	// Counts (default for request totals / group-by charts)
	if (
		aggregations.length === 0 ||
		(/\bcount\s*\(/i.test(sql) || /\bcountIf\s*\(/i.test(sql))
	) {
		if (
			aggregations.length === 0 ||
			(!/gen_ai\.usage\.cost/i.test(sql) &&
				!/gen_ai\.usage\.\w+_tokens/i.test(sql) &&
				!/\bDuration\b/i.test(sql))
		) {
			const as =
				firstAlias(sql, [
					/AS\s+(total_request)\b/i,
					/AS\s+(total)\b/i,
					/AS\s+(count)\b/i,
					/AS\s+(model_count)\b/i,
				]) || (isTimeseries ? "total" : "count");
			if (!aggregations.some((a) => a.fn === "count")) {
				aggregations.push({ fn: "count", as });
			}
		}
	}

	if (/gen_ai\.request\.model/i.test(sql) && /GROUP\s+BY/i.test(sql)) {
		groupBy.push("gen_ai.request.model");
	}
	if (/gen_ai\.system/i.test(sql) && /GROUP\s+BY/i.test(sql)) {
		groupBy.push("gen_ai.system");
	}
	if (/gen_ai\.operation\.name/i.test(sql) && /GROUP\s+BY/i.test(sql)) {
		groupBy.push("gen_ai.operation.name");
	}
	if (
		/ResourceAttributes\s*\[\s*'service\.name'\s*\]|service\.name/i.test(sql) &&
		/GROUP\s+BY/i.test(sql)
	) {
		groupBy.push("service.name");
	}
	if (
		/deployment\.environment/i.test(sql) &&
		/GROUP\s+BY/i.test(sql)
	) {
		groupBy.push("deployment.environment");
	}

	if (!aggregations.length) return null;

	const primaryAlias = aggregations[0].as || "count";
	const previousAlias = includePrevious
		? firstAlias(sql, [
				/AS\s+(\w+_previous)\b/i,
				new RegExp(`AS\\s+(${primaryAlias}_previous)\\b`, "i"),
			]) || `${primaryAlias}_previous`
		: undefined;

	return {
		mode: isTimeseries ? "timeseries" : "aggregate",
		aggregations,
		groupBy: groupBy.length ? groupBy : undefined,
		includePrevious,
		primaryAlias,
		previousAlias,
		rateAlias: includePrevious ? "rate" : undefined,
	};
}

function percentChange(current: number, previous: number): number {
	if (previous === 0) return Number((current * 100).toFixed(4));
	return Number((((current - previous) / previous) * 100).toFixed(4));
}

function rowNumber(
	row: Record<string, unknown> | undefined,
	keys: string[]
): number {
	if (!row) return 0;
	for (const key of keys) {
		const n = Number(row[key]);
		if (Number.isFinite(n)) return n;
	}
	return 0;
}

function renameGroupColumns(
	rows: Record<string, unknown>[],
	groupBy: string[] | undefined
): Record<string, unknown>[] {
	if (!groupBy?.length) return rows;
	const field = groupBy[0];
	const alias =
		field === "gen_ai.request.model"
			? "model"
			: field === "gen_ai.system"
				? "provider"
				: field === "gen_ai.operation.name"
					? "category"
					: field === "service.name"
						? "application"
						: field === "deployment.environment"
							? "environment"
							: "group_value";
	return rows.map((row) => {
		const value =
			row[alias] ??
			row.group_value ??
			row.g0 ??
			row[field] ??
			"";
		const next: Record<string, unknown> = { ...row, [alias]: String(value) };
		if (field === "service.name") {
			next.applicationName = String(value);
			next.application = String(value);
		}
		return next;
	});
}

function escapeSql(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function fieldToClickHouseExpr(field: string, scope?: string): string {
	if (field === "SpanName" || field === "duration" || field === "Duration") {
		return field === "duration" ? "Duration" : field;
	}
	if (field === "service.name" || field === "ServiceName") {
		return "ServiceName";
	}
	if (scope === "resource" || field.startsWith("deployment.") || field === "telemetry.sdk.name") {
		return `ResourceAttributes['${escapeSql(field)}']`;
	}
	if (field.includes(".")) {
		return `SpanAttributes['${escapeSql(field)}']`;
	}
	return field;
}

function filterToClickHouseSql(filter: {
	target?: string;
	scope?: string;
	key?: string;
	op?: string;
	value?: string | string[] | number;
}): string | null {
	const op = filter.op || "eq";
	if (filter.target === "status") {
		const values = Array.isArray(filter.value)
			? filter.value.map(String)
			: [String(filter.value ?? "")];
		const list = values
			.filter(Boolean)
			.map((v) => `'${escapeSql(v)}'`)
			.join(", ");
		return list ? `StatusCode IN (${list})` : null;
	}
	if (filter.target === "spanName") {
		const values = Array.isArray(filter.value)
			? filter.value.map(String)
			: [String(filter.value ?? "")];
		if (op === "contains") {
			return `positionCaseInsensitive(SpanName, '${escapeSql(values[0] || "")}') > 0`;
		}
		const list = values
			.filter(Boolean)
			.map((v) => `'${escapeSql(v)}'`)
			.join(", ");
		return list ? `SpanName IN (${list})` : null;
	}
	if (filter.target === "duration") {
		const n = Number(filter.value);
		if (!Number.isFinite(n)) return null;
		if (op === "gt") return `Duration > ${n}`;
		if (op === "gte") return `Duration >= ${n}`;
		if (op === "lt") return `Duration < ${n}`;
		if (op === "lte") return `Duration <= ${n}`;
		return `Duration = ${n}`;
	}
	const key = filter.key || "";
	if (!key) return null;
	const expr = fieldToClickHouseExpr(key, filter.scope);
	if (op === "exists") return `notEmpty(toString(${expr}))`;
	if (op === "notExists") return `empty(toString(${expr}))`;
	if (op === "contains") {
		return `positionCaseInsensitive(toString(${expr}), '${escapeSql(
			String(filter.value ?? "")
		)}') > 0`;
	}
	if (op === "in" || op === "notIn") {
		const values = Array.isArray(filter.value)
			? filter.value.map(String)
			: String(filter.value ?? "")
					.split(",")
					.map((v) => v.trim())
					.filter(Boolean);
		const list = values.map((v) => `'${escapeSql(v)}'`).join(", ");
		if (!list) return null;
		return op === "notIn"
			? `toString(${expr}) NOT IN (${list})`
			: `toString(${expr}) IN (${list})`;
	}
	const cmp =
		op === "neq"
			? "!="
			: op === "gt"
				? ">"
				: op === "gte"
					? ">="
					: op === "lt"
						? "<"
						: op === "lte"
							? "<="
							: "=";
	const raw = filter.value;
	if (typeof raw === "number" || (typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw))) {
		return `toFloat64OrZero(toString(${expr})) ${cmp} ${Number(raw)}`;
	}
	return `toString(${expr}) ${cmp} '${escapeSql(String(raw ?? ""))}'`;
}

const AGG_SQL: Record<string, (field: string) => string> = {
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

function intervalToTrunc(interval?: string): string {
	if (!interval) return "hour";
	if (/d$/i.test(interval)) return "day";
	if (/m$/i.test(interval) && !/mo/i.test(interval)) return "minute";
	if (/s$/i.test(interval)) return "second";
	return "hour";
}

/**
 * Inverse of `inferStructuredFromClickHouseSql`: build a readable ClickHouse
 * SELECT from an OpenLITQuery for the widget builder "view generated query"
 * toggle and native built-in execution previews.
 */
export function openLITQueryToClickHouseSql(
	query: Partial<OpenLITQuery> & { includePrevious?: boolean },
	mode: "list" | "aggregate" | "timeseries" = "aggregate"
): string {
	const filterSql = (query.filters || [])
		.map((f) => filterToClickHouseSql(f))
		.filter(Boolean) as string[];
	const whereParts = [
		"Timestamp >= parseDateTimeBestEffort('{{filter.timeLimit.start}}')",
		"Timestamp <= parseDateTimeBestEffort('{{filter.timeLimit.end}}')",
		...filterSql,
	];
	if (query.aiSelector !== false) {
		whereParts.push(
			"(ResourceAttributes['telemetry.sdk.name'] = 'openlit' OR notEmpty(SpanAttributes['gen_ai.operation.name']) OR notEmpty(SpanAttributes['gen_ai.request.model']))"
		);
	}
	const where = whereParts.join("\n\t\tAND ");

	if (mode === "list") {
		const limit = Number(query.limit || 100);
		return `SELECT *\nFROM otel_traces\nWHERE ${where}\nORDER BY Timestamp DESC\nLIMIT ${limit}`;
	}

	const aggs = (query.aggregations?.length
		? query.aggregations
		: [{ fn: "count" as const, as: "count" }]
	).map((a, i) => {
		const fn = AGG_SQL[a.fn] || AGG_SQL.count;
		const field = a.field ? fieldToClickHouseExpr(a.field) : "";
		return `${fn(field)} AS ${a.as || `agg${i}`}`;
	});

	if (mode === "timeseries") {
		const unit = intervalToTrunc(query.interval);
		return `SELECT
	formatDateTime(DATE_TRUNC('${unit}', Timestamp), '%Y/%m/%d %R') AS request_time,
	${aggs.join(",\n\t")}
FROM otel_traces
WHERE ${where}
GROUP BY request_time
ORDER BY request_time`;
	}

	const groupBy = query.groupBy || [];
	const groupSelects = groupBy.map(
		(g, i) => `${fieldToClickHouseExpr(g)} AS g${i}`
	);
	const selects = [...groupSelects, ...aggs].join(",\n\t");
	const groupClause = groupBy.length
		? `\nGROUP BY ${groupBy.map((_, i) => `g${i}`).join(", ")}`
		: "";
	return `SELECT\n\t${selects}\nFROM otel_traces\nWHERE ${where}${groupClause}`;
}

/** Convert SQL-inferred shape into the widget `structuredQuery` config. */
export function inferredToStructuredQuery(inferred: InferredWidgetQuery): {
	mode: InferredWidgetMode;
	query: Record<string, unknown>;
} {
	return {
		mode: inferred.mode,
		query: {
			signal: "traces",
			aiSelector: true,
			aggregations: inferred.aggregations,
			...(inferred.groupBy?.length ? { groupBy: inferred.groupBy } : {}),
			...(inferred.mode === "timeseries" ? { interval: "1h" } : {}),
			...(inferred.includePrevious
				? { includePrevious: true, rateAlias: inferred.rateAlias || "rate" }
				: {}),
		},
	};
}

/** Execute an inferred widget query via the QueryPlanner. */
export async function executeInferredWidgetQuery(
	adapter: DataSourceAdapter,
	inferred: InferredWidgetQuery,
	filter: MetricParams
): Promise<{ data?: unknown[]; err?: string }> {
	const base = metricParamsToOpenLITQuery(filter, "traces");
	const preferRollup = shouldPreferRollup(filter);

	const buildQuery = (params: MetricParams): OpenLITQuery => {
		const mapped = metricParamsToOpenLITQuery(params, "traces");
		return {
			...mapped,
			aggregations: inferred.aggregations,
			groupBy: inferred.groupBy,
			interval:
				inferred.mode === "timeseries"
					? intervalFromTimeRange(
							mapped.timeRange.start,
							mapped.timeRange.end
						)
					: mapped.interval,
			aiSelector: true,
		};
	};

	try {
		if (inferred.mode === "timeseries") {
			const frame = await planAndSpanTimeSeries(adapter, buildQuery(filter), {
				preferRollup,
			});
			const data = (frame.rows as Record<string, unknown>[]).map((row) => ({
				...row,
				total: Number(row.total ?? row.count ?? 0),
				request_time: String(
					row.request_time ?? row.label ?? row.bucket ?? ""
				),
				total_tokens: Number(row.total_tokens ?? row.tokens ?? 0),
				total_cost: Number(row.total_cost ?? row.cost ?? 0),
			}));
			return { data };
		}

		const currentFrame = await planAndAggregateSpans(
			adapter,
			buildQuery(filter),
			{ preferRollup }
		);
		let rows = renameGroupColumns(
			currentFrame.rows as Record<string, unknown>[],
			inferred.groupBy
		);

		if (inferred.includePrevious && inferred.previousAlias) {
			const previousFrame = await planAndAggregateSpans(
				adapter,
				buildQuery(getFilterPreviousParams(filter)),
				{ preferRollup: false }
			);
			const currentVal = rowNumber(rows[0] as Record<string, unknown>, [
				inferred.primaryAlias,
				"count",
				"total",
			]);
			const previousVal = rowNumber(
				previousFrame.rows[0] as Record<string, unknown>,
				[inferred.primaryAlias, "count", "total"]
			);
			rows = [
				{
					...(rows[0] || {}),
					[inferred.primaryAlias]: currentVal,
					[inferred.previousAlias]: previousVal,
					...(inferred.rateAlias
						? { [inferred.rateAlias]: percentChange(currentVal, previousVal) }
						: {}),
				},
			];
		}

		return { data: rows };
	} catch (err) {
		return {
			err: err instanceof Error ? err.message : String(err),
		};
	}
}
