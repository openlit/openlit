"use client";

import {
	createContext,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useRootStore } from "@/store";
import { getUpdateFilter, getFilterDetails } from "@/selectors/filter";
import type { VersionFilter } from "@/types/store/filter";
import { Loader2 } from "lucide-react";

/**
 * True for any subtree rendered inside an agent-detail scope lock. The shared
 * observability surfaces (Telemetry list/summary) read this to tell an
 * intentional per-agent `serviceNames` scope apart from a stale lock leaking
 * into the global page, and strip the latter before querying.
 */
const AgentScopeContext = createContext(false);

export function useIsAgentScoped(): boolean {
	return useContext(AgentScopeContext);
}

interface AgentScopeProviderProps {
	serviceName: string;
	environment?: string;
	/**
	 * Optional version scope: when present, every query made by descendants
	 * (dashboard widgets, requests table, DAG aggregator) will be filtered to
	 * this version's traffic via `getFilterWhereCondition` ->
	 * `buildVersionWhereClause`.
	 */
	versionFilter?: VersionFilter | null;
	children: React.ReactNode;
}

interface PreviousScope {
	serviceNames: string[];
	applicationNames: string[];
	environments: string[];
	versionFilter?: VersionFilter;
}

function arraysEqual(a: string[] | undefined, b: string[]) {
	if (!a || a.length !== b.length) return false;
	for (let i = 0; i < b.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function versionFilterEqual(
	a: VersionFilter | undefined,
	b: VersionFilter | null | undefined
): boolean {
	if (!a && !b) return true;
	if (!a || !b) return false;
	return (
		a.versionHash === b.versionHash &&
		a.firstSeen === b.firstSeen &&
		a.lastSeen === b.lastSeen &&
		a.hasAttributeSpans === b.hasAttributeSpans
	);
}

/**
 * Locks the global filter store to a single service (and, optionally,
 * a single agent version) while the agent detail page is mounted. Acts as a
 * continuous lock — re-asserts the scope whenever the store drifts away
 * (e.g. the user switches time range, which the store resets
 * `selectedConfig` for). Restores the previous scope on unmount so
 * navigating away doesn't leak the lock.
 *
 * Children are gated behind `scopeReady` so widget effects cannot fire an
 * unscoped request before the lock is applied (React runs child effects
 * before parent effects).
 */
export default function AgentScopeProvider({
	serviceName,
	environment,
	versionFilter,
	children,
}: AgentScopeProviderProps) {
	const updateFilter = useRootStore(getUpdateFilter);
	const filterDetails = useRootStore(getFilterDetails);
	const previousScopeRef = useRef<PreviousScope | null>(null);
	const [lockApplied, setLockApplied] = useState(false);

	const currentServiceNames =
		filterDetails.selectedConfig?.serviceNames;
	const currentApplicationNames =
		filterDetails.selectedConfig?.applicationNames;
	const currentEnvironments =
		filterDetails.selectedConfig?.environments;
	const currentVersionFilter =
		filterDetails.selectedConfig?.versionFilter;

	// Capture-on-mount / restore-on-unmount. This MUST be a layout effect: its
	// cleanup runs synchronously during the unmount commit, before the next
	// route's passive effects fire. A plain `useEffect` cleanup is a passive
	// effect that can run *after* the destination page (e.g. Telemetry) has
	// already issued its first request, leaking the `serviceNames` lock into a
	// global query and collapsing the list to this one agent's service.
	useLayoutEffect(() => {
		if (previousScopeRef.current === null) {
			// COPY the arrays — never hold the live store reference. The store's
			// `updateFilter` merges via lodash `merge`, which mutates arrays in
			// place; since an empty array is truthy, `serviceNames || []` would
			// otherwise capture the store's own array and the subsequent lock
			// apply would mutate this "previous" snapshot into the agent's
			// service. Restore would then write the agent scope back instead of
			// clearing it — a leak that compounds on every agent visit.
			previousScopeRef.current = {
				serviceNames: [...(filterDetails.selectedConfig?.serviceNames || [])],
				applicationNames: [
					...(filterDetails.selectedConfig?.applicationNames || []),
				],
				environments: [...(filterDetails.selectedConfig?.environments || [])],
				versionFilter: filterDetails.selectedConfig?.versionFilter,
			};
		}

		return () => {
			const prev = previousScopeRef.current;
			if (!prev) return;
			updateFilter("selectedConfig.serviceNames", prev.serviceNames);
			updateFilter("selectedConfig.applicationNames", prev.applicationNames);
			if (environment) {
				updateFilter("selectedConfig.environments", prev.environments);
			}
			updateFilter(
				"selectedConfig.versionFilter",
				prev.versionFilter || undefined
			);
			previousScopeRef.current = null;
		};
		// Capture-on-mount / restore-on-unmount only.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Apply the lock synchronously before child paint/effects.
	useLayoutEffect(() => {
		const target = [serviceName];
		if (!arraysEqual(currentServiceNames, target)) {
			updateFilter("selectedConfig.serviceNames", target);
		}
		if ((currentApplicationNames?.length || 0) > 0) {
			updateFilter("selectedConfig.applicationNames", []);
		}
		if (environment) {
			const envTarget = [environment];
			if (!arraysEqual(currentEnvironments, envTarget)) {
				updateFilter("selectedConfig.environments", envTarget);
			}
		}
		if (!versionFilterEqual(currentVersionFilter, versionFilter)) {
			updateFilter(
				"selectedConfig.versionFilter",
				versionFilter || undefined
			);
		}
		setLockApplied(true);
	}, [
		serviceName,
		environment,
		versionFilter,
		currentServiceNames,
		currentApplicationNames,
		currentEnvironments,
		currentVersionFilter,
		updateFilter,
	]);

	const scopeReady = useMemo(() => {
		if (!lockApplied) return false;
		if (!arraysEqual(currentServiceNames, [serviceName])) return false;
		if (environment && !arraysEqual(currentEnvironments, [environment])) {
			return false;
		}
		if (!versionFilterEqual(currentVersionFilter, versionFilter)) return false;
		return true;
	}, [
		lockApplied,
		currentServiceNames,
		currentEnvironments,
		currentVersionFilter,
		serviceName,
		environment,
		versionFilter,
	]);

	if (!scopeReady) {
		return (
			<div className="flex items-center justify-center py-12 text-sm text-stone-500 dark:text-stone-400 gap-2">
				<Loader2 className="w-4 h-4 animate-spin" />
				Loading agent scope…
			</div>
		);
	}

	return (
		<AgentScopeContext.Provider value={true}>
			{children}
		</AgentScopeContext.Provider>
	);
}
