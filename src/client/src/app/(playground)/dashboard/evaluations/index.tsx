"use client";

import EvaluationNumberStats from "./number-stats";
import EvaluationMetricsPerTime from "./metrics-per-time";

/**
 * Evaluations analytics dashboard — composed like LLMDashboard on the
 * agents detail Dashboard tab (StatCards + time-series chart).
 */
export default function EvaluationsDashboard() {
	return (
		<>
			<EvaluationNumberStats />
			<div className="flex flex-col gap-4">
				<EvaluationMetricsPerTime />
			</div>
		</>
	);
}
