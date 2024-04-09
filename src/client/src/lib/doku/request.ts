import { SPAN_KIND } from "@/constants/traces";
import {
	DokuParams,
	dataCollector,
	DokuRequestParams,
	DataCollectorType,
	OTEL_TRACES_TABLE_NAME,
} from "./common";
import { differenceInDays, differenceInYears } from "date-fns";
import { ValueOf } from "@/utils/types";
import { getTraceMappingKeyFullPath } from "@/helpers/trace";
import { getFilterWhereCondition } from "@/helpers/doku";

export async function getRequestPerTime(params: DokuParams) {
	const { start, end } = params.timeLimit;
	let dateTrunc = "day";
	if (differenceInYears(end, start) >= 1) {
		dateTrunc = "month";
	} else if (differenceInDays(end, start) <= 1) {
		dateTrunc = "hour";
	}

	const query = `SELECT
		COUNT(*) AS total,
			formatDateTime(DATE_TRUNC('${dateTrunc}', Timestamp), '%Y/%m/%d %R') AS request_time
		FROM
			${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(params)}
		GROUP BY
			request_time
		ORDER BY
			request_time;
		`;

	return dataCollector({ query });
}

export async function getTotalRequests(params: DokuParams) {
	const query = `SELECT
		COUNT(*) AS total_requests
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(params)}
		`;

	return dataCollector({ query });
}

export async function getAverageRequestDuration(params: DokuParams) {
	const query = `SELECT
			AVG(toFloat64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
				"requestDuration"
			)}'])) AS average_duration
		FROM
			${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(params)};
		`;

	return dataCollector({ query });
}

export async function getRequestsConfig(params: DokuRequestParams) {
	const { providers, maxCost, models, totalRows } = params.config || {};

	const select = [
		providers &&
			`ARRAY_AGG(DISTINCT SpanAttributes['${getTraceMappingKeyFullPath(
				"provider"
			)}']) AS providers`,
		maxCost &&
			`MAX(SpanAttributes['${getTraceMappingKeyFullPath("cost")}']) AS maxCost`,
		models &&
			`ARRAY_AGG(DISTINCT SpanAttributes['${getTraceMappingKeyFullPath(
				"model"
			)}']) AS models`,
		totalRows && `COUNT(*) AS totalRows`,
	]
		.filter(Boolean)
		.join(", ");

	if (select.length === 0) return [];

	const query = `SELECT ${select} FROM ${OTEL_TRACES_TABLE_NAME} 
			WHERE ${getFilterWhereCondition(params)}`;

	return dataCollector({ query });
}

export async function getRequests(params: DokuRequestParams) {
	const { limit = 10, offset = 0 } = params;
	let config: unknown = {};

	if (params.config) {
		const configValues = await getRequestsConfig(params);
		config =
			((configValues as DataCollectorType)?.data as Array<any>)?.[0] || {};
	}

	const query = `SELECT *	FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(params)}
		ORDER BY Timestamp desc
		LIMIT ${limit}
		OFFSET ${offset}`;

	const { data, err } = await dataCollector({ query });
	return {
		err,
		config,
		records: data,
	};
}
