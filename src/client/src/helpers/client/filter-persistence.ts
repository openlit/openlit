const FILTER_STORAGE_KEY_PREFIX = "openlit_filter_v1";

export const FILTER_PARAM_KEYS = [
	"tr",
	"ts",
	"te",
	"limit",
	"offset",
	"models",
	"providers",
	"traceTypes",
	"appNames",
	"spanNames",
	"envs",
	"maxCost",
	"services",
	"severities",
	"metricNames",
	"metricTypes",
	"cf",
	"gb",
	"gbv",
];

export function getFilterStorageKey(scope?: string) {
	return scope
		? `${FILTER_STORAGE_KEY_PREFIX}:${scope}`
		: FILTER_STORAGE_KEY_PREFIX;
}

export function stripFilterParams(params: URLSearchParams) {
	FILTER_PARAM_KEYS.forEach((key) => params.delete(key));
}
