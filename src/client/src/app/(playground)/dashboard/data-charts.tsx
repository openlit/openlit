import { memo, useCallback, useEffect } from "react";
import Card from "@/components/common/card";
import { DonutChart } from "@tremor/react";
import Legend from "@/components/common/legend";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { round } from "lodash";
import { getChartColors } from "@/constants/chart-colors";
import { useRootStore } from "@/store";
import { getFilterDetails } from "@/selectors/filter";

const valueFormatter = (number: number) => `${round(number, 7)}`;

type CustomTooltipTypeDonut = {
	payload: any;
	active: boolean | undefined;
	label: any;
};

const customTooltip = (props: CustomTooltipTypeDonut) => {
	const { payload, active } = props;
	if (!active || !payload) return null;
	const categoryPayload = payload?.[0];
	if (!categoryPayload) return null;
	return (
		<div className="min-w-36 flex rounded-xs bg-white shadow">
			<div
				className={`flex w-1.5 flex-col bg-${categoryPayload?.color} mr-2`}
			/>
			<div className="flex flex-col justify-between">
				<p className="whitespace-nowrap font-medium">{categoryPayload.name}</p>
				<p className="whitespace-nowrap text-tertiary">
					{valueFormatter(categoryPayload.value)}
				</p>
			</div>
		</div>
	);
};

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
		const filter = useRootStore(getFilterDetails);
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

		const colors = getChartColors(updatedData?.length || 0);

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
							customTooltip={customTooltip}
							index={indexKey}
							colors={colors}
							showAnimation
							valueFormatter={valueFormatter}
						/>
						<Legend
							className="mt-3"
							categories={updatedData.map((item: any) => item[indexKey])}
							colors={colors}
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
				heading="Cost by Environment"
				indexKey="environment"
				url="/api/metrics/cost/environment"
			/>
			<PieChartCard
				categoryKey="cost"
				containerClass="rounded-lg w-full"
				heading="Cost by application"
				indexKey="applicationName"
				url="/api/metrics/cost/application"
			/>
		</div>
	);
}
