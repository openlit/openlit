import { memo, useEffect, useState } from "react";
import { useFilter } from "../filter-context";
import Card from "@/components/common/card";
import { DonutChart } from "@tremor/react";
import { getData } from "@/utils/api";
import Legend from "@/components/common/legend";

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
		const [data, setData] = useState<any[]>([]);

		const fetchData = async () => {
			const res = await getData({
				body: JSON.stringify({
					timeLimit: filter.timeLimit,
				}),
				method: "POST",
				url,
			});

			setData(res?.data || []);
		};

		useEffect(() => {
			if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
		}, [filter]);

		return (
			<Card containerClass={containerClass} heading={heading}>
				<DonutChart
					className="mt-6"
					data={data}
					category={categoryKey}
					index={indexKey}
					colors={COLORS.slice(0, data.length)}
				/>
				<Legend
					className="mt-3 flex-col"
					categories={data.map((item: any) => item[indexKey])}
					colors={COLORS.slice(0, data.length)}
				/>
			</Card>
		);
	}
);

const ModelsCategories = () => {
	return (
		<div className="flex w-full gap-6">
			<PieChartCard
				categoryKey="model_count"
				containerClass="rounded-lg w-full"
				heading="Top Models"
				indexKey="model"
				url="/api/metrics/model/top"
			/>
			<PieChartCard
				categoryKey="count"
				containerClass="rounded-lg w-full"
				heading="Generation by categories"
				indexKey="category"
				url="/api/metrics/category"
			/>
		</div>
	);
};

export default ModelsCategories;
