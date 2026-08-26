import {
	dateTruncGroupingLogic,
	getFilterWhereConditionForGPU,
} from "@/helpers/server/platform";
import {
	GPUMetricParams,
	OTEL_GPUS_TABLE_NAME,
	dataCollector,
} from "../common";
import {
	externalAverageTemperature,
	externalAverageTemperatureParamsPerTime,
} from "./external";

export async function getAverageTemperature(params: GPUMetricParams) {
	const external = await externalAverageTemperature(params);
	if (external) return external;

	const query = `
			SELECT
				ROUND(AVG(Value), 2) as temperature
			FROM
					${OTEL_GPUS_TABLE_NAME}
			WHERE ${getFilterWhereConditionForGPU(
				params
			)} AND MetricName = 'gpu.temperature'
			GROUP BY
				MetricName
  `;

	return dataCollector({ query });
}

export async function getAverageTemperatureParamsPerTime(
	params: GPUMetricParams
) {
	const external = await externalAverageTemperatureParamsPerTime(params);
	if (external) return external;

	const { start, end } = params.timeLimit;
	const dateTrunc = dateTruncGroupingLogic(end as Date, start as Date);

	const query = `
		SELECT
				ROUND(AVG(Value), 2) as temperature,
				formatDateTime(DATE_TRUNC('${dateTrunc}', TimeUnix), '%Y/%m/%d %R') AS request_time
			FROM
					${OTEL_GPUS_TABLE_NAME}
			WHERE ${getFilterWhereConditionForGPU(params)}
			AND MetricName = 'gpu.temperature'
			GROUP BY
				request_time,
				MetricName
			ORDER BY
				request_time;
  `;

	return dataCollector({ query });
}
