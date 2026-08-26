import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "../common";
import { getTraceMappingKeyFullPath } from "@/helpers/server/trace";
import {
	dateTruncGroupingLogic,
	getFilterWhereCondition,
} from "@/helpers/server/platform";
import { externalModelsPerTime, externalTopModels } from "./external";

export type ModelMetricParams = MetricParams & {
	top: number;
};

export async function getTopModels(params: ModelMetricParams) {
	const external = await externalTopModels(params);
	if (external) {
		return {
			err: external.err,
			data: (external.data || [])
				.slice(0, params.top)
				.map((row: any) => ({
					model: row.model,
					model_count: row.count,
					total: row.count,
				})),
		};
	}

	const keyPath = `SpanAttributes['${getTraceMappingKeyFullPath("model")}']`;
	const query = `SELECT
			${keyPath} AS model,
			COUNT(${keyPath}) AS model_count,
			COUNT(*) AS total
		FROM
			${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition({
			...params,
			notEmpty: [{ key: keyPath }],
			operationType: "llm",
		}, true)}
		GROUP BY
			model
		ORDER BY
			model_count DESC
		LIMIT ${params.top};
	`;

	return dataCollector({ query });
}

export async function getModelsPerTime(params: MetricParams) {
	const external = await externalModelsPerTime(params);
	if (external) return external;

	const { start, end } = params.timeLimit;
	const dateTrunc = dateTruncGroupingLogic(end as Date, start as Date);

	const keyPath = `SpanAttributes['${getTraceMappingKeyFullPath("model")}']`;
	const query = `
		SELECT 
			ARRAY_AGG(model) as models,
			ARRAY_AGG(model_count) as model_counts,
			CAST(SUM(model_count) AS INTEGER) as total_model_count,
			request_time as request_time
		FROM
			(SELECT
					${keyPath} as model,
					CAST(COUNT(*) AS INTEGER) AS model_count,
					formatDateTime(DATE_TRUNC('${dateTrunc}', Timestamp), '%Y/%m/%d') AS request_time
				FROM
					${OTEL_TRACES_TABLE_NAME}
				WHERE ${getFilterWhereCondition({
					...params,
					notEmpty: [{ key: keyPath }],
					operationType: "llm",
				}, true)}
				GROUP BY
					model, request_time
				ORDER BY
					request_time)
		GROUP BY 
			request_time
		ORDER BY
			request_time;
	`;

	return dataCollector({ query });
}
