"use client";
import RequestTable from "./request-table";
import { useCallback, useEffect } from "react";
import RequestFilter from "./request-filter";
import { RequestProvider } from "./request-context";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import RequestDetails from "./request-details";
import { toast } from "sonner";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import { Separator } from "@/components/ui/separator";

export default function RequestPage() {
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
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
			<RequestFilter total={(data as any)?.total} />
			<RequestTable
				data={(data as any)?.records || []}
				isFetched={isFetched || pingStatus !== "pending"}
				isLoading={isLoading || pingStatus === "pending"}
			/>
			<RequestDetails />
		</RequestProvider>
	);
}
