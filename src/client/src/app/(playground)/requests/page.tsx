"use client";
import RequestTable from "./request-table";
import { useCallback, useEffect } from "react";
import RequestFilter, { FilterConfigProps } from "./request-filter";
import { RequestProvider } from "./request-context";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import RequestDetails from "./request-details";
import { toast } from "sonner";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";

export default function RequestPage() {
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
				// TODO: send config true based on if the config has not already been fetched or when the timeLimit is changed
				config: {
					providers: true,
					maxCost: true,
					models: true,
					totalRows: true,
				},
				limit: filter.limit,
				offset: filter.offset,
			}),
			requestType: "POST",
			url: "/api/metrics/request",
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "request-page",
				});
			},
		});
	}, [filter]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		)
			fetchData();
	}, [filter, fetchData, pingStatus]);

	return (
		<RequestProvider>
			<RequestFilter
				config={(data as any)?.config as FilterConfigProps | undefined}
			/>
			<RequestTable
				data={(data as any)?.records || []}
				isFetched={isFetched || pingStatus !== "pending"}
				isLoading={isLoading || pingStatus === "pending"}
			/>
			<RequestDetails />
		</RequestProvider>
	);
}
