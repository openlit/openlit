"use client";

import { useEffect, useRef } from "react";
import { useRootStore } from "@/store";
import { getUpdateFilter, getFilterDetails } from "@/selectors/filter";
import type { VersionFilter } from "@/types/store/filter";

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

	const currentServiceNames =
		filterDetails.selectedConfig?.serviceNames;
	const currentApplicationNames =
		filterDetails.selectedConfig?.applicationNames;
	const currentEnvironments =
		filterDetails.selectedConfig?.environments;
	const currentVersionFilter =
		filterDetails.selectedConfig?.versionFilter;

	useEffect(() => {
		if (previousScopeRef.current === null) {
			previousScopeRef.current = {
				serviceNames: filterDetails.selectedConfig?.serviceNames || [],
				applicationNames:
					filterDetails.selectedConfig?.applicationNames || [],
				environments: filterDetails.selectedConfig?.environments || [],
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

	useEffect(() => {
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

	return <>{children}</>;
}
