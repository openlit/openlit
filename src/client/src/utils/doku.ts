import { ValueOf } from "./types";

export const validateMetricsRequestType = {
	// Request
	REQUEST_PER_TIME: "REQUEST_PER_TIME",
	TOTAL_REQUESTS: "TOTAL_REQUESTS",
	AVERAGE_REQUEST_DURATION: "AVERAGE_REQUEST_DURATION",
	GET_ALL: "GET_ALL",
	// Cost
	TOTAL_COST: "TOTAL_COST",
	AVERAGE_REQUEST_COST: "AVERAGE_REQUEST_COST",
	// Model
	TOP_MODELS: "TOP_MODELS",
	// Category
	GENERATION_BY_CATEGORY: "GENERATION_BY_CATEGORY",
	// Token
	AVERAGE_REQUEST_TOKEN: "AVERAGE_REQUEST_TOKEN",
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
			break;
		default:
			break;
	}

	return { success: true };
};
