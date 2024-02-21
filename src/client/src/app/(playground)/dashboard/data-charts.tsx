import { memo, useCallback, useEffect } from "react";
import { useFilter } from "../filter-context";
import Card from "@/components/common/card";
import { DonutChart } from "@tremor/react";
import Legend from "@/components/common/legend";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";

const COLORS = ["blue-900", "blue-700", "blue-500", "blue-300", "blue-100"];

type PieChartCardProps = {
	categoryKey: string;
	containerClass?: string;
	heading: string;
	indexKey: string;
	url: string;
};

const PieChartCard = memo(
	({
		categoryKey,
		containerClass = "",
		heading,
		indexKey,
		url,
	}: PieChartCardProps) => {
		const [filter] = useFilter();
		const { data, fireRequest, isFetched, isLoading } = useFetchWrapper();

		const fetchData = useCallback(async () => {
			fireRequest({
				body: JSON.stringify({
					timeLimit: filter.timeLimit,
				}),
				requestType: "POST",
				url,
				responseDataKey: "data",
			});
		}, [filter, url]);

		useEffect(() => {
			if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
		}, [filter, fetchData]);

		const updatedData = data as any[];

		return (
			<Card containerClass={containerClass} heading={heading}>
				{isLoading || !isFetched ? (
					<div className="animate-pulse h-9 w-1/3 bg-secondary/[0.9] rounded"></div>
				) : updatedData?.length ? (
					<>
						<DonutChart
							className="mt-6"
							data={updatedData}
							category={categoryKey}
							index={indexKey}
							colors={COLORS.slice(0, updatedData.length)}
						/>
						<Legend
							className="mt-3 flex-col"
							categories={updatedData.map((item: any) => item[indexKey])}
							colors={COLORS.slice(0, updatedData.length)}
						/>
					</>
				) : (
					<div className="text-sm text-tertiary/[0.5]">No data</div>
				)}
			</Card>
		);
	}
);

PieChartCard.displayName = "PieChartCard";

export default function DataCharts() {
	return (
		<div className="flex w-full gap-6">
			<PieChartCard
				categoryKey="count"
				containerClass="rounded-lg w-full"
				heading="Generation by categories"
				indexKey="category"
				url="/api/metrics/category"
			/>
			<PieChartCard
				categoryKey="count"
				containerClass="rounded-lg w-full"
				heading="Generation by provider"
				indexKey="provider"
				url="/api/metrics/endpoint"
			/>
			<PieChartCard
				categoryKey="cost"
				containerClass="rounded-lg w-full"
				heading="Cost by application"
				indexKey="applicationname"
				url="/api/metrics/cost/application"
			/>
			<PieChartCard
				categoryKey="cost"
				containerClass="rounded-lg w-full"
				heading="Cost by Environment"
				indexKey="environment"
				url="/api/metrics/cost/environment"
			/>
		</div>
	);
}
