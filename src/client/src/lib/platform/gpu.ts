import {
	dateTruncGroupingLogic,
	getFilterWhereConditionForGPU,
} from "@/helpers/platform";
import { dataCollector, OTEL_GPUS_TABLE_NAME, GPUMetricParams } from "./common";

export async function getGPUdata(params: GPUMetricParams) {
	const { start, end } = params.timeLimit;
	const dateTrunc = dateTruncGroupingLogic(end as Date, start as Date);
	const query = `
    SELECT
			SUM(Value) AS total,
			formatDateTime(DATE_TRUNC('${dateTrunc}', TimeUnix), '%Y/%m/%d %R') AS request_time
    FROM
        ${OTEL_GPUS_TABLE_NAME}
    WHERE ${getFilterWhereConditionForGPU({
			...params,
		})}
		GROUP BY
			request_time
		ORDER BY
			request_time;
  `;

	return dataCollector({ query });
}
