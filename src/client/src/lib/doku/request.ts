import {
	DATA_TABLE_NAME,
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
			formatDateTime(DATE_TRUNC('${dateTrunc}', time), '%Y/%m/%d %R') AS request_time
		FROM
			${DATA_TABLE_NAME}
		WHERE
			time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')
		GROUP BY
			request_time
		ORDER BY
			request_time;
		`;

	return dataCollector(query);
}

export async function getTotalRequests(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
		CAST(COUNT(endpoint) AS INTEGER) AS total_requests
		FROM ${DATA_TABLE_NAME} 
		WHERE time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')`;

	return dataCollector(query);
}

export async function getAverageRequestDuration(params: DokuParams) {
	const { start, end } = params.timeLimit;

	const query = `SELECT
			AVG(requestDuration) AS average_duration
		FROM
			${DATA_TABLE_NAME}
		WHERE
			time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}');
		`;

	return dataCollector(query);
}

export async function getRequestsConfig(params: DokuRequestParams) {
	const { start, end } = params.timeLimit;
	const { endpoints, maxUsageCost, models, totalRows } = params.config || {};

	const select = [
		endpoints && "ARRAY_AGG(DISTINCT endpoint) AS endpoints",
		maxUsageCost && "MAX(usageCost) AS maxUsageCost",
		models && "ARRAY_AGG(DISTINCT model) AS models",
		totalRows && "CAST(COUNT(*) AS INTEGER) AS totalRows",
	]
		.filter(Boolean)
		.join(", ");

	if (select.length === 0) return [];

	const query = `SELECT ${select} FROM ${DATA_TABLE_NAME} 
			WHERE time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')`;

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

	const query = `SELECT *	FROM ${DATA_TABLE_NAME} 
		WHERE time >= parseDateTimeBestEffort('${start}') AND time <= parseDateTimeBestEffort('${end}')
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
