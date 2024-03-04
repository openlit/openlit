import { differenceInDays, differenceInYears } from "date-fns";
import { DokuParams, DATA_TABLE_NAME, dataCollector } from "./common";

export type ModelDokuParams = DokuParams & {
	top: number;
};

export async function getTopModels(params: ModelDokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
			model,
			CAST(COUNT(model) AS INTEGER) AS model_count,
			CAST(COUNT(*) AS INTEGER) AS total
		FROM
			${DATA_TABLE_NAME}
		WHERE
			time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')
		GROUP BY
			model
		ORDER BY
			model_count DESC
		LIMIT ${params.top};
	`;

	return dataCollector(query);
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
			model,
			CAST(COUNT(*) AS INTEGER) AS model_count,
			formatDateTime(DATE_TRUNC('${dateTrunc}', time), '%Y/%m/%d %R') AS request_time
		FROM
			${DATA_TABLE_NAME}
		WHERE
		time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')
		GROUP BY
			model, request_time
		ORDER BY
			request_time;
	`;

	return dataCollector(query);
}
