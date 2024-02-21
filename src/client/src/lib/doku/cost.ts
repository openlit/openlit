import { DokuParams, TABLE_NAME, dataCollector } from "./common";

export async function getTotalCost(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		CAST(SUM(usagecost) AS DECIMAL) AS total_usage_cost
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

export async function getCostByApplication(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `
    SELECT 
			DISTINCT applicationname as applicationname, 
			CAST(ROUND(SUM(usagecost)::numeric, 7) AS FLOAT) AS cost,
			SUM(usagecost) * 100.0 / SUM(usagecost) AS percentage
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'
		GROUP BY applicationname`;

	return dataCollector(query);
}

export async function getCostByEnvironment(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `
    SELECT 
			DISTINCT environment as environment, 
			CAST(ROUND(SUM(usagecost)::numeric, 7) AS FLOAT) AS cost,
			SUM(usagecost) * 100.0 / SUM(usagecost) AS percentage
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'
		GROUP BY environment`;

	return dataCollector(query);
}
