"use client";

import { useCallback, useEffect, useState } from "react";
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
import type { EvaluationAnalyticsResponse } from "@/types/evaluation";

type ChartMode = "passRate" | "executions";

/**
 * Pass rate / executions over time — same Card + Recharts pattern as
 * dashboard/llm/requests-per-time.tsx used on the agents Dashboard tab.
 */
export default function EvaluationMetricsPerTime() {
	const m = getMessage();
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const [chartMode, setChartMode] = useState<ChartMode>("passRate");
	const { data, fireRequest, isFetched, isLoading } =
		useFetchWrapper<EvaluationAnalyticsResponse>();

	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify(getFilterParamsForDashboard(filter)),
			requestType: "POST",
			url: "/api/evaluation/analytics",
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

	const chartData = ((data?.timeseries as any[]) || []).map((row) => ({
		request_time: row.timestamp,
		passRate: Number(row.passRate) || 0,
		executions: Number(row.executions) || 0,
	}));

	const isLoadingData = isLoading || !isFetched || pingStatus === "pending";

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setChartMode("passRate")}
						className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
							chartMode === "passRate"
								? "border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
								: "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
						}`}
					>
						{m.EVALUATION_CHART_PASS_RATE}
					</button>
					<button
						type="button"
						onClick={() => setChartMode("executions")}
						className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
							chartMode === "executions"
								? "border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
								: "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
						}`}
					>
						{m.EVALUATION_CHART_EXECUTIONS}
					</button>
				</div>
				<CardTitle className="text-sm font-medium text-stone-950 dark:text-stone-100">
					{chartMode === "passRate"
						? m.EVALUATION_CHART_PASS_RATE
						: m.EVALUATION_CHART_EXECUTIONS}
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
								domain={
									chartMode === "passRate" ? [0, 100] : [0, "dataMax + 15"]
								}
							/>
							<Tooltip labelClassName="dark:text-stone-700" />
							<Line
								type="monotone"
								dataKey={chartMode === "passRate" ? "passRate" : "executions"}
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
