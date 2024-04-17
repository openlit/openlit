import {
	MetricParams,
	dataCollector,
	MetricParamsWithConfig,
	DataCollectorType,
	OTEL_TRACES_TABLE_NAME,
} from "./common";
import { differenceInDays, differenceInYears } from "date-fns";
import { getTraceMappingKeyFullPath } from "@/helpers/trace";
import {
	getFilterPreviousParams,
	getFilterWhereCondition,
} from "@/helpers/platform";

export async function getRequestPerTime(params: MetricParams) {
	const { start, end } = params.timeLimit;
	let dateTrunc = "day";
	if (differenceInYears(end as Date, start as Date) >= 1) {
		dateTrunc = "month";
	} else if (differenceInDays(end as Date, start as Date) <= 1) {
		dateTrunc = "hour";
	}

	const query = `
		SELECT
			CAST(COUNT(*) AS INTEGER) AS total,
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

export async function getTotalRequests(params: MetricParams) {
	const commonQuery = (parameters: MetricParams) => `
		SELECT
			COUNT(*) AS total_requests,
			'${params.timeLimit.start}' as start_date
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(parameters)}	
	`;

	const previousWhereParams = getFilterPreviousParams(params);
	const query = `
		SELECT
			CAST(current_data.total_requests AS INTEGER) AS total_requests,
			CAST(previous_day.total_requests AS INTEGER) AS previous_total_requests
		FROM
			(
				${commonQuery(params)}
			) as current_data
			JOIN
			(
				${commonQuery(previousWhereParams)}
			) as previous_day
		ON
			current_data.start_date = previous_day.start_date;
	`;

	return dataCollector({ query });
}

export async function getAverageRequestDuration(params: MetricParams) {
	const keyPath = `${getTraceMappingKeyFullPath("requestDuration")}`;

	const commonQuery = (parameters: MetricParams) => `
		SELECT
			AVG(${keyPath}) AS average_duration,
			'${params.timeLimit.start}' as start_date
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(parameters)} AND isFinite(${keyPath})
	`;

	const currentWhereParams = params;
	const previousWhereParams = getFilterPreviousParams(currentWhereParams);

	const query = `
		SELECT
			CAST(current_data.average_duration AS FLOAT) AS average_duration,
			CAST(previous_day.average_duration AS FLOAT) AS previous_average_duration
		FROM
			(
				${commonQuery(currentWhereParams)}
			) as current_data
			JOIN
			(
				${commonQuery(previousWhereParams)}
			) as previous_day
		ON
			current_data.start_date = previous_day.start_date;
	`;

	return dataCollector({ query });
}

export async function getRequestsConfig(params: MetricParamsWithConfig) {
	const { providers, maxCost, models, totalRows } = params.config || {};

	const keyPaths: { key: string }[] = [];
	const select: string[] = [];

	if (providers) {
		keyPaths.push({
			key: `SpanAttributes['${getTraceMappingKeyFullPath("provider")}']`,
		});
		select.push(
			`ARRAY_AGG(DISTINCT SpanAttributes['${getTraceMappingKeyFullPath(
				"provider"
			)}']) AS providers`
		);
	}

	if (maxCost) {
		keyPaths.push({
			key: `SpanAttributes['${getTraceMappingKeyFullPath("cost")}']`,
		});
		select.push(
			`MAX(SpanAttributes['${getTraceMappingKeyFullPath("cost")}']) AS maxCost`
		);
	}

	if (models) {
		keyPaths.push({
			key: `SpanAttributes['${getTraceMappingKeyFullPath("model")}']`,
		});
		select.push(
			`ARRAY_AGG(DISTINCT SpanAttributes['${getTraceMappingKeyFullPath(
				"model"
			)}']) AS models`
		);
	}

	if (totalRows) {
		select.push(`COUNT(*) AS totalRows`);
	}

	if (select.length === 0) return [];

	const query = `SELECT ${select.join(", ")} FROM ${OTEL_TRACES_TABLE_NAME} 
			WHERE ${getFilterWhereCondition({ ...params, notEmpty: keyPaths })}`;

	return dataCollector({ query });
}

export async function getRequests(params: MetricParamsWithConfig) {
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
