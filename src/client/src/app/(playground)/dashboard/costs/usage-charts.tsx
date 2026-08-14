"use client";

import PieChartCard from "@/components/(playground)/pie-chart-card";
import getMessage from "@/constants/messages";

export default function CostsUsageCharts() {
	const m = getMessage();

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
			<PieChartCard
				categoryKey="cost"
				heading={m.COSTS_CHART_BY_ENVIRONMENT}
				indexKey="environment"
				url="/api/metrics/llm/cost/environment"
			/>
			<PieChartCard
				categoryKey="cost"
				heading={m.COSTS_CHART_BY_APPLICATION}
				indexKey="applicationName"
				url="/api/metrics/llm/cost/application"
			/>
		</div>
	);
}
