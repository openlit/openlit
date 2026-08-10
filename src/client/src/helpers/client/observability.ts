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

/** Agent-detail scope fields that must survive a signal/tab filter wipe. */
export type ObservabilityScopePreserve = Pick<
	FilterConfig,
	"serviceNames" | "services" | "environments" | "versionFilter"
>;

/**
 * When the active observability signal/tab changes (traces ↔ metrics ↔
 * logs ↔ coding-agent sessions), reset sort, pagination, selected filters,
 * and attribute-key caches so one signal's filters cannot leak into another.
 *
 * On agent-detail pages, pass `preserveScope` so `serviceNames` /
 * `services` / `environments` / `versionFilter` stay locked. Wiping those
 * fields makes `AgentScopeProvider` briefly report not-ready, unmount the
 * list, remount it, wipe again, and hit "Maximum update depth exceeded".
 */
export function prepareObservabilitySignalChange(
	updateConfig: UpdateConfigFn,
	updateFilter: UpdateFilterFn,
	updateAttributeKeys?: UpdateAttributeKeysFn,
	preserveScope?: ObservabilityScopePreserve | null
) {
	updateConfig(undefined);
	updateFilter("groupBy", null);
	updateFilter("groupValue", null);
	updateFilter("sorting", DEFAULT_SORTING);
	updateFilter("offset", 0);

	const preserved: Partial<FilterConfig> = {};
	if (preserveScope?.serviceNames?.length) {
		preserved.serviceNames = [...preserveScope.serviceNames];
	}
	if (preserveScope?.services?.length) {
		preserved.services = [...preserveScope.services];
	}
	if (preserveScope?.environments?.length) {
		preserved.environments = [...preserveScope.environments];
	}
	if (preserveScope?.versionFilter) {
		preserved.versionFilter = preserveScope.versionFilter;
	}

	updateFilter("selectedConfig", preserved, { clearFilter: true });
	updateAttributeKeys?.(EMPTY_ATTRIBUTE_KEYS);
}
