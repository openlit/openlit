"use client";

import { useCallback, useEffect } from "react";
import {
	LineChart,
	Line,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
} from "recharts";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useRootStore } from "@/store";
import { getFilterDetails } from "@/selectors/filter";
import { getPingStatus } from "@/selectors/database-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { COLORS } from "../../../../../styles/colors";
import IntermediateState from "@/components/(playground)/intermediate-state";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import getMessage from "@/constants/messages";

export default function CostsPerTime() {
	const m = getMessage();
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();

	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify(getFilterParamsForDashboard(filter)),
			requestType: "POST",
			url: "/api/metrics/llm/cost/time",
			responseDataKey: "data",
		});
	}, [filter, fireRequest]);

	useEffect(() => {
		if (
			filter.timeLimit.start &&
			filter.timeLimit.end &&
			pingStatus === "success"
		) {
			fetchData();
		}
	}, [filter, fetchData, pingStatus]);

	const chartData = ((data as { request_time?: string; cost?: number }[]) || []).map(
		(row) => ({
			request_time: row.request_time,
			cost: Number(row.cost) || 0,
		})
	);

	const isLoadingData = isLoading || !isFetched || pingStatus === "pending";

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium text-stone-950 dark:text-stone-100">
					{m.COSTS_CHART_OVER_TIME}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<ResponsiveContainer className="h-40" width="100%" height={160}>
					{isLoadingData ? (
						<IntermediateState type="loading" classNames="h-40" />
					) : chartData.length === 0 ? (
						<IntermediateState type="nodata" classNames="h-40" />
					) : (
						<LineChart
							data={chartData}
							margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
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
								domain={[0, "dataMax + 0.01"]}
							/>
							<Tooltip labelClassName="dark:text-stone-700" />
							<Line
								type="monotone"
								dataKey="cost"
								stroke={`${COLORS.primary}`}
								activeDot={{ r: 4 }}
							/>
						</LineChart>
					)}
				</ResponsiveContainer>
			</CardContent>
		</Card>
	);
}
