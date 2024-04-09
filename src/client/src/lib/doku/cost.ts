import { getFilterWhereCondition } from "@/helpers/doku";
import { DokuParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "./common";
import { getTraceMappingKeyFullPath } from "@/helpers/trace";

export async function getTotalCost(params: DokuParams) {
	const query = `SELECT
			sum(toFloat64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
				"cost"
			)}'])) AS total_usage_cost
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(params)}`;

	return dataCollector({ query });
}

export async function getAverageCost(params: DokuParams) {
	const query = `SELECT
			avg(toFloat64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
				"cost"
			)}'])) AS average_usage_cost
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(params)}`;

	return dataCollector({ query });
}

export async function getCostByApplication(params: DokuParams) {
	const query = `SELECT
		DISTINCT SpanAttributes['${getTraceMappingKeyFullPath(
				"applicationName"
			)}'] As applicationName,
			SUM(toFloat64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
				"cost"
			)}'])) AS cost
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(params)}
		GROUP BY applicationName;`;

	return dataCollector({ query });
}

export async function getCostByEnvironment(params: DokuParams) {
	const query = `SELECT 
			DISTINCT SpanAttributes['${getTraceMappingKeyFullPath(
				"environment"
			)}'] as environment, 
			SUM(toFloat64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
				"cost"
			)}'])) AS cost
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(params)}
		GROUP BY environment`;

	return dataCollector({ query });
}
