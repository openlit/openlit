import { differenceInDays, differenceInYears } from "date-fns";
import { DokuParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "./common";
import { getTraceMappingKeyFullPath } from "@/helpers/trace";
import { getFilterWhereCondition } from "@/helpers/doku";

export type ModelDokuParams = DokuParams & {
	top: number;
};

export async function getTopModels(params: ModelDokuParams) {
	const query = `SELECT
			SpanAttributes['${getTraceMappingKeyFullPath("model")}'] AS model,
			COUNT(SpanAttributes['${getTraceMappingKeyFullPath("model")}']) AS model_count,
			COUNT(*) AS total
		FROM
			${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(params)}
		GROUP BY
			model
		ORDER BY
			model_count DESC
		LIMIT ${params.top};
	`;

	return dataCollector({ query });
}

export async function getModelsPerTime(params: DokuParams) {
	const { start, end } = params.timeLimit;
	let dateTrunc = "day";
	if (differenceInYears(end, start) >= 1) {
		dateTrunc = "month";
	} else if (differenceInDays(end, start) <= 1) {
		dateTrunc = "hour";
	}

	const query = `SELECT
			SpanAttributes['${getTraceMappingKeyFullPath("model")}'] as model,
			COUNT(*) AS model_count,
			formatDateTime(DATE_TRUNC('${dateTrunc}', Timestamp), '%Y/%m/%d %R') AS request_time
		FROM
			${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(params)}
		GROUP BY
			model, request_time
		ORDER BY
			request_time;
	`;

	return dataCollector({ query });
}
