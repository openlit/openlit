import {
	MetricParams,
	OTEL_LOGS_TABLE_NAME,
	OTEL_TRACES_TABLE_NAME,
	OTEL_METRICS_EXPONENTIAL_HISTOGRAM_TABLE_NAME,
	OTEL_METRICS_GAUGE_TABLE_NAME,
	OTEL_METRICS_HISTOGRAM_TABLE_NAME,
	OTEL_METRICS_SUMMARY_TABLE_NAME,
	OTEL_METRICS_SUM_TABLE_NAME,
	dataCollector,
} from "./common";
import {
	dateTruncGroupingLogic,
	getFilterWhereCondition,
} from "@/helpers/server/platform";
import { CustomFilterAttributeType } from "@/types/store/filter";

type FilterTable = "logs" | "metrics";
type SummarySignal = "traces" | "exceptions" | "logs" | "metrics";

const METRIC_TABLES = [
	{ table: OTEL_METRICS_GAUGE_TABLE_NAME, type: "gauge", valueExpr: "Value", countExpr: "1" },
	{ table: OTEL_METRICS_SUM_TABLE_NAME, type: "sum", valueExpr: "Value", countExpr: "1" },
	{ table: OTEL_METRICS_HISTOGRAM_TABLE_NAME, type: "histogram", valueExpr: "Sum", countExpr: "Count" },
	{ table: OTEL_METRICS_SUMMARY_TABLE_NAME, type: "summary", valueExpr: "Sum", countExpr: "Count" },
	{
		table: OTEL_METRICS_EXPONENTIAL_HISTOGRAM_TABLE_NAME,
		type: "exponential_histogram",
		valueExpr: "Sum",
		countExpr: "Count",
	},
];

const LOG_FIELD_GROUP_BY = new Set([
	"Timestamp",
	"TraceId",
	"SpanId",
	"SeverityText",
	"SeverityNumber",
	"ServiceName",
	"Body",
	"ScopeName",
	"ScopeVersion",
]);

const METRIC_FIELD_GROUP_BY = new Set([
	"ServiceName",
	"MetricName",
	"MetricDescription",
	"MetricUnit",
	"ScopeName",
	"ScopeVersion",
	"TimeUnix",
]);

function escapeClickHouseString(value: string) {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function getSummaryBucket(params: MetricParams) {
	const start = new Date(params.timeLimit.start as Date | string);
	const end = new Date(params.timeLimit.end as Date | string);
	const days = Math.max(1, (end.getTime() - start.getTime()) / 86400000);

	if (days <= 2) return "hour";
	if (days <= 45) return "day";
	if (days <= 370) return "week";
	return "month";
}

function bucketLabelFormat(bucket: string) {
	if (bucket === "hour") return "%m/%d %H:00";
	if (bucket === "month") return "%Y/%m";
	return "%Y/%m/%d";
}

function inList(values: string[]) {
	return values.map((value) => `'${escapeClickHouseString(value)}'`).join(", ");
}

function customFilterExpression(
	table: FilterTable,
	attributeType: CustomFilterAttributeType,
	key: string,
	value: string
) {
	const safeValue = escapeClickHouseString(value);
	const safeKey = escapeClickHouseString(key);
	const safeField = key.replace(/[^A-Za-z0-9_.]/g, "");

	if (attributeType === "ResourceAttributes") {
		return `ResourceAttributes['${safeKey}'] = '${safeValue}'`;
	}
	if (attributeType === "ScopeAttributes") {
		return `ScopeAttributes['${safeKey}'] = '${safeValue}'`;
	}
	if (attributeType === "LogAttributes" && table === "logs") {
		return `LogAttributes['${safeKey}'] = '${safeValue}'`;
	}
	if (attributeType === "Attributes" && table === "metrics") {
		return `Attributes['${safeKey}'] = '${safeValue}'`;
	}
	if (attributeType === "Field" && safeField) {
		const allowed = table === "logs" ? LOG_FIELD_GROUP_BY : METRIC_FIELD_GROUP_BY;
		if (allowed.has(safeField)) return `${safeField} = '${safeValue}'`;
	}
	return "";
}

function buildWhere(params: MetricParams, table: FilterTable) {
	const where: string[] = [];
	const timeColumn = table === "logs" ? "Timestamp" : "TimeUnix";
	const { start, end } = params.timeLimit || {};
	if (start && end) {
		where.push(
			`${timeColumn} >= parseDateTimeBestEffort('${start}') AND ${timeColumn} <= parseDateTimeBestEffort('${end}')`
		);
	}

	const selected = params.selectedConfig || {};
	if (selected.services?.length) {
		where.push(`ServiceName IN (${inList(selected.services)})`);
	}
	if (table === "logs" && selected.severities?.length) {
		const severities = selected.severities.map((severity: string) => severity.toLowerCase());
		where.push(`lower(SeverityText) IN (${inList(severities)})`);
	}
	if (table === "metrics") {
		if (selected.metricNames?.length) {
			where.push(`MetricName IN (${inList(selected.metricNames)})`);
		}
	}
	if (selected.customFilters?.length) {
		selected.customFilters.forEach(
			({
				attributeType,
				key,
				value,
			}: {
				attributeType: CustomFilterAttributeType;
				key: string;
				value: string;
			}) => {
				if (!key || !value) return;
				const expr = customFilterExpression(table, attributeType, key, value);
				if (expr) where.push(expr);
			}
		);
	}

	if (table === "logs" && selected.traceIds?.length) {
		where.push(`TraceId IN (${inList(selected.traceIds)})`);
	}
	if (table === "logs" && selected.spanIds?.length) {
		where.push(`SpanId IN (${inList(selected.spanIds)})`);
	}

	return where.length ? where.join(" AND ") : "1 = 1";
}

function metricUnionSelect(params: MetricParams, selectSql: string) {
	const where = buildWhere(params, "metrics");
	const selectedTypes = params.selectedConfig?.metricTypes as string[] | undefined;
	const tables = selectedTypes?.length
		? METRIC_TABLES.filter(({ type }) => selectedTypes.includes(type))
		: METRIC_TABLES;
	return tables.map(
		({ table, type, valueExpr, countExpr }) => `
			SELECT
				'${type}' AS metric_type,
				${valueExpr} AS metric_value,
				${countExpr} AS metric_sample_count,
				${selectSql}
			FROM ${table}
			WHERE ${where}
		`
	).join(" UNION ALL ");
}

export async function getLogsConfig(params: MetricParams) {
	const query = `
		SELECT
			arrayFilter(x -> x != '', ARRAY_AGG(DISTINCT ServiceName)) AS services,
			arrayFilter(x -> x != '', ARRAY_AGG(DISTINCT SeverityText)) AS severities,
			CAST(COUNT(*) AS INTEGER) AS totalRows
		FROM ${OTEL_LOGS_TABLE_NAME}
		WHERE ${buildWhere(params, "logs")}
	`;
	return dataCollector({ query });
}

export async function getLogAttributeKeys(params: MetricParams) {
	const where = buildWhere(params, "logs");
	const queries = [
		{
			key: "logAttributeKeys",
			query: `SELECT DISTINCT arrayJoin(mapKeys(LogAttributes)) AS key FROM ${OTEL_LOGS_TABLE_NAME} WHERE ${where} ORDER BY key LIMIT 500`,
		},
		{
			key: "resourceAttributeKeys",
			query: `SELECT DISTINCT arrayJoin(mapKeys(ResourceAttributes)) AS key FROM ${OTEL_LOGS_TABLE_NAME} WHERE ${where} ORDER BY key LIMIT 500`,
		},
		{
			key: "scopeAttributeKeys",
			query: `SELECT DISTINCT arrayJoin(mapKeys(ScopeAttributes)) AS key FROM ${OTEL_LOGS_TABLE_NAME} WHERE ${where} ORDER BY key LIMIT 500`,
		},
	];
	const results = await Promise.all(queries.map(({ query }) => dataCollector({ query })));
	return {
		err: results.find((result) => result.err)?.err ?? null,
		spanAttributeKeys: [],
		resourceAttributeKeys:
			(results[1].data as { key: string }[] | undefined)?.map((row) => row.key) ?? [],
		logAttributeKeys:
			(results[0].data as { key: string }[] | undefined)?.map((row) => row.key) ?? [],
		scopeAttributeKeys:
			(results[2].data as { key: string }[] | undefined)?.map((row) => row.key) ?? [],
	};
}

export async function getLogs(params: MetricParams) {
	const { limit = 25, offset = 0 } = params;
	const where = buildWhere(params, "logs");
	const countQuery = `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM ${OTEL_LOGS_TABLE_NAME} WHERE ${where}`;
	const { data: countData, err: countErr } = await dataCollector({ query: countQuery });
	if (countErr) return { err: countErr };

	const orderBy = params.sorting?.type
		? `${params.sorting.type.replace(/[^A-Za-z0-9_.]/g, "")} ${params.sorting.direction}`
		: "Timestamp desc";
	const query = `
		SELECT
			cityHash64(toString(Timestamp), TraceId, SpanId, SeverityText, Body) AS rowId,
			*
		FROM ${OTEL_LOGS_TABLE_NAME}
		WHERE ${where}
		ORDER BY ${orderBy}
		LIMIT ${limit}
		OFFSET ${offset}
	`;
	const { data, err } = await dataCollector({ query });
	return {
		err,
		records: data,
		total: (countData as any[])?.[0]?.total || 0,
	};
}

export async function getSignalSummary(
	params: MetricParams,
	signal: SummarySignal
) {
	const bucket = getSummaryBucket(params);
	const labelFormat = bucketLabelFormat(bucket);
	let query = "";

	if (signal === "traces" || signal === "exceptions") {
		const traceParams: MetricParams = {
			...params,
			...(signal === "exceptions"
				? { statusCode: ["STATUS_CODE_ERROR", "Error"] }
				: {}),
		};
		const where = getFilterWhereCondition(traceParams, true);
		query = `
			SELECT
				formatDateTime(DATE_TRUNC('${bucket}', Timestamp), '${labelFormat}') AS label,
				CAST(COUNT(*) AS INTEGER) AS count,
				CAST(avg(Duration) * 1e-9 AS FLOAT) AS avgDuration,
				CAST(SUM(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost'])) AS FLOAT) AS cost,
				CAST(SUM(toInt64OrZero(SpanAttributes['gen_ai.usage.total_tokens'])) AS INTEGER) AS tokens
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${where}
			GROUP BY label
			ORDER BY min(Timestamp)
		`;
	} else if (signal === "logs") {
		const where = buildWhere(params, "logs");
		query = `
			SELECT
				formatDateTime(DATE_TRUNC('${bucket}', Timestamp), '${labelFormat}') AS label,
				CAST(COUNT(*) AS INTEGER) AS count,
				CAST(countIf(SeverityText IN ('ERROR', 'Error', 'error', 'FATAL', 'Fatal', 'fatal')) AS INTEGER) AS errors,
				CAST(uniqExact(ServiceName) AS INTEGER) AS services
			FROM ${OTEL_LOGS_TABLE_NAME}
			WHERE ${where}
			GROUP BY label
			ORDER BY min(Timestamp)
		`;
	} else {
		const union = metricUnionSelect(params, "ServiceName, MetricName, TimeUnix");
		query = `
			SELECT
				formatDateTime(DATE_TRUNC('${bucket}', TimeUnix), '${labelFormat}') AS label,
				CAST(COUNT(*) AS INTEGER) AS count,
				CAST(uniqExact(MetricName) AS INTEGER) AS metrics,
				CAST(uniqExact(ServiceName) AS INTEGER) AS services
			FROM (${union})
			GROUP BY label
			ORDER BY min(TimeUnix)
		`;
	}

	const { data, err } = await dataCollector({ query });
	const buckets = (data as any[]) || [];
	const total = buckets.reduce((sum, row) => sum + Number(row.count || 0), 0);

	return {
		err,
		bucket,
		buckets,
		total,
		peak: buckets.reduce((max, row) => Math.max(max, Number(row.count || 0)), 0),
	};
}

export async function getLogByRowId(rowId: string) {
	const safeRowId = rowId.replace(/[^0-9]/g, "");
	const query = `
		SELECT
			cityHash64(toString(Timestamp), TraceId, SpanId, SeverityText, Body) AS rowId,
			*
		FROM ${OTEL_LOGS_TABLE_NAME}
		WHERE cityHash64(toString(Timestamp), TraceId, SpanId, SeverityText, Body) = ${safeRowId || "0"}
		LIMIT 1
	`;
	const { data, err } = await dataCollector({ query });
	return { err, record: (data as any[])?.[0] };
}

export async function getMetricsConfig(params: MetricParams) {
	const query = `
		SELECT
			arrayFilter(x -> x != '', ARRAY_AGG(DISTINCT ServiceName)) AS services,
			arrayFilter(x -> x != '', ARRAY_AGG(DISTINCT MetricName)) AS metricNames,
			arrayFilter(x -> x != '', ARRAY_AGG(DISTINCT metric_type)) AS metricTypes,
			CAST(COUNT(*) AS INTEGER) AS totalRows
		FROM (${metricUnionSelect(params, "ServiceName, MetricName")})
	`;
	return dataCollector({ query });
}

export async function getMetricAttributeKeys(params: MetricParams) {
	const queries = METRIC_TABLES.map(({ table }) => ({
		metric: `SELECT DISTINCT arrayJoin(mapKeys(Attributes)) AS key FROM ${table} WHERE ${buildWhere(params, "metrics")}`,
		resource: `SELECT DISTINCT arrayJoin(mapKeys(ResourceAttributes)) AS key FROM ${table} WHERE ${buildWhere(params, "metrics")}`,
		scope: `SELECT DISTINCT arrayJoin(mapKeys(ScopeAttributes)) AS key FROM ${table} WHERE ${buildWhere(params, "metrics")}`,
	}));
	const [metricResult, resourceResult, scopeResult] = await Promise.all([
		dataCollector({
			query: `${queries.map((q) => q.metric).join(" UNION DISTINCT ")} ORDER BY key LIMIT 500`,
		}),
		dataCollector({
			query: `${queries.map((q) => q.resource).join(" UNION DISTINCT ")} ORDER BY key LIMIT 500`,
		}),
		dataCollector({
			query: `${queries.map((q) => q.scope).join(" UNION DISTINCT ")} ORDER BY key LIMIT 500`,
		}),
	]);
	return {
		err: metricResult.err || resourceResult.err || scopeResult.err,
		spanAttributeKeys: [],
		resourceAttributeKeys:
			(resourceResult.data as { key: string }[] | undefined)?.map((row) => row.key) ?? [],
		metricAttributeKeys:
			(metricResult.data as { key: string }[] | undefined)?.map((row) => row.key) ?? [],
		scopeAttributeKeys:
			(scopeResult.data as { key: string }[] | undefined)?.map((row) => row.key) ?? [],
	};
}

export async function getMetrics(params: MetricParams) {
	const { limit = 25, offset = 0 } = params;
	const union = metricUnionSelect(
		params,
		"ServiceName, MetricName, MetricDescription, MetricUnit, TimeUnix, Attributes, ResourceAttributes, ScopeName, ScopeVersion, ScopeAttributes"
	);
	const countQuery = `
		SELECT CAST(COUNT(*) AS INTEGER) AS total
		FROM (
			SELECT MetricName, metric_type, ServiceName
			FROM (${union})
			GROUP BY MetricName, metric_type, ServiceName
		)
	`;
	const { data: countData, err: countErr } = await dataCollector({ query: countQuery });
	if (countErr) return { err: countErr };

	const query = `
		SELECT
			MetricName AS metricName,
			metric_type AS metricType,
			ServiceName AS serviceName,
			anyLast(MetricDescription) AS metricDescription,
			anyLast(MetricUnit) AS metricUnit,
			CAST(argMax(metric_value, TimeUnix) AS FLOAT) AS latestValue,
			CAST(avg(metric_value) AS FLOAT) AS avgValue,
			CAST(min(metric_value) AS FLOAT) AS minValue,
			CAST(max(metric_value) AS FLOAT) AS maxValue,
			CAST(COUNT(*) AS INTEGER) AS pointCount,
			CAST(SUM(metric_sample_count) AS INTEGER) AS observationCount,
			max(TimeUnix) AS lastSeen
		FROM (${union})
		GROUP BY MetricName, metric_type, ServiceName
		ORDER BY lastSeen DESC
		LIMIT ${limit}
		OFFSET ${offset}
	`;
	const { data, err } = await dataCollector({ query });
	return {
		err,
		records: data,
		total: (countData as any[])?.[0]?.total || 0,
	};
}

export async function getMetricDetail(metricName: string, metricType?: string, serviceName?: string, params?: MetricParams) {
	const safeMetricName = escapeClickHouseString(metricName);
	const selectedConfig = {
		...(params?.selectedConfig || {}),
		metricNames: [metricName],
		...(metricType ? { metricTypes: [metricType] } : {}),
		...(serviceName ? { services: [serviceName] } : {}),
	};
	const effectiveParams: MetricParams = {
		timeLimit: params?.timeLimit || {
			type: "24H",
			start: new Date(Date.now() - 24 * 60 * 60 * 1000),
			end: new Date(),
		},
		selectedConfig,
	};
	const start = new Date(effectiveParams.timeLimit.start as Date | string);
	const end = new Date(effectiveParams.timeLimit.end as Date | string);
	const dateTrunc = dateTruncGroupingLogic(end, start);
	const union = metricUnionSelect(
		effectiveParams,
		"ServiceName, MetricName, MetricDescription, MetricUnit, TimeUnix, Attributes, ResourceAttributes, ScopeName, ScopeVersion, ScopeAttributes"
	);
	const seriesQuery = `
		SELECT
			formatDateTime(DATE_TRUNC('${dateTrunc}', TimeUnix), '%Y/%m/%d %R') AS request_time,
			CAST(avg(metric_value) AS FLOAT) AS value
		FROM (${union})
		WHERE MetricName = '${safeMetricName}'
		GROUP BY request_time
		ORDER BY request_time
	`;
	const pointsQuery = `
		SELECT *
		FROM (${union})
		WHERE MetricName = '${safeMetricName}'
		ORDER BY TimeUnix DESC
		LIMIT 100
	`;
	const [series, points] = await Promise.all([
		dataCollector({ query: seriesQuery }),
		dataCollector({ query: pointsQuery }),
	]);
	return {
		err: series.err || points.err,
		series: series.data ?? [],
		points: points.data ?? [],
	};
}
