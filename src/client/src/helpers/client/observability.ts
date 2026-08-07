import { DEFAULT_SORTING } from "@/store/filter";
import { AttributeKeys, FilterConfig } from "@/types/store/filter";

export type UpdateFilterFn = (
	key: string,
	value: any,
	extraParams?: any
) => void;

export type UpdateConfigFn = (config?: FilterConfig) => void;

export type UpdateAttributeKeysFn = (keys: AttributeKeys) => void;

const EMPTY_ATTRIBUTE_KEYS: AttributeKeys = {
	spanAttributeKeys: [],
	resourceAttributeKeys: [],
	logAttributeKeys: [],
	scopeAttributeKeys: [],
	metricAttributeKeys: [],
};

// E3: when the active observability signal/tab changes (traces ↔
// metrics ↔ logs ↔ coding-agent sessions), the previous tab's sort
// key (e.g. "Tokens") is almost never a valid column on the new tab.
// Leaving it set leaks ORDER BY clauses across signals and causes
// the new tab to fall back to an inappropriate default ordering at
// best — or a 500 at worst when the SQL column doesn't exist.
// Reset sort, pagination, selected filters, and attribute-key caches
// alongside the existing groupBy/config reset so logs filters
// (severities) cannot leak onto metrics (metricNames) and vice versa.
// Agent-scoped `serviceNames` are re-asserted by AgentScopeProvider
// after the wipe.
export function prepareObservabilitySignalChange(
	updateConfig: UpdateConfigFn,
	updateFilter: UpdateFilterFn,
	updateAttributeKeys?: UpdateAttributeKeysFn
) {
	updateConfig(undefined);
	updateFilter("groupBy", null);
	updateFilter("groupValue", null);
	updateFilter("sorting", DEFAULT_SORTING);
	updateFilter("offset", 0);
	updateFilter("selectedConfig", {}, { clearFilter: true });
	updateAttributeKeys?.(EMPTY_ATTRIBUTE_KEYS);
}
