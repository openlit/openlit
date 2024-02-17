import { useCallback, useEffect } from "react";
import { useFilter } from "../filter-context";
import Card from "@/components/common/card";
import { LineChart } from "@tremor/react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";

export default function RequestsPerTime() {
	const [filter] = useFilter();
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
			}),
			requestType: "POST",
			url: "/api/metrics/request/time",
			responseDataKey: "data",
		});
	}, [filter]);

	useEffect(() => {
		if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
	}, [filter, fetchData]);

	return (
		<Card heading="Requests per time" containerClass="rounded-lg">
			<LineChart
				className="mt-6"
				connectNulls
				data={isLoading || !isFetched ? [] : (data as any[]) || []}
				index="request_time"
				categories={["total"]}
				colors={["emerald"]}
				yAxisWidth={40}
				noDataText={
					isLoading || !isFetched ? "Loading ..." : "No data available"
				}
			/>
		</Card>
	);
}
