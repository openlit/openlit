import { FilterType } from "@/store/filter";
import { omit } from "lodash";

export const getFilterParamsForDashboard = (filter: FilterType) => {
	return omit(filter, [
		"limit",
		"offset",
		"selectedConfig",
		"sorting",
		"refreshRate",
	]);
};

export const getFilterParamsForRequest = (filter: FilterType) => {
	return omit(filter, ["refreshRate"]);
};

export const getFilterParamsForException = (filter: FilterType) => {
	return omit(filter, ["refreshRate"]);
};
