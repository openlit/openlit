import { useCallback, useEffect } from "react";
import { useFilter } from "../filter-context";
import Card from "@/components/common/card";
import { LineChart } from "@tremor/react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import toast from "react-hot-toast";
import { getChartColors } from "@/constants/chart-colors";

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
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "dashboard-page",
				});
			},
		});
	}, [filter]);

	useEffect(() => {
		if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
	}, [filter, fetchData]);

	const colors = getChartColors(1);

	return (
		<Card
			containerClass="rounded-lg w-full h-full h-64"
			heading="Requests per time"
		>
			<LineChart
				className="h-40"
				connectNulls
				data={isLoading || !isFetched ? [] : (data as any[]) || []}
				index="request_time"
				categories={["total"]}
				colors={colors}
				yAxisWidth={40}
				noDataText={
					isLoading || !isFetched ? "Loading ..." : "No data available"
				}
				showAnimation
			/>
		</Card>
	);
}
