"use client";
import { useCallback, useEffect } from "react";
import {
	RequestProvider,
	useRequest,
} from "@/components/(playground)/request/request-context";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import { omit } from "lodash";
import RequestDetails from "@/components/(playground)/request/request-details";
import { normalizeTrace } from "@/helpers/client/trace";
import DataTable from "@/components/data-table/table";
import { columns } from "@/components/(playground)/exceptions/columns";
import { getVisibilityColumnsOfPage } from "@/selectors/page";
import TracesFilter from "@/components/(playground)/filter/traces-filter";

function ExceptionPage() {
	const filter = useRootStore(getFilterDetails);
	const [, updateRequest] = useRequest();

	const onClick = (item: any) => {
		!isLoading && updateRequest(item);
	};
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const visibilityColumns = useRootStore((state) =>
		getVisibilityColumnsOfPage(state, "exception")
	);

	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify(omit(filter, ["selectedConfig"])),
			requestType: "POST",
			url: "/api/metrics/exception",
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

	const normalizedData = ((data as any)?.records || []).map(normalizeTrace);

	return (
		<>
			<TracesFilter
				total={(data as any)?.total}
				includeOnlySorting={["Timestamp"]}
				pageName={"exception"}
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
	return (
		<RequestProvider>
			<ExceptionPage />
		</RequestProvider>
	);
}
