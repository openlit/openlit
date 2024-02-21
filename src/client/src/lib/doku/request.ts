import {
	TABLE_NAME,
	DokuParams,
	dataCollector,
	DokuRequestParams,
	DataCollectorType,
} from "./common";
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
		TO_CHAR(DATE_TRUNC('${dateTrunc}', time), 'YY/MM/DD HH24:MI') AS request_time
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

export async function getRequestsConfig(params: DokuRequestParams) {
	const { start, end } = params.timeLimit;
	const { endpoints, maxUsageCost, models, totalRows } = params.config || {};

	const select = [
		endpoints && "ARRAY_AGG(DISTINCT endpoint) AS endpoints",
		maxUsageCost && "MAX(usagecost) AS maxUsageCost",
		models && "ARRAY_AGG(DISTINCT model) AS models",
		totalRows && "CAST(COUNT(*) AS INTEGER) AS totalRows",
	]
		.filter(Boolean)
		.join(" , ");

	if (select.length === 0) return [];

	const query = `SELECT ${select} FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'`;

	return dataCollector(query);
}

export async function getRequests(params: DokuRequestParams) {
	const { start, end } = params.timeLimit;
	const { limit = 10, offset = 0 } = params;
	let config: unknown = {};

	if (params.config) {
		const configValues = await getRequestsConfig(params);
		config =
			((configValues as DataCollectorType)?.data as Array<any>)?.[0] || {};
	}

	const query = `SELECT *	FROM ${TABLE_NAME} 
		WHERE time >= '${start}' AND time <= '${end}'
		ORDER BY time
		LIMIT ${limit}
		OFFSET ${offset}`;

	const { data, err } = await dataCollector(query);
	return {
		err,
		config,
		records: data,
	};
}
