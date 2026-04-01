"use client";
import { useCallback, useEffect, useMemo } from "react";
import {
	RequestProvider,
	useRequest,
	useRequestNavigation,
} from "@/components/(playground)/request/request-context";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import RequestDetails from "@/components/(playground)/request/request-details";
import { toast } from "sonner";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import DataTable from "@/components/data-table/table";
import { columns } from "@/components/(playground)/request/columns";
import { normalizeTrace } from "@/helpers/client/trace";
import { getVisibilityColumnsOfPage } from "@/selectors/page";
import TracesFilter from "@/components/(playground)/filter/traces-filter";
import TracingGettingStarted from "@/components/(playground)/getting-started/tracing";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

function RequestPage() {
	const [, updateRequest] = useRequest();
	const { setItems } = useRequestNavigation();

	const onClick = (item: any) => {
		!isLoading && updateRequest(item);
	};

	const filter = useRootStore(getFilterDetails);
	const visibilityColumns = useRootStore((state) =>
		getVisibilityColumnsOfPage(state, "request")
	);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const { data: existData, fireRequest: fireExistRequest, isFetched: isFetchedExist, isLoading: isLoadingExist } = useFetchWrapper();
	useEffect(() => {
		fireExistRequest({
			requestType: "POST",
			url: "/api/metrics/request/exist",
		});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify(filter),
			requestType: "POST",
			url: "/api/metrics/request",
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "request-page",
				});
			},
		});
	}, [filter, fireRequest]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		)
			fetchData();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filter, pingStatus]);

	const normalizedData = useMemo(
		() => ((data as any)?.records || []).map(normalizeTrace),
		[data]
	);

	useEffect(() => {
		setItems(normalizedData);
	}, [normalizedData, setItems]);

	// Show getting started when there's no trace data AND initial fetch is complete
	if (existData === false && !isLoadingExist && isFetchedExist) {
		return (
			<div className="flex flex-col w-full h-full overflow-auto">
				<TracingGettingStarted />
			</div>
		);
	}

	return (
		<>
			<TracesFilter
				total={(data as any)?.total}
				supportDynamicFilters
				pageName="request"
				columns={columns}
			/>
			<DataTable
				columns={columns}
				data={normalizedData}
				isFetched={isFetched || pingStatus !== "pending"}
				isLoading={isLoading || pingStatus === "pending"}
				visibilityColumns={visibilityColumns}
				onClick={onClick}
			/>
			<RequestDetails />
		</>
	);
}

export default function Page() {
	const posthog = usePostHog();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.REQUESTS_PAGE_VISITED);
	}, []);

	return (
		<RequestProvider>
			<RequestPage />
		</RequestProvider>
	);
}
