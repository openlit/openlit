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
//
// selectedConfig must be cleared too. Each signal owns its own
// localStorage scope (`openlit_filter_v1:<signal>`), so preserving
// the previous tab's filters in the Zustand store defeats that and
// silently empties the new tab. The concrete failure mode: Traces
// `providers=openai` surviving into Exceptions, where every
// StatusCode=Error span from a failed LLM call has empty
// gen_ai.provider.name / gen_ai.system (the SDK never stamped them
// before the error) — the provider WHERE matches zero rows and the
// Exceptions tab renders empty despite hundreds of errors in CH.
// After the wipe, the new tab's useFilterUrlSync re-applies that
// signal's own persisted filters from localStorage / URL.
export function prepareObservabilitySignalChange(
	updateConfig: UpdateConfigFn,
	updateFilter: UpdateFilterFn
) {
	updateConfig(undefined);
	updateFilter("selectedConfig", {}, { clearFilter: true });
	updateFilter("groupBy", null);
	updateFilter("groupValue", null);
	updateFilter("sorting", DEFAULT_SORTING);
	updateFilter("offset", 0);
}
