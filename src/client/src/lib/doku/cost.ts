import { DokuParams, TABLE_NAME, dataCollector } from "./common";

export async function getTotalCost(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		CAST(SUM(usagecost) AS DECIMAL) AS average_usage_cost
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'`;

	return dataCollector(query);
}

export async function getAverageCost(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		CAST(AVG(usagecost) AS DECIMAL) AS average_usage_cost
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'`;

	return dataCollector(query);
}
