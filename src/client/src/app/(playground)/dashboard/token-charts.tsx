import StatCard from "@/components/(playground)/stat-card";
import {
	AreaChart,
	Area,
	Bar,
	BarChart,
	Cell,
	XAxis,
	YAxis,
	LabelList,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
} from "recharts";
import { useCallback, useEffect, useState } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getChartColors } from "@/constants/chart-colors";
import { getFilterDetails } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { getPingStatus } from "@/selectors/database-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { COLORS } from "../../../../colors";

function TopModels() {
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();

	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
			}),
			requestType: "POST",
			url: "/api/metrics/model/top",
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

	const colors = getChartColors((data as any[])?.length || 0);

	const updatedData = ((data as any[]) || []).map((item, index) => ({
		name: item.model,
		value: item.model_count,
		target: item.total,
		color: colors[index],
	}));

	return (
		<Card className="col-span-1">
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium text-tertiary dark:text-white">
					Top models
				</CardTitle>
			</CardHeader>
			<CardContent>
				<ResponsiveContainer width="100%" height="100%">
					{isLoading || !isFetched || pingStatus === "pending" ? (
						<div className="flex w-full items-center justify-center h-40">
							Loading...
						</div>
					) : (
						<BarChart
							width={500}
							height={300}
							data={updatedData}
							margin={{
								top: 5,
								right: 10,
								left: 0,
								bottom: 5,
							}}
							barSize={10}
						>
							<XAxis
								dataKey="name"
								className="stroke-stone-300"
								fontSize={10}
								stroke="currentColor"
								interval={0}
								angle={-5}
							/>
							<YAxis
								className="text-xs stroke-stone-300"
								domain={[0, "dataMax + 15"]}
								stroke="currentColor"
							/>
							<Bar dataKey="value" className="fill-primary">
								<LabelList
									dataKey="value"
									position="top"
									className="fill-stone-700 dark:fill-stone-200"
									fill="currentColor"
								/>
							</Bar>
						</BarChart>
					)}
				</ResponsiveContainer>
			</CardContent>
		</Card>
	);
}

function ModelsPerTime() {
	const [activeIndex, setActiveIndex] = useState<number>(0);
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const handleClick = (_: any, index: number) => {
		setActiveIndex(index);
	};
	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
			}),
			requestType: "POST",
			url: "/api/metrics/model/time",
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

	const activeItem = (data as any[])?.[activeIndex];

	return (
		<Card className="col-span-2">
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium text-tertiary dark:text-white">
					Models per time
				</CardTitle>
			</CardHeader>
			<CardContent>
				<ResponsiveContainer className="h-40" width="100%" height="100%">
					{isLoading || !isFetched || pingStatus === "pending" ? (
						<div className="flex w-full items-center justify-center h-40">
							Loading...
						</div>
					) : (
						<BarChart
							width={500}
							height={300}
							data={data as any[]}
							margin={{
								top: 20,
								right: 10,
								left: 0,
								bottom: 5,
							}}
						>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey="request_time"
								className="text-xs stroke-stone-300"
								stroke="currentColor"
							/>
							<YAxis
								domain={[0, "dataMax + 15"]}
								className="text-xs stroke-stone-300"
								stroke="currentColor"
							/>
							<Bar
								dataKey="total_model_count"
								fill="#8884d8"
								label={{ position: "top" }}
								onClick={handleClick}
							>
								{(data as any[]).map((_, index) => (
									<Cell
										cursor="pointer"
										fill={index === activeIndex ? COLORS.primary : "#8884d8"}
										key={`cell-${index}`}
									/>
								))}
							</Bar>
						</BarChart>
					)}
				</ResponsiveContainer>
				{isLoading || !isFetched || pingStatus === "pending" ? null : (
					<ScrollArea className="w-full whitespace-nowrap">
						<div className="flex w-max space-x-4 p-2">
							{activeItem?.models?.map((model: string, index: number) => (
								<Badge key={`${model}-${index}`}>
									{model} ( {activeItem.model_counts?.[index] || 0} )
								</Badge>
							))}
						</div>
						<ScrollBar orientation="horizontal" />
					</ScrollArea>
				)}
			</CardContent>
		</Card>
	);
}

function TokensPerTime() {
	const filter = useRootStore(getFilterDetails);
	const pingStatus = useRootStore(getPingStatus);
	const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();
	const fetchData = useCallback(async () => {
		fireRequest({
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
			}),
			requestType: "POST",
			url: "/api/metrics/token/time",
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
		<Card className="w-full flex flex-col col-span-3">
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle className="text-sm font-medium text-tertiary dark:text-white">
					Tokens usage
				</CardTitle>
			</CardHeader>
			<CardContent className="grow">
				{isLoading || !isFetched || pingStatus === "pending" ? (
					<div className="flex w-full items-center justify-center h-40">
						Loading...
					</div>
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
							<Tooltip />
							<Area
								type="monotone"
								dataKey="totaltokens"
								stackId="1"
								stroke="#8884d8"
								fill="#8884d8"
							/>
							<Area
								type="monotone"
								dataKey="prompttokens"
								stackId="1"
								stroke="#82ca9d"
								fill="#82ca9d"
							/>
							<Area
								type="monotone"
								dataKey="completiontokens"
								stackId="1"
								stroke="#ffc658"
								fill="#ffc658"
							/>
						</AreaChart>
					</ResponsiveContainer>
				)}
			</CardContent>
		</Card>
	);
}

function TokenCharts() {
	return (
		<div className="flex flex-col w-full gap-4">
			<div className="grid mb-4 w-full gap-4 grid-cols-4 md:gap-8">
				<div className="flex flex-col gap-4 md:gap-8 col-span-1">
					<StatCard
						dataKey="total_tokens"
						extraParams={{ type: "prompt" }}
						heading="Avg prompt tokens / request"
						loadingClass="h-8 w-12"
						textClass="text-2xl"
						url="/api/metrics/token/request/average"
					/>
					<StatCard
						dataKey="total_tokens"
						extraParams={{ type: "completion" }}
						heading="Avg completion tokens / request"
						loadingClass="h-8 w-12"
						textClass="text-2xl"
						url="/api/metrics/token/request/average"
					/>
				</div>
				<TokensPerTime />
			</div>
			<div className="grid gap-4 grid-cols-3 md:gap-8">
				<TopModels />
				<ModelsPerTime />
			</div>
		</div>
	);
}

export default TokenCharts;
