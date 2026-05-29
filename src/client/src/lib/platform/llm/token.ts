import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "../common";
import { getTraceMappingKeyFullPaths } from "@/helpers/server/trace";
import {
	dateTruncGroupingLogic,
	getFilterPreviousParams,
	getFilterWhereCondition,
} from "@/helpers/server/platform";

export type TOKEN_TYPE = "total" | "prompt" | "completion";

export type TokenParams = MetricParams & {
	type: TOKEN_TYPE;
};

function getSpanAttributePaths(key: "totalTokens" | "promptTokens" | "completionTokens") {
	return (getTraceMappingKeyFullPaths(key) as string[]).map(
		(path) => `SpanAttributes['${path}']`
	);
}

function getFirstNonEmptyPath(paths: string[]) {
	return paths.reduce((expression, path) => `if(${expression} != '', ${expression}, ${path})`);
}

export async function getAverageTokensPerRequest(params: TokenParams) {
	const tokenKey =
		params.type === "total"
			? "totalTokens"
			: params.type === "prompt"
			? "promptTokens"
			: "completionTokens";
	const tokenPaths = getSpanAttributePaths(tokenKey);
	const keyPath = getFirstNonEmptyPath(tokenPaths);

	const currentWhereParams = {
		...params,
		notOrEmpty: tokenPaths.map((key) => ({ key })),
	};

	let query;

	const commonQuery = (parameters: any) => `SELECT
			AVG(toInt32OrZero(${keyPath})) AS total_tokens
			${params.type === "total" ? `, '${params.timeLimit.start}' as start_date` : ""}
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${getFilterWhereCondition({ ...parameters, operationType: "llm" }, true)}`;

	if (params.type === "total") {
		const previousWhereParams = getFilterPreviousParams(currentWhereParams);
		query = `
			SELECT
				CAST(current_data.total_tokens AS FLOAT) AS total_tokens,
				CAST(previous_day.total_tokens AS FLOAT) AS previous_total_tokens
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
	} else {
		query = commonQuery(currentWhereParams);
	}

	return dataCollector({ query });
}

export async function getTokensPerTime(params: MetricParams) {
	const { start, end } = params.timeLimit;
	const dateTrunc = dateTruncGroupingLogic(end as Date, start as Date);

	const tokenPaths = [
		getSpanAttributePaths("totalTokens"),
		getSpanAttributePaths("promptTokens"),
		getSpanAttributePaths("completionTokens"),
	];

	const coalesced = tokenPaths.map((paths) => getFirstNonEmptyPath(paths));

	const filterPaths: { key: string }[] = [
		...tokenPaths.flatMap((paths) => paths.map((key) => ({ key }))),
	];

	const query = `SELECT
		SUM(toInt64OrZero(${coalesced[0]})) AS totaltokens,
		SUM(toInt64OrZero(${coalesced[1]})) AS prompttokens,
		SUM(toInt64OrZero(${coalesced[2]})) AS completiontokens,
		formatDateTime(DATE_TRUNC('${dateTrunc}', Timestamp), '%Y/%m/%d %R') AS request_time
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition({
			...params,
			notOrEmpty: filterPaths,
			operationType: "llm",
		}, true)}
		GROUP BY request_time
		ORDER BY request_time`;

	return dataCollector({ query });
}
