import { differenceInDays, differenceInYears } from "date-fns";
import { DokuParams, DATA_TABLE_NAME, dataCollector } from "./common";

export type TOKEN_TYPE = "total" | "prompt" | "completion";

export type TokenParams = DokuParams & {
	type: TOKEN_TYPE;
};

export async function getAverageTokensPerRequest(params: TokenParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		AVG(${
			params.type === "total"
				? "totalTokens"
				: params.type === "prompt"
				? "promptTokens"
				: "completionTokens"
		}) AS total_tokens
		FROM ${DATA_TABLE_NAME} 
		WHERE time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')`;

	return dataCollector(query);
}

export async function getTokensPerTime(params: DokuParams) {
	const { start, end } = params.timeLimit;
	let dateTrunc = "day";
	if (differenceInYears(end, start) >= 1) {
		dateTrunc = "month";
	} else if (differenceInDays(end, start) <= 1) {
		dateTrunc = "hour";
	}

	const query = `SELECT
		CAST(SUM(totalTokens) AS INTEGER) AS totaltokens,
		CAST(SUM(promptTokens) AS INTEGER) AS prompttokens,
		CAST(SUM(completionTokens) AS INTEGER) AS completiontokens,
		formatDateTime(DATE_TRUNC('${dateTrunc}', time), '%Y/%m/%d %R') AS request_time
		FROM ${DATA_TABLE_NAME} 
		WHERE time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')
		GROUP BY request_time
		ORDER BY request_time`;

	return dataCollector(query);
}
