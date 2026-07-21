import { MetricParams } from "@/lib/platform/common";
import { getTotalCost } from "@/lib/platform/llm/cost";
import { getEvaluationAnalytics } from "@/lib/platform/evaluation/analytics";
import { getOpengroundTotalCost } from "@/lib/platform/openground/cost-analytics";
import { getCodingAgentsTotalCost } from "@/lib/platform/coding-agents/cost";
import { getOtterTotalCost } from "@/lib/platform/chat/cost";

function firstRow(data: unknown): Record<string, number> {
	if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
		return data[0] as Record<string, number>;
	}
	return {};
}

/**
 * Company-wide AI cost rollup. Buckets are mutually exclusive:
 * - llm: instrumented app LLM traffic (otel_traces, coding agents excluded)
 * - coding_agents: coding-agent session rollups (otel_traces)
 * - otter: Otter chat + analysis + prompt improvement (product tables)
 * - evaluations: judge LLM spend (openlit_evaluation)
 * - openground: comparison run provider costs
 */
export async function getCostSummary(params: MetricParams) {
	const [llmRes, codingRes, otterRes, evaluationsRes, opengroundRes] =
		await Promise.all([
			getTotalCost(params),
			getCodingAgentsTotalCost(params),
			getOtterTotalCost(params),
			getEvaluationAnalytics(params),
			getOpengroundTotalCost(params),
		]);

	const llmRow = firstRow(llmRes.data);
	const codingRow = firstRow(codingRes.data);
	const otterRow = firstRow(otterRes.data);
	const evaluationsRow = firstRow(evaluationsRes.data);
	const opengroundRow = firstRow(opengroundRes.data);

	const llm = Number(llmRow.total_usage_cost) || 0;
	const previousLlm = Number(llmRow.previous_total_usage_cost) || 0;
	const codingAgents = Number(codingRow.total_cost) || 0;
	const previousCodingAgents = Number(codingRow.previous_total_cost) || 0;
	const otter = Number(otterRow.total_cost) || 0;
	const previousOtter = Number(otterRow.previous_total_cost) || 0;
	const evaluations = Number(evaluationsRow.total_cost) || 0;
	const previousEvaluations = Number(evaluationsRow.previous_total_cost) || 0;
	const openground = Number(opengroundRow.total_cost) || 0;
	const previousOpenground = Number(opengroundRow.previous_total_cost) || 0;

	// Never surface partial bucket errors on the top-level payload.
	// useFetchWrapper treats any `err` as a total failure and clears data,
	// which zeroed every Costs summary StatCard when one bucket query failed.
	return {
		data: [
			{
				total_platform_cost:
					llm + codingAgents + otter + evaluations + openground,
				previous_total_platform_cost:
					previousLlm +
					previousCodingAgents +
					previousOtter +
					previousEvaluations +
					previousOpenground,
				llm_cost: llm,
				previous_llm_cost: previousLlm,
				coding_agents_cost: codingAgents,
				previous_coding_agents_cost: previousCodingAgents,
				otter_cost: otter,
				previous_otter_cost: previousOtter,
				evaluations_cost: evaluations,
				previous_evaluations_cost: previousEvaluations,
				openground_cost: openground,
				previous_openground_cost: previousOpenground,
			},
		],
	};
}
