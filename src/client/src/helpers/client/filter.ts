import { FilterType } from "@/types/store/filter";
import { omit } from "lodash";

export const getFilterParamsForDashboard = (filter: FilterType) => {
	// Keep `selectedConfig` — dashboard endpoints respect it (provider, model,
	// environment, and the agent-detail `serviceNames` scope lock) when the
	// server-side helper is called with `filterSelectedConfig=true`. Stripping
	// it here would silently leak unrelated services into the agent-detail
	// Analytics tab.
	return omit(filter, ["limit", "offset", "sorting", "refreshRate"]);
};
