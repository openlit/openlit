"use client";

import PieChartCard from "@/components/(playground)/pie-chart-card";
import getMessage from "@/constants/messages";

export default function CostsOptimizationCharts() {
	const m = getMessage();

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			<PieChartCard
				categoryKey="cost"
				heading={m.COSTS_CHART_BY_PROVIDER}
				indexKey="provider"
				url="/api/metrics/llm/cost/provider"
			/>
			<PieChartCard
				categoryKey="cost"
				heading={m.COSTS_CHART_BY_MODEL}
				indexKey="model"
				url="/api/metrics/llm/cost/model"
			/>
			<PieChartCard
				categoryKey="cost"
				heading={m.COSTS_CHART_OPENGROUND_BY_PROVIDER}
				indexKey="provider"
				url="/api/metrics/openground/cost/provider"
			/>
		</div>
	);
}
