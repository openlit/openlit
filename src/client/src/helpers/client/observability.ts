import { DEFAULT_SORTING } from "@/store/filter";
import { FilterConfig } from "@/types/store/filter";

export type UpdateFilterFn = (
	key: string,
	value: any,
	extraParams?: any
) => void;

export type UpdateConfigFn = (config?: FilterConfig) => void;

// E3: when the active observability signal/tab changes (traces ↔
// metrics ↔ logs ↔ coding-agent sessions), the previous tab's sort
// key (e.g. "Tokens") is almost never a valid column on the new tab.
// Leaving it set leaks ORDER BY clauses across signals and causes
// the new tab to fall back to an inappropriate default ordering at
// best — or a 500 at worst when the SQL column doesn't exist.
// Reset sort and pagination alongside the existing groupBy/config
// reset so each tab starts from a clean slate.
export function prepareObservabilitySignalChange(
	updateConfig: UpdateConfigFn,
	updateFilter: UpdateFilterFn
) {
	updateConfig(undefined);
	updateFilter("groupBy", null);
	updateFilter("groupValue", null);
	updateFilter("sorting", DEFAULT_SORTING);
	updateFilter("offset", 0);
}
