import { useFilter } from "../filter-context";
import { memo, useCallback, useEffect } from "react";
import { round } from "lodash";
import Card from "@/components/common/card";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";

type StatCardProps = {
	containerClass?: string;
	dataKey: string;
	heading: string;
	textPrefix?: string;
	textSuffix?: string;
	url: string;
};

const StatCard = memo(
	({
		containerClass = "",
		dataKey,
		heading,
		textPrefix = "",
		textSuffix = "",
		url,
	}: StatCardProps) => {
		const [filter] = useFilter();
		const { data, isFetched, isLoading, fireRequest } = useFetchWrapper();

		const fetchData = useCallback(async () => {
			fireRequest({
				body: JSON.stringify({
					timeLimit: filter.timeLimit,
				}),
				requestType: "POST",
				url,
				responseDataKey: "data[0]",
			});
		}, [filter, url]);

		useEffect(() => {
			if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
		}, [filter, fetchData]);

		return (
			<Card
				containerClass={containerClass}
				heading={heading}
				isLoading={isLoading || !isFetched}
				text={`${textPrefix}${round(
					(data as Record<any, any>)?.[dataKey] || 0,
					4
				)}${textSuffix}`}
				textClass="text-primary"
			/>
		);
	}
);

StatCard.displayName = "StatCard";

function NumberStats() {
	return (
		<div className="flex mb-4">
			<StatCard
				containerClass="border-r-0 rounded-l-lg w-full"
				dataKey="total_requests"
				heading="Total requests"
				url="/api/metrics/request/total"
			/>
			<StatCard
				containerClass="border-r-0 w-full"
				dataKey="average_duration"
				heading="Avg Request Duration"
				textSuffix="s"
				url="/api/metrics/request/duration/average"
			/>
			<StatCard
				containerClass="border-r-0 w-full"
				dataKey="total_usage_cost"
				heading="Total costs"
				textPrefix="$"
				url="/api/metrics/cost/total"
			/>
			<StatCard
				containerClass="rounded-r-lg w-full"
				dataKey="average_total_tokens"
				heading="Avg tokens per request"
				url="/api/metrics/token/request/average"
			/>
			<StatCard
				containerClass="rounded-r-lg w-full"
				dataKey="average_usage_cost"
				heading="Avg cost per request"
				textPrefix="$"
				url="/api/metrics/cost/request/average"
			/>
		</div>
	);
}

export default NumberStats;
