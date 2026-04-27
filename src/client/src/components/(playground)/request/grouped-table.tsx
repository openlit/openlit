"use client";
import { useState, useEffect, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { fill } from "lodash";
import { useRootStore } from "@/store";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { getPingStatus } from "@/selectors/database-config";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { CustomFilter, CustomFilterAttributeType, FilterConfig } from "@/types/store/filter";
import { PRIMARY_BACKGROUND } from "@/constants/common-classes";

// ─── Shared utilities (also imported by requests/page.tsx) ────────────────────

const PREDEFINED_FILTER_MAP: Record<string, { attributeType: CustomFilterAttributeType; key: string }> = {
	model: { attributeType: "SpanAttributes", key: "gen_ai.request.model" },
	provider: { attributeType: "SpanAttributes", key: "gen_ai.system" },
	spanName: { attributeType: "Field", key: "SpanName" },
	applicationName: { attributeType: "ResourceAttributes", key: "service.name" },
};

export const PREDEFINED_LABEL_MAP: Record<string, string> = {
	model: "Model",
	provider: "Provider",
	spanName: "Span Name",
	applicationName: "Application",
};

export function getGroupFilterSpec(groupBy: string): { attributeType: CustomFilterAttributeType; key: string } {
	if (groupBy in PREDEFINED_FILTER_MAP) return PREDEFINED_FILTER_MAP[groupBy];
	const sep = groupBy.indexOf(":");
	if (sep === -1) return { attributeType: "SpanAttributes", key: groupBy };
	const attrType = groupBy.slice(0, sep) as CustomFilterAttributeType;
	const key = groupBy.slice(sep + 1);
	return { attributeType: attrType, key };
}

export function getGroupByLabel(groupBy: string): string {
	if (groupBy in PREDEFINED_LABEL_MAP) return PREDEFINED_LABEL_MAP[groupBy];
	const sep = groupBy.indexOf(":");
	return sep !== -1 ? groupBy.slice(sep + 1) : groupBy;
}

// Always build via getGroupFilterSpec so the flat-list filter uses the exact same
// ClickHouse expression as the GROUP BY query (avoids mismatches like the
// applicationName path which resolves incorrectly through FilterConfig field names).
export function buildGroupValueFilter(
	groupBy: string,
	groupValue: string,
	currentConfig: Partial<FilterConfig>
): Partial<FilterConfig> {
	const filterSpec = getGroupFilterSpec(groupBy);
	const existing: CustomFilter[] = (currentConfig.customFilters ?? []).filter(
		(f) => !(f.attributeType === filterSpec.attributeType && f.key === filterSpec.key)
	);
	return {
		...currentConfig,
		customFilters: [
			...existing,
			{ attributeType: filterSpec.attributeType, key: filterSpec.key, value: groupValue },
		],
	};
}

// ─── Component internals ──────────────────────────────────────────────────────

interface GroupSummary {
	group_value: string;
	count: number;
	total_cost: number;
	total_tokens: number;
	avg_duration_seconds: number;
}

const GRID_COLS = "grid-cols-[1fr_100px_110px_110px_110px_32px]";

function SkeletonRow() {
	return (
		<div className={`grid ${GRID_COLS} w-full animate-pulse border-b dark:border-stone-800`}>
			{fill(new Array(6), 0).map((_, i) => (
				<div key={i} className="px-3 py-3.5">
					<div className="h-2.5 rounded bg-stone-200 dark:bg-stone-700 w-3/4" />
				</div>
			))}
		</div>
	);
}

function GroupRow({
	group,
	onClickGroup,
}: {
	group: GroupSummary;
	onClickGroup: (groupValue: string) => void;
}) {
	const label = group.group_value || "—";
	const isEmpty = !group.group_value;

	return (
		<div
			className={`grid ${GRID_COLS} w-full border-b dark:border-stone-800 last:border-b-0 text-sm group ${
				isEmpty ? "opacity-50" : "cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800/60"
			}`}
			onClick={() => !isEmpty && onClickGroup(group.group_value)}
		>
			<div className="px-3 py-3 font-medium text-stone-700 dark:text-stone-200 truncate" title={label}>
				{label}
			</div>
			<div className="px-3 py-3 text-right tabular-nums text-stone-600 dark:text-stone-300">
				{group.count.toLocaleString()}
			</div>
			<div className="px-3 py-3 text-right tabular-nums text-stone-600 dark:text-stone-300">
				{group.total_cost > 0 ? `$${group.total_cost.toFixed(4)}` : "—"}
			</div>
			<div className="px-3 py-3 text-right tabular-nums text-stone-600 dark:text-stone-300">
				{group.total_tokens > 0 ? group.total_tokens.toLocaleString() : "—"}
			</div>
			<div className="px-3 py-3 text-right tabular-nums text-stone-600 dark:text-stone-300">
				{group.avg_duration_seconds > 0 ? `${group.avg_duration_seconds.toFixed(2)}s` : "—"}
			</div>
			<div className="px-3 py-3 flex items-center justify-center">
				{!isEmpty && (
					<ChevronRight className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600 group-hover:text-stone-500 dark:group-hover:text-stone-400 transition-colors" />
				)}
			</div>
		</div>
	);
}

export default function GroupedTable({
	groupBy,
	apiUrl = "/api/metrics/request/grouped",
}: {
	groupBy: string;
	apiUrl?: string;
}) {
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();

	const fetchGroups = useCallback(() => {
		fireRequest({
			body: JSON.stringify({ ...filter, groupBy }),
			requestType: "POST",
			url: apiUrl,
		});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filter, groupBy]);

	useEffect(() => {
		// Don't fetch before URL/localStorage params have been applied.
		// Also skip re-fetching when groupValue changes — the component is about
		// to unmount as the page transitions to the flat list view.
		if (
			filter.filterReady &&
			!filter.groupValue &&
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		) {
			fetchGroups();
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filter, groupBy, pingStatus]);

	// Clicking a group drills into it — sets groupValue so the page
	// switches to the filtered flat list with a breadcrumb.
	const handleGroupClick = useCallback((groupValue: string) => {
		updateFilter("groupValue", groupValue);
	}, [updateFilter]);

	const groups: GroupSummary[] = (data as any)?.data ?? [];
	const groupLabel = getGroupByLabel(groupBy);

	return (
		<div className={`flex flex-col w-full overflow-auto scrollbar-hidden border dark:border-stone-800 rounded-md grow ${PRIMARY_BACKGROUND}`}>
			{/* Column header */}
			<div className={`grid ${GRID_COLS} w-full sticky top-0 z-10 bg-stone-100 dark:bg-stone-900 text-xs font-medium text-stone-500 dark:text-stone-400 border-b dark:border-stone-800`}>
				<div className="px-3 py-2">{groupLabel}</div>
				<div className="px-3 py-2 text-right">Spans</div>
				<div className="px-3 py-2 text-right">Total Cost</div>
				<div className="px-3 py-2 text-right">Tokens</div>
				<div className="px-3 py-2 text-right">Avg Duration</div>
				<div />
			</div>

			{/* Loading skeleton */}
			{(!isFetched || (isLoading && !groups.length)) &&
				fill(new Array(8), 0).map((_, i) => <SkeletonRow key={i} />)
			}

			{/* Group rows */}
			{groups.map((group) => (
				<GroupRow
					key={group.group_value ?? "__empty__"}
					group={group}
					onClickGroup={handleGroupClick}
				/>
			))}

			{/* Empty state */}
			{isFetched && !isLoading && groups.length === 0 && (
				<div className="flex items-center justify-center py-16 text-sm text-stone-400 dark:text-stone-500">
					No data found for the selected filters.
				</div>
			)}
		</div>
	);
}
