import { dataCollector, MetricParams, OTEL_TRACES_TABLE_NAME } from "@/lib/platform/common";
import { getFilterPreviousParams } from "@/helpers/server/platform";
import {
	CODING_AGENT_ATTR,
	CODING_AGENT_SPAN_SESSION,
	GEN_AI_ATTR,
} from "@/lib/platform/coding-agents/table-details";
import Sanitizer from "@/utils/sanitizer";

/**
 * Chat-thread id used for coding-agent rollups. Prefer parent when the
 * span is a subagent; otherwise use the session id. Mirrors CHAT_ID_EXPR
 * in coding-agents/queries.ts (simplified for cost aggregation).
 */
const CHAT_ID_EXPR = `
	coalesce(
		nullIf(ResourceAttributes['${CODING_AGENT_ATTR.agentParentId}'], ''),
		nullIf(SpanAttributes['${CODING_AGENT_ATTR.agentParentId}'], ''),
		nullIf(SpanAttributes['${CODING_AGENT_ATTR.sessionId}'], ''),
		nullIf(ResourceAttributes['${CODING_AGENT_ATTR.sessionId}'], ''),
		nullIf(SpanAttributes['session.id'], '')
	)
`;

const CODING_AGENT_WHERE = `
	(
		notEmpty(SpanAttributes['${CODING_AGENT_ATTR.sessionId}'])
		OR notEmpty(ResourceAttributes['${CODING_AGENT_ATTR.sessionId}'])
		OR startsWith(SpanName, 'coding_agent.')
	)
`;

function periodCostQuery(periodParams: MetricParams, joinKey: string) {
	const start = Sanitizer.sanitizeValue(String(periodParams.timeLimit.start));
	const end = Sanitizer.sanitizeValue(String(periodParams.timeLimit.end));
	const safeJoinKey = Sanitizer.sanitizeValue(joinKey);
	return `
		SELECT
			CAST(sum(ifNull(cost_usd, 0)) AS FLOAT) AS total_cost,
			'${safeJoinKey}' AS start_date
		FROM (
			SELECT
				${CHAT_ID_EXPR} AS chat_id,
				coalesce(
					nullIf(toFloat64OrZero(anyIf(
						SpanAttributes['${CODING_AGENT_ATTR.sessionCostUsd}'],
						SpanName = '${CODING_AGENT_SPAN_SESSION}'
					)), 0),
					sumOrNull(if(
						SpanName != '${CODING_AGENT_SPAN_SESSION}',
						toFloat64OrZero(SpanAttributes['${GEN_AI_ATTR.usageCost}']),
						0
					))
				) AS cost_usd
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE Timestamp >= parseDateTimeBestEffort('${start}')
				AND Timestamp <= parseDateTimeBestEffort('${end}')
				AND ${CODING_AGENT_WHERE}
				AND notEmpty(${CHAT_ID_EXPR})
			GROUP BY chat_id
		)
	`;
}

export async function getCodingAgentsTotalCost(params: MetricParams) {
	const previous = getFilterPreviousParams(params);
	const joinKey = String(params.timeLimit.start);
	const query = `
		SELECT
			CAST(current_data.total_cost AS FLOAT) AS total_cost,
			CAST(previous_day.total_cost AS FLOAT) AS previous_total_cost
		FROM (${periodCostQuery(params, joinKey)}) AS current_data
		JOIN (${periodCostQuery(previous, joinKey)}) AS previous_day
		ON current_data.start_date = previous_day.start_date
	`;

	return dataCollector({ query });
}
