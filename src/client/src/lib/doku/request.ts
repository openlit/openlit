import { TABLE_NAME, DokuParams, dataCollector } from "./common";
import { differenceInDays, differenceInYears } from "date-fns";

export async function getRequestPerTime(params: DokuParams) {
	const { start, end } = params.timeLimit;
	let dateTrunc = "day";
	if (differenceInYears(end, start) >= 1) {
		dateTrunc = "month";
	} else if (differenceInDays(end, start) <= 1) {
		dateTrunc = "hour";
	}

	const query = `SELECT
		CAST(COUNT(endpoint) AS INTEGER) AS total,
		TO_CHAR(DATE_TRUNC('${dateTrunc}', time), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS request_time
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'
		GROUP BY request_time
		ORDER BY request_time`;

	return dataCollector(query);
}

export async function getTotalRequests(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		CAST(COUNT(endpoint) AS INTEGER) AS total_requests
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'`;

	return dataCollector(query);
}

export async function getAverageRequestDuration(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		CAST(AVG(requestduration) AS DECIMAL) AS average_duration
		FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'`;

	return dataCollector(query);
}
