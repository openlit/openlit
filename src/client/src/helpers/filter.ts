import { omit } from "lodash";

export const getFilterParamsForDashboard = (filter: Record<any, any>) => {
	return omit(filter, ["limit", "offset", "selectedConfig", "sorting"]);
};
