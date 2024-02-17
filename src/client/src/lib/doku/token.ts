import { DokuParams, TABLE_NAME, dataCollector } from "./common";

export async function getAverageTokensPerRequest(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		CAST(AVG(totaltokens) AS DECIMAL) AS average_total_tokens
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'`;

	return dataCollector(query);
}
