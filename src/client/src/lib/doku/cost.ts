import { DokuParams, DATA_TABLE_NAME, dataCollector } from "./common";

export async function getTotalCost(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		sum(usageCost) AS total_usage_cost
		FROM ${DATA_TABLE_NAME} 
		WHERE time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')`;

	return dataCollector(query);
}

export async function getAverageCost(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		avg(usageCost) AS average_usage_cost
		FROM ${DATA_TABLE_NAME} 
		WHERE time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')`;

	return dataCollector(query);
}

export async function getCostByApplication(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
			applicationName,
			sum(usageCost) AS cost,
			100.0 * sum(usageCost) / sum(sum(usageCost)) OVER () AS percentage
		FROM
			${DATA_TABLE_NAME}
		WHERE
			time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')
		GROUP BY
			applicationName;`;

	return dataCollector(query);
}

export async function getCostByEnvironment(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT 
			DISTINCT environment as environment, 
			SUM(usageCost) AS cost,
			SUM(usageCost) * 100.0 / SUM(usageCost) AS percentage
		FROM ${DATA_TABLE_NAME} 
		WHERE time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')
		GROUP BY environment`;

	return dataCollector(query);
}
