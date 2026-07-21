import { dataCollector, MetricParams } from "@/lib/platform/common";
import { getFilterPreviousParams } from "@/helpers/server/platform";
import {
	OPENLIT_CHAT_CONVERSATION_TABLE,
	OPENLIT_OTTER_RUNS_TABLE,
	OPENLIT_TRACE_ANALYSIS_TABLE,
} from "@/lib/platform/chat/table-details";
import Sanitizer from "@/utils/sanitizer";

function timeWhere(params: MetricParams) {
	const start = Sanitizer.sanitizeValue(String(params.timeLimit.start));
	const end = Sanitizer.sanitizeValue(String(params.timeLimit.end));
	return `
		created_at >= parseDateTimeBestEffort('${start}')
		AND created_at <= parseDateTimeBestEffort('${end}')
	`;
}

async function sumPeriod(params: MetricParams): Promise<number> {
	const where = timeWhere(params);
	const query = `
		SELECT
			CAST((
				(SELECT sum(toFloat64OrZero(total_cost)) FROM ${OPENLIT_CHAT_CONVERSATION_TABLE}
					WHERE conversation_type = 'chat' AND ${where})
				+
				(SELECT sum(toFloat64OrZero(cost)) FROM ${OPENLIT_TRACE_ANALYSIS_TABLE}
					WHERE analysis_type IN ('trace_analysis', 'span_analysis') AND ${where})
				+
				(SELECT sum(toFloat64OrZero(cost)) FROM ${OPENLIT_OTTER_RUNS_TABLE}
					WHERE run_type IN ('prompt_improvement') AND ${where})
			) AS FLOAT) AS total_cost
	`;

	const { data, err } = await dataCollector({ query });
	if (err) return 0;
	const row = Array.isArray(data) ? data[0] : undefined;
	return Number(row?.total_cost) || 0;
}

/**
 * Otter / platform AI spend: chat conversations + trace/span analysis +
 * prompt improvement runs. These live in product tables, not otel_traces.
 */
export async function getOtterTotalCost(params: MetricParams) {
	const previous = getFilterPreviousParams(params);
	const [total, previousTotal] = await Promise.all([
		sumPeriod(params),
		sumPeriod(previous),
	]);

	return {
		data: [
			{
				total_cost: total,
				previous_total_cost: previousTotal,
			},
		],
	};
}
