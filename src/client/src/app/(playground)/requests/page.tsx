"use client";
import RequestTable from "./request-table";
import { useFilter } from "../filter-context";
import { useCallback, useEffect } from "react";
import RequestFilter, { FilterConfigProps } from "./request-filter";
import { RequestProvider } from "./request-context";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import RequestDetails from "./request-details";
import toast from "react-hot-toast";
import { useFilterStore } from "@/store/filter";

export default function RequestPage() {
	// const [filter] = useFilter();
	const { filter } = useFilterStore();
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
				// TODO: send config true based on if the config has not already been fetched or when the timeLimit is changed
				config: {
					endpoints: true,
					maxUsageCost: true,
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
		if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
	}, [filter, fetchData]);

	return (
		<RequestProvider>
			<RequestFilter
				config={(data as any)?.config as FilterConfigProps | undefined}
			/>
			<RequestTable
				data={(data as any)?.records || []}
				isFetched={isFetched}
				isLoading={isLoading}
			/>
			<RequestDetails />
		</RequestProvider>
	);
}
