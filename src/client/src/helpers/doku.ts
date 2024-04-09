import { SPAN_KIND } from "@/constants/traces";
import { ValueOf } from "../utils/types";

export const validateMetricsRequestType = {
	// Request
	REQUEST_PER_TIME: "REQUEST_PER_TIME",
	TOTAL_REQUESTS: "TOTAL_REQUESTS",
	AVERAGE_REQUEST_DURATION: "AVERAGE_REQUEST_DURATION",
	GET_ALL: "GET_ALL",
	// Cost
	TOTAL_COST: "TOTAL_COST",
	AVERAGE_REQUEST_COST: "AVERAGE_REQUEST_COST",
	COST_BY_APPLICATION: "COST_BY_APPLICATION",
	COST_BY_ENVIRONMENT: "COST_BY_ENVIRONMENT",
	// Model
	TOP_MODELS: "TOP_MODELS",
	MODEL_PER_TIME: "MODEL_PER_TIME",
	// Category
	GENERATION_BY_CATEGORY: "GENERATION_BY_CATEGORY",
	// Token
	AVERAGE_REQUEST_TOKEN: "AVERAGE_REQUEST_TOKEN",
	TOKENS_PER_TIME: "TOKENS_PER_TIME",
	// Endpoint
	GENERATION_BY_ENDPOINT: "GENERATION_BY_ENDPOINT",
};

export const validateMetricsRequest = (
	params: Record<string, any>,
	type: ValueOf<typeof validateMetricsRequestType>
): { success: boolean; err?: string } => {
	switch (type) {
		// Request
		case validateMetricsRequestType.REQUEST_PER_TIME:
		case validateMetricsRequestType.TOTAL_REQUESTS:
		case validateMetricsRequestType.AVERAGE_REQUEST_DURATION:
			if (!params.timeLimit?.start || !params.timeLimit?.end) {
				return {
					success: false,
					err: "Start date or End date missing!",
				};
			}
			break;
		case validateMetricsRequestType.GET_ALL:
			if (!params.timeLimit?.start || !params.timeLimit?.end) {
				return {
					success: false,
					err: "Start date or End date missing!",
				};
			}
			break;
		// Cost
		case validateMetricsRequestType.TOTAL_COST:
		case validateMetricsRequestType.AVERAGE_REQUEST_COST:
		case validateMetricsRequestType.COST_BY_APPLICATION:
		case validateMetricsRequestType.COST_BY_ENVIRONMENT:
			if (!params.timeLimit?.start || !params.timeLimit?.end) {
				return {
					success: false,
					err: "Start date or End date missing!",
				};
			}
			break;
		// Model
		case validateMetricsRequestType.TOP_MODELS:
			if (!params.timeLimit?.start || !params.timeLimit?.end) {
				return {
					success: false,
					err: "Start date or End date missing!",
				};
			}
			if (!params.top) {
				return {
					success: false,
					err: "Number of top models missing!",
				};
			}
			break;
		case validateMetricsRequestType.MODEL_PER_TIME:
			if (!params.timeLimit?.start || !params.timeLimit?.end) {
				return {
					success: false,
					err: "Start date or End date missing!",
				};
			}
			break;
		// Category
		case validateMetricsRequestType.GENERATION_BY_CATEGORY:
			if (!params.timeLimit?.start || !params.timeLimit?.end) {
				return {
					success: false,
					err: "Start date or End date missing!",
				};
			}
			break;
		// Token
		case validateMetricsRequestType.AVERAGE_REQUEST_TOKEN:
			if (!params.timeLimit?.start || !params.timeLimit?.end) {
				return {
					success: false,
					err: "Start date or End date missing!",
				};
			}
			if (!params.type) {
				return {
					success: false,
					err: "Type of token for the request is missing!",
				};
			}
			break;
		case validateMetricsRequestType.TOKENS_PER_TIME:
			if (!params.timeLimit?.start || !params.timeLimit?.end) {
				return {
					success: false,
					err: "Start date or End date missing!",
				};
			}
			break;
		// Endpoint
		case validateMetricsRequestType.GENERATION_BY_ENDPOINT:
			if (!params.timeLimit?.start || !params.timeLimit?.end) {
				return {
					success: false,
					err: "Start date or End date missing!",
				};
			}
			break;
		default:
			break;
	}

	return { success: true };
};

export const getFilterWhereCondition = (filter: any) => {
	const whereArray: string[] = [];
	try {
		const { start, end } = filter.timeLimit || {};
		if (start && end) {
			whereArray.push(
				`Timestamp >= parseDateTimeBestEffort('${start}') AND Timestamp <= parseDateTimeBestEffort('${end}')`
			);
		}

		const { spanKind = SPAN_KIND.SPAN_KIND_CLIENT } = filter;
		whereArray.push(`SpanKind='${spanKind}'`);
	} catch {}
	return whereArray.join(" AND ");
};
