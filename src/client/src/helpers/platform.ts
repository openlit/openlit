import { SPAN_KIND } from "@/constants/traces";
import { ValueOf } from "../utils/types";
import { GPU_TYPE_KEY, MetricParams } from "@/lib/platform/common";
import {
	addDays,
	addMonths,
	differenceInDays,
	differenceInYears,
} from "date-fns";
import { getTraceMappingKeyFullPath } from "./trace";

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
	// GPU
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

type FilterWhereConditionType = {
	timeLimit: {
		start: Date | string;
		end: Date | string;
		type: string;
	};
	offset?: number;
	limit?: number;
	selectedConfig?: Partial<{
		providers: string[];
		maxCost: number;
		models: string[];
		traceTypes: string[];
	}>;
	notOrEmpty?: { key: string }[];
	notEmpty?: { key: string }[];
	statusCode?: string;
	gpu_type?: GPU_TYPE_KEY;
};

export const getFilterWhereCondition = (
	filter: FilterWhereConditionType,
	filterSelectedConfig?: boolean
) => {
	const whereArray: string[] = [];
	try {
		const { start, end } = filter.timeLimit || {};
		if (start && end) {
			whereArray.push(
				`Timestamp >= parseDateTimeBestEffort('${start}') AND Timestamp <= parseDateTimeBestEffort('${end}')`
			);
		}

		if (filterSelectedConfig && filter.selectedConfig) {
			if (filter.selectedConfig.models?.length) {
				whereArray.push(
					`SpanAttributes['${getTraceMappingKeyFullPath(
						"model"
					)}'] IN (${filter.selectedConfig.models
						.map((model) => `'${model}'`)
						.join(", ")})`
				);
			}

			if (filter.selectedConfig.providers?.length) {
				whereArray.push(
					`(SpanAttributes['${getTraceMappingKeyFullPath(
						"system"
					)}'] IN (${filter.selectedConfig.providers
						.map((provider) => `'${provider}'`)
						.join(", ")}) OR SpanAttributes['${getTraceMappingKeyFullPath(
						"provider"
					)}'] IN (${filter.selectedConfig.providers
						.map((provider) => `'${provider}'`)
						.join(", ")}))`
				);
			}

			if (filter.selectedConfig.traceTypes?.length) {
				whereArray.push(
					`SpanAttributes['${getTraceMappingKeyFullPath(
						"type"
					)}'] IN (${filter.selectedConfig.traceTypes
						.map((type) => `'${type}'`)
						.join(", ")})`
				);
			}

			if (filter.selectedConfig.maxCost) {
				whereArray.push(
					`toFloat64OrZero(SpanAttributes['${getTraceMappingKeyFullPath(
						"cost"
					)}']) BETWEEN 0 AND ${filter.selectedConfig.maxCost.toFixed(10)}`
				);
			}
		}

		if (filter.notOrEmpty && filter.notOrEmpty?.length > 0) {
			const whereOrArray: string[] = [];
			filter.notOrEmpty.map(({ key }: { key: string }) => {
				whereOrArray.push(`notEmpty(${key})`);
			});

			whereArray.push(`( ${whereOrArray.join(" OR ")} )`);
		}

		if (filter.notEmpty && filter.notEmpty?.length > 0) {
			filter.notEmpty.map(({ key }: { key: string }) => {
				whereArray.push(`notEmpty(${key})`);
			});
		}

		const { statusCode = "STATUS_CODE_OK" } = filter;
		whereArray.push(`StatusCode='${statusCode}'`);
	} catch {}
	return whereArray.join(" AND ");
};

export const getFilterPreviousParams = (filter: MetricParams) => {
	try {
		const previousParams: MetricParams = JSON.parse(JSON.stringify(filter));
		const { start, end, type } = filter.timeLimit || {};
		switch (type) {
			case "24H":
				previousParams.timeLimit.start = addDays(
					start as Date,
					-1
				).toISOString();
				previousParams.timeLimit.end = addDays(end as Date, -1).toISOString();
				break;
			case "7D":
				previousParams.timeLimit.start = addDays(
					start as Date,
					-7
				).toISOString();
				previousParams.timeLimit.end = addDays(end as Date, -1).toISOString();
				break;
			case "1M":
				previousParams.timeLimit.start = addMonths(
					start as Date,
					-1
				).toISOString();
				previousParams.timeLimit.end = addMonths(end as Date, -1).toISOString();
				break;
			case "3M":
				previousParams.timeLimit.start = addMonths(
					start as Date,
					-3
				).toISOString();
				previousParams.timeLimit.end = addMonths(end as Date, -3).toISOString();
				break;
			case "CUSTOM":
				const differenceDays = differenceInDays(end as Date, start as Date);
				previousParams.timeLimit.start = addDays(
					start as Date,
					-differenceDays
				).toISOString();
				previousParams.timeLimit.end = addDays(
					end as Date,
					-differenceDays
				).toISOString();
				break;
			default:
		}

		return previousParams;
	} catch {
		return filter;
	}
};

export const getFilterWhereConditionForGPU = (
	filter: FilterWhereConditionType
) => {
	const whereArray: string[] = [];
	try {
		const { start, end } = filter.timeLimit || {};
		if (start && end) {
			whereArray.push(
				`TimeUnix >= parseDateTimeBestEffort('${start}') AND TimeUnix <= parseDateTimeBestEffort('${end}')`
			);
		}

		if (filter.gpu_type) {
			whereArray.push(`MetricName = 'gpu.${filter.gpu_type}'`);
		}
	} catch {}
	return whereArray.join(" AND ");
};

export const dateTruncGroupingLogic = (end: Date, start: Date) => {
	let dateTrunc = "day";
	if (differenceInYears(end as Date, start as Date) >= 1) {
		dateTrunc = "month";
	} else if (differenceInDays(end as Date, start as Date) <= 1) {
		dateTrunc = "hour";
	}

	return dateTrunc;
};
