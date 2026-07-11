import {
	getFilterPreviousParams,
	getFilterWhereCondition,
} from "@/helpers/server/platform";
import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "../common";
import { getTraceMappingKeyFullPath } from "@/helpers/server/trace";
import {
	externalAverageCost,
	externalCostByApplication,
	externalCostByEnvironment,
	externalTotalCost,
} from "./external";

export async function getTotalCost(params: MetricParams) {
	const external = await externalTotalCost(params);
	if (external) return external;

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
	const external = await externalAverageCost(params);
	if (external) return external;

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
	const external = await externalCostByApplication(params);
	if (external) {
		return {
			err: external.err,
			data: (external.data || []).map((row: any) => ({
				applicationName: row.application,
				cost: row.total_cost,
			})),
		};
	}

	const keyPathApplicationName = `ResourceAttributes['${getTraceMappingKeyFullPath(
		"applicationName"
	)}']`;
	const keyPathCost = `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`;
	const query = `SELECT
		DISTINCT ${keyPathApplicationName} As applicationName,
			SUM(toFloat64OrZero(${keyPathCost})) AS cost
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition({
			...params,
			notEmpty: [{ key: keyPathApplicationName }, { key: keyPathCost }],
			operationType: "llm",
		}, true)}
		GROUP BY applicationName;`;

	return dataCollector({ query });
}

export async function getCostByEnvironment(params: MetricParams) {
	const external = await externalCostByEnvironment(params);
	if (external) return external;

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
