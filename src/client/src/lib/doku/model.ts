import { differenceInDays, differenceInYears } from "date-fns";
import { DokuParams, TABLE_NAME, dataCollector } from "./common";

export type ModelDokuParams = DokuParams & {
	top: number;
};

export async function getTopModels(params: ModelDokuParams) {
	const { start, end } = params.timeLimit;

	const query = `
    SELECT model, CAST(COUNT(model) AS INTEGER) AS model_count, CAST(COUNT(*) AS INTEGER) AS total
    FROM ${TABLE_NAME} 
    WHERE time >= '${start}' AND time <= '${end}'
    GROUP BY model
    ORDER BY model_count DESC
    LIMIT ${params.top}`;

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
        DISTINCT model AS model,
        CAST(COUNT(*) AS INTEGER) AS model_count,
		TO_CHAR(DATE_TRUNC('${dateTrunc}', time), 'YY/MM/DD HH24:MI') AS request_time
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'
		GROUP BY model, request_time
		ORDER BY request_time`;

	return dataCollector(query);
}
