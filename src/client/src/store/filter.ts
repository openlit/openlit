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

export interface FilterType {
	timeLimit: {
		start?: Date;
		end?: Date;
		type: keyof typeof TIME_RANGE_TYPE;
	};
	limit: number;
	offset: number;
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

const INITIAL_FILTER: FilterType = {
	timeLimit: {
		type: DEFAULT_TIME_RANGE,
		...getTimeLimitObject(DEFAULT_TIME_RANGE, ""),
	},
	limit: 10,
	offset: 0,
};

export type FilterStore = {
	details: FilterType;
	updateFilter: (key: string, value: any, extraParams?: any) => void;
};

export const filterStoreSlice: FilterStore = lens((setStore, getStore) => ({
	details: INITIAL_FILTER,
	updateFilter: (key: string, value: any, extraParams?: any) => {
		let object = {};
		switch (key) {
			case "timeLimit.type":
				object = getTimeLimitObject(value, "timeLimit.", extraParams);
				break;
			case "limit":
				set(object, "offset", 0);
				break;
			case "offset":
				break;
			default:
				break;
		}

		set(object, key, value);
		setStore({ details: { ...getStore().details, ...object } });
	},
}));
