import { differenceInDays, differenceInYears } from "date-fns";
import { DokuParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "./common";
import { getTraceMappingKeyFullPath } from "@/helpers/trace";
import { getFilterWhereCondition } from "@/helpers/doku";

export type TOKEN_TYPE = "total" | "prompt" | "completion";

export type TokenParams = DokuParams & {
	type: TOKEN_TYPE;
};

export async function getAverageTokensPerRequest(params: TokenParams) {
	const query = `SELECT
		AVG(toInt64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
			params.type === "total"
				? "totalTokens"
				: params.type === "prompt"
				? "promptTokens"
				: "completionTokens"
		)}'])) AS total_tokens
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(params)}`;

	return dataCollector({ query });
}

export async function getTokensPerTime(params: DokuParams) {
	const { start, end } = params.timeLimit;
	let dateTrunc = "day";
	if (differenceInYears(end, start) >= 1) {
		dateTrunc = "month";
	} else if (differenceInDays(end, start) <= 1) {
		dateTrunc = "hour";
	}

	const query = `SELECT
		SUM(toInt64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
			"totalTokens"
		)}'])) AS totaltokens,
		SUM(toInt64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
			"promptTokens"
		)}'])) AS prompttokens,
		SUM(toInt64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
			"completionTokens"
		)}'])) AS completiontokens,
		formatDateTime(DATE_TRUNC('${dateTrunc}', Timestamp), '%Y/%m/%d %R') AS request_time
		FROM ${OTEL_TRACES_TABLE_NAME} 
		WHERE ${getFilterWhereCondition(params)}
		GROUP BY request_time
		ORDER BY request_time`;

	return dataCollector({ query });
}
