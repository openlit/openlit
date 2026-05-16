import { FilterConfig } from "@/types/store/filter";

export type UpdateFilterFn = (
	key: string,
	value: any,
	extraParams?: any
) => void;

export type UpdateConfigFn = (config?: FilterConfig) => void;

export function prepareObservabilitySignalChange(
	updateConfig: UpdateConfigFn,
	updateFilter: UpdateFilterFn
) {
	updateConfig(undefined);
	updateFilter("groupBy", null);
}
