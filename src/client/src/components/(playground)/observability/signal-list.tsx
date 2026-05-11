"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import DataTable from "@/components/data-table/table";
import TracesFilter from "@/components/(playground)/filter/traces-filter";
import GroupBreadcrumb from "@/components/(playground)/request/group-breadcrumb";
import GroupedTable, {
	buildGroupValueFilter,
} from "@/components/(playground)/request/grouped-table";
import { getPingStatus } from "@/selectors/database-config";
import {
	getFilterDetails,
	getUpdateConfig,
	getUpdateFilter,
} from "@/selectors/filter";
import { getVisibilityColumnsOfPage } from "@/selectors/page";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { ObservabilitySignalConfig } from "./registry";

export default function ObservabilitySignalList({
	config,
}: {
	config: ObservabilitySignalConfig;
}) {
	const router = useRouter();
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
	const updateConfig = useRootStore(getUpdateConfig);
	const pingStatus = useRootStore(getPingStatus);
	const visibilityColumns = useRootStore((state) =>
		getVisibilityColumnsOfPage(state, config.visibilityPage)
	);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();

	useEffect(() => {
		updateConfig(undefined);
		updateFilter("groupBy", null);
		updateFilter("selectedConfig", {}, { clearFilter: true });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [config.key]);

	const effectiveFilter = useMemo(() => {
		if (filter.groupBy && filter.groupValue) {
			return {
				...filter,
				selectedConfig: buildGroupValueFilter(
					filter.groupBy,
					filter.groupValue,
					filter.selectedConfig
				),
			};
		}
		return filter;
	}, [filter]);

	const showFlatList =
		!config.supportGrouping || !filter.groupBy || !!filter.groupValue;

	const fetchData = useCallback(() => {
		fireRequest({
			body: JSON.stringify(effectiveFilter),
			requestType: "POST",
			url: config.listUrl,
			failureCb: (err?: string) => {
				toast.error(err || "Cannot connect to server!", {
					id: `observability-${config.key}`,
				});
			},
		});
	}, [config.key, config.listUrl, effectiveFilter, fireRequest]);

	useEffect(() => {
		if (
			effectiveFilter.filterReady &&
			effectiveFilter.timeLimit.start &&
			effectiveFilter.timeLimit.end &&
			pingStatus === "success" &&
			showFlatList
		) {
			fetchData();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [effectiveFilter, pingStatus, showFlatList]);

	const rows = useMemo(() => {
		const records = (data as any)?.records || [];
		return config.normalize ? records.map(config.normalize) : records;
	}, [config, data]);
	const total = (data as any)?.total || 0;

	const openDetail = (row: any) => {
		if (isLoading) return;
		const from = `${window.location.pathname}${window.location.search}`;
		router.push(config.getDetailHref(row, from));
	};

	return (
		<>
			<TracesFilter
				total={showFlatList ? total : undefined}
				supportDynamicFilters
				includeOnlySorting={config.includeOnlySorting}
				pageName={config.pageName}
				columns={config.columns}
				configUrl={config.configUrl}
				attributeKeysUrl={config.attributeKeysUrl}
				customAttributeTypes={config.customAttributeTypes}
			/>

			{config.supportGrouping && filter.groupBy && (
				<GroupBreadcrumb
					groupBy={filter.groupBy}
					groupValue={filter.groupValue}
					rootLabel={`All ${config.label}`}
					updateFilter={updateFilter}
				/>
			)}

			{config.supportGrouping && filter.groupBy && !filter.groupValue ? (
				<GroupedTable
					groupBy={filter.groupBy}
					apiUrl={config.groupedUrl}
				/>
			) : (
				<DataTable
					columns={config.columns}
					data={rows}
					isFetched={isFetched || pingStatus !== "pending"}
					isLoading={isLoading || pingStatus === "pending"}
					visibilityColumns={visibilityColumns}
					onClick={openDetail}
				/>
			)}
		</>
	);
}
