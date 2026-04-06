import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "../common";
import { getTraceMappingKeyFullPath } from "@/helpers/server/trace";
import {
	dateTruncGroupingLogic,
	getFilterPreviousParams,
	getFilterWhereCondition,
} from "@/helpers/server/platform";

export type TOKEN_TYPE = "total" | "prompt" | "completion";

export type TokenParams = MetricParams & {
	type: TOKEN_TYPE;
};

export async function getAverageTokensPerRequest(params: TokenParams) {
	const primaryPath = `SpanAttributes['${getTraceMappingKeyFullPath(
		params.type === "total"
			? "totalTokens"
			: params.type === "prompt"
			? "promptTokens"
			: "completionTokens"
	)}']`;

	// Backward compatibility: fall back to new OTel convention attributes
	const fallbackAttr =
		params.type === "total"
			? "gen_ai.client.token.usage"
			: params.type === "prompt"
			? "gen_ai.client.token.usage.input"
			: "gen_ai.client.token.usage.output";
	const fallbackPath = `SpanAttributes['${fallbackAttr}']`;

	const keyPath = `if(${primaryPath} != '', ${primaryPath}, ${fallbackPath})`;

	const currentWhereParams = { ...params, notOrEmpty: [{ key: primaryPath }, { key: fallbackPath }] };

	let query;

	const commonQuery = (parameters: any) => `SELECT
			AVG(toInt32OrZero(${keyPath})) AS total_tokens
			${params.type === "total" ? `, '${params.timeLimit.start}' as start_date` : ""}
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE ${getFilterWhereCondition({ ...parameters, operationType: "llm" })}`;

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

	const primaryPaths = [
		`SpanAttributes['${getTraceMappingKeyFullPath("totalTokens")}']`,
		`SpanAttributes['${getTraceMappingKeyFullPath("promptTokens")}']`,
		`SpanAttributes['${getTraceMappingKeyFullPath("completionTokens")}']`,
	];

	// Backward compatibility: fall back to new OTel convention attributes
	const fallbackPaths = [
		`SpanAttributes['gen_ai.client.token.usage']`,
		`SpanAttributes['gen_ai.client.token.usage.input']`,
		`SpanAttributes['gen_ai.client.token.usage.output']`,
	];

	const coalesced = primaryPaths.map(
		(p, i) => `if(${p} != '', ${p}, ${fallbackPaths[i]})`
	);

	const filterPaths: { key: string }[] = [
		...primaryPaths.map((key) => ({ key })),
		...fallbackPaths.map((key) => ({ key })),
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
		})}
		GROUP BY request_time
		ORDER BY request_time`;

	return dataCollector({ query });
}
