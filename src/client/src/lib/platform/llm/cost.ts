import {
	dateTruncGroupingLogic,
	getFilterPreviousParams,
	getFilterWhereCondition,
} from "@/helpers/server/platform";
import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "../common";
import {
	getTraceMappingKeyFullPath,
	getTraceMappingKeyFullPaths,
} from "@/helpers/server/trace";

function getProviderKeyPath() {
	const paths = (getTraceMappingKeyFullPaths("provider") as string[]).map(
		(path) => `SpanAttributes['${path}']`
	);
	return {
		paths,
		keyPath: paths.reduce(
			(expression, path) =>
				`if(notEmpty(${expression}), ${expression}, ${path})`
		),
	};
}

export async function getTotalCost(params: MetricParams) {
	const keyPath = `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`;
	const currentWhereParams = { ...params, notEmpty: [{ key: keyPath }] };
	const previousWhereParams = getFilterPreviousParams(currentWhereParams);

	const commonQuery = (parameters: any) => `
		SELECT
			sum(toFloat64OrZero(${keyPath})) AS total_usage_cost,
			'${params.timeLimit.start}' as start_date
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition({ ...parameters, operationType: "llm" }, true)}
	`;

	const query = `
		SELECT
			CAST(current_data.total_usage_cost AS FLOAT) AS total_usage_cost,
			CAST(previous_day.total_usage_cost AS FLOAT) AS previous_total_usage_cost
		FROM
			(
				${commonQuery(currentWhereParams)}
			) as current_data
			JOIN
			(
				${commonQuery(previousWhereParams)}
			) as previous_day
		ON
			current_data.start_date = previous_day.start_date;
	`;

	return dataCollector({ query });
}

export async function getAverageCost(params: MetricParams) {
	const keyPath = `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`;

	const currentWhereParams = { ...params, notEmpty: [{ key: keyPath }] };
	const previousWhereParams = getFilterPreviousParams(currentWhereParams);

	const commonQuery = (parameters: any) => `
		SELECT
			avg(toFloat64OrZero(${keyPath})) AS average_usage_cost,
			'${params.timeLimit.start}' as start_date
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition({ ...parameters, operationType: "llm" }, true)}
	`;

	const query = `
		SELECT
			CAST(current_data.average_usage_cost AS FLOAT) AS average_usage_cost,
			CAST(previous_day.average_usage_cost AS FLOAT) AS previous_average_usage_cost
		FROM
			(
				${commonQuery(currentWhereParams)}
			) as current_data
			JOIN
			(
				${commonQuery(previousWhereParams)}
			) as previous_day
		ON
			current_data.start_date = previous_day.start_date;
	`;

	return dataCollector({ query });
}

export async function getCostByApplication(params: MetricParams) {
	// Prefer OTel ServiceName / service.name (what instrumented apps emit).
	// Legacy spans may still carry gen_ai.application_name. The previous
	// path wrapped the SpanAttributes key in ResourceAttributes[...], which
	// never matched and left Cost by application empty.
	const applicationPaths = [
		"ServiceName",
		"ResourceAttributes['service.name']",
		"SpanAttributes['gen_ai.application_name']",
	];
	const keyPathApplicationName = `coalesce(${applicationPaths
		.map((path) => `nullIf(${path}, '')`)
		.join(", ")})`;
	const keyPathCost = `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`;
	const query = `SELECT
		${keyPathApplicationName} AS applicationName,
		SUM(toFloat64OrZero(${keyPathCost})) AS cost
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition({
			...params,
			notOrEmpty: applicationPaths.map((key) => ({ key })),
			notEmpty: [{ key: keyPathCost }],
			operationType: "llm",
		}, true)}
		GROUP BY applicationName`;

	return dataCollector({ query });
}

export async function getCostByEnvironment(params: MetricParams) {
	// See `helpers/server/platform.ts` — environment lives at
	// `ResourceAttributes['deployment.environment']` (OTel standard).
	const keyPathEnvironment = `ResourceAttributes['deployment.environment']`;
	const keyPathCost = `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`;
	const query = `SELECT 
			DISTINCT ${keyPathEnvironment} as environment, 
			SUM(toFloat64OrZero(${keyPathCost})) AS cost
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition({
			...params,
			notEmpty: [{ key: keyPathEnvironment }, { key: keyPathCost }],
			operationType: "llm",
		}, true)}
		GROUP BY environment`;

	return dataCollector({ query });
}

export async function getCostByProvider(params: MetricParams) {
	const { paths, keyPath } = getProviderKeyPath();
	const keyPathCost = `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`;
	const query = `
		SELECT
			${keyPath} AS provider,
			SUM(toFloat64OrZero(${keyPathCost})) AS cost
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition({
			...params,
			notOrEmpty: paths.map((key) => ({ key })),
			notEmpty: [{ key: keyPathCost }],
			operationType: "llm",
		}, true)}
		GROUP BY provider
		ORDER BY cost DESC;
	`;

	return dataCollector({ query });
}

export async function getCostByModel(params: MetricParams) {
	const keyPathModel = `SpanAttributes['${getTraceMappingKeyFullPath("model")}']`;
	const keyPathCost = `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`;
	const query = `
		SELECT
			${keyPathModel} AS model,
			SUM(toFloat64OrZero(${keyPathCost})) AS cost
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition({
			...params,
			notEmpty: [{ key: keyPathModel }, { key: keyPathCost }],
			operationType: "llm",
		}, true)}
		GROUP BY model
		ORDER BY cost DESC;
	`;

	return dataCollector({ query });
}

export async function getCostPerTime(params: MetricParams) {
	const { start, end } = params.timeLimit;
	const dateTrunc = dateTruncGroupingLogic(end as Date, start as Date);
	const keyPathCost = `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`;

	const query = `
		SELECT
			CAST(SUM(toFloat64OrZero(${keyPathCost})) AS FLOAT) AS cost,
			formatDateTime(DATE_TRUNC('${dateTrunc}', Timestamp), '%Y/%m/%d %R') AS request_time
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition({
			...params,
			notEmpty: [{ key: keyPathCost }],
			operationType: "llm",
		}, true)}
		GROUP BY request_time
		ORDER BY request_time;
	`;

	return dataCollector({ query });
}
