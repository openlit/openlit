import { set } from "lodash";
import { addDays, addMonths, addWeeks } from "date-fns";
import { lens } from "@dhmk/zustand-lens";

export const TIME_RANGE_TYPE: Record<
	"24H" | "7D" | "1M" | "3M" | "CUSTOM",
	string
> = {
	"24H": "24H",
	"7D": "7D",
	"1M": "1M",
	"3M": "3M",
	CUSTOM: "CUSTOM",
};

export const DEFAULT_TIME_RANGE = "24H";

const DEFAULT_LIMIT = 10;

const DEFAULT_SORTING: FilterSorting = {
	type: "Timestamp",
	direction: "desc",
};

export type FilterSorting = {
	type: string;
	direction: "asc" | "desc";
};

export interface FilterType {
	timeLimit: {
		start?: Date;
		end?: Date;
		type: keyof typeof TIME_RANGE_TYPE;
	};
	limit: number;
	offset: number;
	selectedConfig: Partial<FilterConfig>;
	sorting: FilterSorting;
}

export interface FilterConfig {
	providers: string[];
	maxCost: number;
	models: string[];
	totalRows: number;
	traceTypes: string[];
}

function getTimeLimitObject(
	value: string,
	keyPrefix: string,
	extraParams?: any
) {
	let object = {};
	if (value === TIME_RANGE_TYPE["24H"]) {
		const currentDate = new Date();
		set(object, `${keyPrefix}start`, addDays(currentDate, -1));
		set(object, `${keyPrefix}end`, currentDate);
	} else if (value === TIME_RANGE_TYPE["7D"]) {
		const currentDate = new Date();
		set(object, `${keyPrefix}start`, addWeeks(currentDate, -1));
		set(object, `${keyPrefix}end`, currentDate);
	} else if (value === TIME_RANGE_TYPE["1M"]) {
		const currentDate = new Date();
		set(object, `${keyPrefix}start`, addMonths(currentDate, -1));
		set(object, `${keyPrefix}end`, currentDate);
	} else if (value === TIME_RANGE_TYPE["3M"]) {
		const currentDate = new Date();
		set(object, `${keyPrefix}start`, addMonths(currentDate, -3));
		set(object, `${keyPrefix}end`, currentDate);
	} else if (value === TIME_RANGE_TYPE["CUSTOM"]) {
		const start = extraParams?.start;
		const end = extraParams?.end;
		if (start && end) {
			set(object, `${keyPrefix}start`, start);
			set(object, `${keyPrefix}end`, end);
		}
	}
	return object;
}

const INITIAL_FILTER_DETAILS: FilterType = {
	timeLimit: {
		type: DEFAULT_TIME_RANGE,
		...getTimeLimitObject(DEFAULT_TIME_RANGE, ""),
	},
	limit: DEFAULT_LIMIT,
	offset: 0,
	selectedConfig: {},
	sorting: DEFAULT_SORTING,
};

export type FilterStore = {
	details: FilterType;
	config?: FilterConfig;
	updateFilter: (key: string, value: any, extraParams?: any) => void;
	updateConfig: (config: FilterConfig) => void;
};

export const filterStoreSlice: FilterStore = lens((setStore, getStore) => ({
	details: INITIAL_FILTER_DETAILS,
	updateFilter: (key: string, value: any, extraParams?: any) => {
		let object = {};
		let resetConfig = false;
		switch (key) {
			case "timeLimit.type":
				object = getTimeLimitObject(value, "timeLimit.", extraParams);
				resetConfig = true;
				break;
			case "limit":
			case "selectedConfig":
			case "sorting":
				set(object, "offset", 0);
				break;
			case "offset":
				// Its already handled in the set(object, key, value); line
				break;
			case "page-change":
				set(object, "offset", 0);
				set(object, "limit", DEFAULT_LIMIT);
				set(object, "sorting", DEFAULT_SORTING);
				break;
			default:
				break;
		}

		if (key !== "page-change") {
			set(object, key, value);
		}

		setStore({
			details: {
				...getStore().details,
				selectedConfig: resetConfig ? {} : getStore().details.selectedConfig,
				...object,
			},
			config: resetConfig ? undefined : getStore().config,
		});
	},
	updateConfig: (config: FilterConfig) => {
		setStore({ config });
	},
}));
