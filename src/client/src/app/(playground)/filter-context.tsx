"use client";

import React, { ReactNode, createContext, useContext, useState } from "react";
import { merge, set } from "lodash";
import { addDays, addMonths, addWeeks } from "date-fns";

export const TIME_RANGE_TYPE: Record<"24H" | "7D" | "1M" | "3M", string> = {
	"24H": "24H",
	"7D": "7D",
	"1M": "1M",
	"3M": "3M",
};

export const DEFAULT_TIME_RANGE = "7D";

export interface FilterType {
	timeLimit: {
		start?: Date;
		end?: Date;
		type: keyof typeof TIME_RANGE_TYPE;
	};
	limit: number;
	offset: number;
}

const FilterContext = createContext<
	[FilterType, (key: string, value: any) => void] | undefined
>(undefined);

function getTimeLimitObject(value: string, keyPrefix: string) {
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
		console.log("valuevaluevalue");
		const currentDate = new Date();
		set(object, `${keyPrefix}start`, addMonths(currentDate, -3));
		set(object, `${keyPrefix}end`, currentDate);
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

export function FilterProvider({ children }: { children: ReactNode }) {
	const [filter, setFilter] = useState(INITIAL_FILTER);
	const updateFilter = (key: string, value: any) => {
		let object = {};
		switch (key) {
			case "timeLimit.type":
				object = getTimeLimitObject(value, "timeLimit.");
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
		setFilter((e) => merge({}, e, object));
	};

	return (
		<FilterContext.Provider value={[filter, updateFilter]}>
			{children}
		</FilterContext.Provider>
	);
}

export function useFilter() {
	const context = useContext(FilterContext);
	if (context === undefined) {
		throw new Error("useFilter must be used within a FilterProvider");
	}
	return context;
}
