"use client";

import StatCard from "@/components/(playground)/stat-card";
import getMessage from "@/constants/messages";
import {
	Banknote,
	Bot,
	CircleDollarSign,
	FlaskConical,
	Layers,
	MessageSquare,
	MonitorPlay,
	RadioTower,
} from "lucide-react";

export default function CostsNumberStats() {
	const m = getMessage();
	const summaryUrl = "/api/metrics/cost/summary";

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
			<StatCard
				dataKey="total_platform_cost"
				heading={m.COSTS_STAT_TOTAL_PLATFORM}
				icon={CircleDollarSign}
				url={summaryUrl}
				textPrefix="$"
				roundTo={7}
			/>
			<StatCard
				dataKey="llm_cost"
				heading={m.COSTS_STAT_LLM}
				icon={Layers}
				url={summaryUrl}
				textPrefix="$"
				roundTo={7}
			/>
			<StatCard
				dataKey="coding_agents_cost"
				heading={m.COSTS_STAT_CODING_AGENTS}
				icon={Bot}
				url={summaryUrl}
				textPrefix="$"
				roundTo={7}
			/>
			<StatCard
				dataKey="otter_cost"
				heading={m.COSTS_STAT_OTTER}
				icon={MessageSquare}
				url={summaryUrl}
				textPrefix="$"
				roundTo={7}
			/>
			<StatCard
				dataKey="evaluations_cost"
				heading={m.COSTS_STAT_EVALUATIONS}
				icon={FlaskConical}
				url={summaryUrl}
				textPrefix="$"
				roundTo={7}
			/>
			<StatCard
				dataKey="openground_cost"
				heading={m.COSTS_STAT_OPENGROUND}
				icon={MonitorPlay}
				url={summaryUrl}
				textPrefix="$"
				roundTo={7}
			/>
			<StatCard
				dataKey="total_requests"
				extraParams={{
					operationType: "llm",
				}}
				heading={m.COSTS_STAT_TOTAL_REQUESTS}
				icon={RadioTower}
				url="/api/metrics/request/total"
				roundTo={0}
			/>
			<StatCard
				dataKey="average_usage_cost"
				heading={m.COSTS_STAT_AVG_REQUEST}
				icon={Banknote}
				url="/api/metrics/llm/cost/request/average"
				textPrefix="$"
				roundTo={7}
			/>
		</div>
	);
}
