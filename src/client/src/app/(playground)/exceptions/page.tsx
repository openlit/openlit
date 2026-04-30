"use client";
import { useCallback, useEffect, useMemo } from "react";
import {
	RequestProvider,
	useRequest,
	useRequestNavigation,
} from "@/components/(playground)/request/request-context";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import RequestDetails from "@/components/(playground)/request/request-details";
import { normalizeTrace } from "@/helpers/client/trace";
import DataTable from "@/components/data-table/table";
import { columns } from "@/components/(playground)/exceptions/columns";
import { getVisibilityColumnsOfPage } from "@/selectors/page";
import TracesFilter from "@/components/(playground)/filter/traces-filter";
import ExceptionsGettingStarted from "@/components/(playground)/getting-started/tracing";
import GroupedTable, { buildGroupValueFilter } from "@/components/(playground)/request/grouped-table";
import GroupBreadcrumb from "@/components/(playground)/request/group-breadcrumb";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

function ExceptionPage() {
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
	const [, updateRequest] = useRequest();
	const { setItems, setTotal, setOffset, setOnPageChange } = useRequestNavigation();

	const onClick = (item: any) => {
		!isLoading && updateRequest(item);
	};

	const pingStatus = useRootStore(getPingStatus);
	const visibilityColumns = useRootStore((state) =>
		getVisibilityColumnsOfPage(state, "exception")
	);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const { data: existData, fireRequest: fireExistRequest, isFetched: isFetchedExist, isLoading: isLoadingExist } = useFetchWrapper();

	useEffect(() => {
		fireExistRequest({
			requestType: "POST",
			url: "/api/metrics/request/exist",
		});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// When groupBy + groupValue are both set, inject the group filter into the flat list fetch
	const effectiveFilter = useMemo(() => {
		if (filter.groupBy && filter.groupValue) {
			return {
				...filter,
				selectedConfig: buildGroupValueFilter(filter.groupBy, filter.groupValue, filter.selectedConfig),
			};
		}
		return filter;
	}, [filter]);

	// Show flat list when: no groupBy, OR groupBy + groupValue (drilled in)
	const showFlatList = !filter.groupBy || !!filter.groupValue;

	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify(effectiveFilter),
			requestType: "POST",
			url: "/api/metrics/exception",
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "exception-page",
				});
			},
		});
	}, [effectiveFilter, fireRequest]);

	useEffect(() => {
		if (
			effectiveFilter.filterReady &&
			effectiveFilter.timeLimit.start &&
			effectiveFilter.timeLimit.end &&
			pingStatus === "success" &&
			showFlatList
		)
			fetchData();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [effectiveFilter, pingStatus, showFlatList]);

	const normalizedData = useMemo(
		() => ((data as any)?.records || []).map(normalizeTrace),
		[data]
	);

	const totalItems = (data as any)?.total || 0;

	useEffect(() => {
		setItems(normalizedData);
	}, [normalizedData, setItems]);

	useEffect(() => {
		setTotal(totalItems);
	}, [totalItems, setTotal]);

	useEffect(() => {
		setOffset(filter.offset);
	}, [filter.offset, setOffset]);

	useEffect(() => {
		setOnPageChange((dir: -1 | 1) => {
			updateFilter("offset", filter.offset + dir * filter.limit);
		});
		return () => setOnPageChange(null);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filter.offset, filter.limit, updateFilter, setOnPageChange]);

	if (existData === false && !isLoadingExist && isFetchedExist) {
		return (
			<div className="flex flex-col w-full h-full overflow-auto">
				<ExceptionsGettingStarted />
			</div>
		);
	}

	return (
		<>
			<TracesFilter
				total={showFlatList ? totalItems : undefined}
				includeOnlySorting={["Timestamp"]}
				pageName="exception"
				columns={columns}
				supportDynamicFilters
			/>

			{filter.groupBy && (
				<GroupBreadcrumb
					groupBy={filter.groupBy}
					groupValue={filter.groupValue}
					rootLabel="All Exceptions"
					updateFilter={updateFilter}
				/>
			)}

			{filter.groupBy && !filter.groupValue ? (
				<GroupedTable
					groupBy={filter.groupBy}
					apiUrl="/api/metrics/exception/grouped"
				/>
			) : (
				<DataTable
					columns={columns}
					data={normalizedData}
					isFetched={isFetched || pingStatus !== "pending"}
					isLoading={isLoading || pingStatus === "pending"}
					visibilityColumns={visibilityColumns}
					onClick={onClick}
				/>
			)}
			<RequestDetails />
		</>
	);
}

export default function Page() {
	const posthog = usePostHog();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.EXCEPTIONS_PAGE_VISITED);
	}, []);

	return (
		<RequestProvider>
			<ExceptionPage />
		</RequestProvider>
	);
}
