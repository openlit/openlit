import { differenceInDays, differenceInYears } from "date-fns";
import { DokuParams, TABLE_NAME, dataCollector } from "./common";

export type TOKEN_TYPE = "total" | "prompt" | "completion";

export type TokenParams = DokuParams & {
	type: TOKEN_TYPE;
};

export async function getAverageTokensPerRequest(params: TokenParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		CAST(AVG(${
			params.type === "total"
				? "totaltokens"
				: params.type === "prompt"
				? "prompttokens"
				: "completiontokens"
		}) AS DECIMAL) AS total_tokens
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'`;

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
		CAST(SUM(totaltokens) AS INTEGER) AS totaltokens,
		CAST(SUM(prompttokens) AS INTEGER) AS prompttokens,
		CAST(SUM(completiontokens) AS INTEGER) AS completiontokens,
		TO_CHAR(DATE_TRUNC('${dateTrunc}', time), 'YY/MM/DD HH24:MI') AS request_time
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'
		GROUP BY request_time
		ORDER BY request_time`;

	return dataCollector(query);
}
