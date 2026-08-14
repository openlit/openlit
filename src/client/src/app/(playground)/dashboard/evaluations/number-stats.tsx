"use client";

import StatCard from "@/components/(playground)/stat-card";
import getMessage from "@/constants/messages";
import {
	Activity,
	BadgeCheck,
	Banknote,
	CheckCircle2,
	Layers,
	ListChecks,
	XCircle,
	Zap,
} from "lucide-react";

/**
 * KPI row for Evaluations analytics — same StatCard components used by
 * the LLM dashboard on the agents detail page. Eight cards for a full grid.
 */
export default function EvaluationNumberStats() {
	const m = getMessage();
	const url = "/api/evaluation/analytics";

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<StatCard
				dataKey="evaluations"
				heading={m.EVALUATION_STAT_EVALUATIONS}
				icon={Layers}
				url={url}
				roundTo={0}
			/>
			<StatCard
				dataKey="active"
				heading={m.EVALUATION_STAT_ACTIVE}
				icon={BadgeCheck}
				url={url}
				roundTo={0}
			/>
			<StatCard
				dataKey="traces_evaluated"
				heading={m.EVALUATION_STAT_TRACES_EVALUATED}
				icon={ListChecks}
				url={url}
				roundTo={0}
			/>
			<StatCard
				dataKey="executions"
				heading={m.EVALUATION_STAT_EXECUTIONS}
				icon={Activity}
				url={url}
				roundTo={0}
			/>
			<StatCard
				dataKey="auto_executions"
				heading={m.EVALUATION_STAT_AUTO_EXECUTIONS}
				icon={Zap}
				url={url}
				roundTo={0}
			/>
			<StatCard
				dataKey="total_cost"
				heading={m.EVALUATION_STAT_TOTAL_COST}
				icon={Banknote}
				url={url}
				textPrefix="$"
				roundTo={4}
			/>
			<StatCard
				dataKey="avg_pass_rate"
				heading={m.EVALUATION_STAT_AVG_PASS_RATE}
				icon={CheckCircle2}
				url={url}
				textSuffix="%"
				roundTo={0}
			/>
			<StatCard
				dataKey="failed_scores"
				heading={m.EVALUATION_STAT_FAILED_SCORES}
				icon={XCircle}
				url={url}
				roundTo={0}
			/>
		</div>
	);
}
