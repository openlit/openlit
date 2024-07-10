import {
	dateTruncGroupingLogic,
	getFilterWhereConditionForGPU,
} from "@/helpers/platform";
import {
	GPUMetricParams,
	OTEL_GPUS_TABLE_NAME,
	dataCollector,
} from "../common";

export async function getAveragePowerDraw(params: GPUMetricParams) {
	const query = `
			SELECT
				ROUND(AVG(Value), 2) as power_draw
			FROM
					${OTEL_GPUS_TABLE_NAME}
			WHERE ${getFilterWhereConditionForGPU(params)} AND MetricName = 'gpu.power.draw'
			GROUP BY
				MetricName
  `;

	return dataCollector({ query });
}

export async function getPowerParamsPerTime(params: GPUMetricParams) {
	const keys = ["power.draw", "power.limit"];
	const { start, end } = params.timeLimit;
	const dateTrunc = dateTruncGroupingLogic(end as Date, start as Date);

	const query = `
		SELECT
			${keys
				.map(
					(type) =>
						`MAX(${type.replaceAll(".", "_")}) AS ${type.replaceAll(".", "_")},`
				)
				.join(" ")}
			request_time
		FROM (
			SELECT
				${keys
					.map(
						(type) =>
							`ROUND(AVG(IF(MetricName = 'gpu.${type}', Value, 0)), 2) AS ${type.replaceAll(
								".",
								"_"
							)},`
					)
					.join(" ")}
				formatDateTime(DATE_TRUNC('${dateTrunc}', TimeUnix), '%Y/%m/%d %R') AS request_time
			FROM
					${OTEL_GPUS_TABLE_NAME}
			WHERE ${getFilterWhereConditionForGPU(params)}
			GROUP BY
				request_time,
				MetricName
			ORDER BY
				request_time
		)
		GROUP BY 
			request_time 
		ORDER BY 
			request_time;
  `;

	return dataCollector({ query });
}
