import { getData } from "@/utils/api";
import { useFilter } from "../filter-context";
import { memo, useCallback, useEffect, useState } from "react";
import { round } from "lodash";
import Card from "@/components/common/card";

type StatCardProps = {
	containerClass?: string;
	dataKey: string;
	heading: string;
	url: string;
};

const StatCard = memo(
	({ containerClass = "", dataKey, heading, url }: StatCardProps) => {
		const [filter] = useFilter();
		const [data, setData] = useState<Record<any, any>>();

		const fetchData = useCallback(async () => {
			const res = await getData({
				body: JSON.stringify({
					timeLimit: filter.timeLimit,
				}),
				method: "POST",
				url,
			});

			setData(res?.data?.[0] || {});
		}, [filter, url]);

		useEffect(() => {
			if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
		}, [filter, fetchData]);

		return (
			<Card
				containerClass={containerClass}
				heading={heading}
				text={`${round(data?.[dataKey] || 0, 2)}`}
			/>
		);
	}
);

StatCard.displayName = "StatCard";

function NumberStats (){
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
				url="/api/metrics/request/duration/average"
			/>
			<StatCard
				containerClass="border-r-0 w-full"
				dataKey="total_usage_cost"
				heading="Total costs"
				url="/api/metrics/cost/total"
			/>
			<StatCard
				containerClass="rounded-r-lg w-full"
				dataKey="average_usage_cost"
				heading="Average cost per request"
				url="/api/metrics/cost/request/average"
			/>
		</div>
	);
};

export default NumberStats;
