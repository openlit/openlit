import {
	AreaChart,
	Area,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
} from "recharts";
import { useCallback, useEffect } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import IntermediateState from "@/components/(playground)/intermediate-state";
import { getFilterParamsForDashboard } from "@/helpers/filter";

export default function GPUMetric({
	gpu_type,
	title,
}: {
	gpu_type: string;
	title: string;
}) {
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify({
				...getFilterParamsForDashboard(filter),
				gpu_type,
			}),
			requestType: "POST",
			url: "/api/metrics/gpu",
			responseDataKey: "data",
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

	const updatedDataWithType = ((data || []) as any[]) || [];

	return (
		<Card className="w-full flex flex-col h-64">
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium text-stone-950 dark:text-white">
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent className="grow">
				{isLoading || !isFetched || pingStatus === "pending" ? (
					<IntermediateState type="loading" />
				) : updatedDataWithType.length === 0 ? (
					<IntermediateState type="nodata" />
				) : (
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart
							width={500}
							height={400}
							data={updatedDataWithType}
							margin={{
								top: 10,
								right: 30,
								left: 0,
								bottom: 0,
							}}
						>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey="request_time"
								className="text-xs stroke-stone-300"
								stroke="currentColor"
							/>
							<YAxis
								className="text-xs stroke-stone-300"
								stroke="currentColor"
								domain={[0, "dataMax + 15"]}
							/>
							<Tooltip labelClassName="dark:text-stone-700" />
							<Area
								type="monotone"
								dataKey="total"
								stackId="1"
								stroke="#8884d8"
								fill="#8884d8"
							/>
						</AreaChart>
					</ResponsiveContainer>
				)}
			</CardContent>
		</Card>
	);
}
