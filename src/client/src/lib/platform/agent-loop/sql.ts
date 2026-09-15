import { AGENT_LOOP_THRESHOLD } from "./classify";

const CONVERSATION_SPAN = "gen_ai.conversation.id";
const CONVERSATION_RESOURCE = "gen_ai.conversation.id";
const SESSION_SPAN = "coding_agent.session.id";
const SESSION_RESOURCE = "coding_agent.session.id";
const TOOL_NAME_KEYS = ["gen_ai.tool.name", "gen_ai.tool.call.name"];
const TOOL_ARGS_KEYS = [
	"gen_ai.tool.args",
	"gen_ai.tool.call.arguments",
	"gen_ai.tool.arguments",
];
const COST_KEY = "gen_ai.usage.cost";
const TOTAL_TOKENS_KEY = "gen_ai.usage.total_tokens";
const INPUT_TOKENS_KEY = "gen_ai.usage.input_tokens";
const OUTPUT_TOKENS_KEY = "gen_ai.usage.output_tokens";

function firstNonEmptySql(keys: string[], map = "SpanAttributes"): string {
	return keys.reduceRight(
		(next, key) =>
			`if(notEmpty(${map}['${key}']), ${map}['${key}'], ${next})`,
		`''`
	);
}

export const TOOL_NAME_SQL = `trim(BOTH ' ' FROM ${firstNonEmptySql(TOOL_NAME_KEYS)})`;

export const IS_TOOL_SPAN_SQL = `notEmpty(${TOOL_NAME_SQL})`;

const RAW_ARGS_SQL = firstNonEmptySql(TOOL_ARGS_KEYS);

export const ARGS_FINGERPRINT_SQL = `replaceRegexpAll(trim(BOTH ' ' FROM ${RAW_ARGS_SQL}), '\\\\s+', ' ')`;

const CONVERSATION_SQL = `coalesce(nullIf(SpanAttributes['${CONVERSATION_SPAN}'], ''), nullIf(ResourceAttributes['${CONVERSATION_RESOURCE}'], ''), '')`;
const SESSION_SQL = `coalesce(nullIf(SpanAttributes['${SESSION_SPAN}'], ''), nullIf(ResourceAttributes['${SESSION_RESOURCE}'], ''), nullIf(SpanAttributes['session.id'], ''), nullIf(ResourceAttributes['session.id'], ''), '')`;

export const GROUP_KEY_SQL = `concat(if(notEmpty(${CONVERSATION_SQL}), 'c:', if(notEmpty(${SESSION_SQL}), 's:', 't:')), if(notEmpty(${CONVERSATION_SQL}), ${CONVERSATION_SQL}, if(notEmpty(${SESSION_SQL}), ${SESSION_SQL}, TraceId)))`;

export const SPAN_COST_SQL = `toFloat64OrZero(SpanAttributes['${COST_KEY}'])`;

export const SPAN_TOKENS_SQL = `if(toFloat64OrZero(SpanAttributes['${TOTAL_TOKENS_KEY}']) > 0, toFloat64OrZero(SpanAttributes['${TOTAL_TOKENS_KEY}']), toFloat64OrZero(SpanAttributes['${INPUT_TOKENS_KEY}']) + toFloat64OrZero(SpanAttributes['${OUTPUT_TOKENS_KEY}']))`;

export function agentLoopToolRowsSql(
	table: string,
	baseWhere: string
): string {
	const where = [baseWhere, IS_TOOL_SPAN_SQL].filter(Boolean).join(" AND ");
	return `
		SELECT
			TraceId,
			Timestamp,
			${GROUP_KEY_SQL} AS group_key,
			${TOOL_NAME_SQL} AS tool_name,
			${ARGS_FINGERPRINT_SQL} AS args_fp,
			${SPAN_COST_SQL} AS cost,
			${SPAN_TOKENS_SQL} AS tokens
		FROM ${table}
		WHERE ${where}
	`;
}

export function agentLoopGroupsSql(
	table: string,
	baseWhere: string,
	threshold: number = AGENT_LOOP_THRESHOLD
): string {
	return `
		SELECT
			group_key,
			tool_name,
			args_fp,
			count() AS repeat_count,
			greatest(sum(tokens) - argMin(tokens, Timestamp), 0) AS wasted_tokens,
			greatest(sum(cost) - argMin(cost, Timestamp), 0) AS wasted_cost
		FROM (${agentLoopToolRowsSql(table, baseWhere)})
		GROUP BY group_key, tool_name, args_fp
		HAVING count() >= ${threshold} AND notEmpty(args_fp)
	`;
}

/** Traces that participate in a stuck-tool loop in this window. */
export function agentLoopWhereSql(
	table: string,
	baseWhere: string,
	threshold: number = AGENT_LOOP_THRESHOLD
): string {
	return `TraceId IN (
		SELECT DISTINCT TraceId
		FROM (${agentLoopToolRowsSql(table, baseWhere)}) AS tool_rows
		INNER JOIN (${agentLoopGroupsSql(table, baseWhere, threshold)}) AS loops
			ON tool_rows.group_key = loops.group_key
			AND tool_rows.tool_name = loops.tool_name
			AND tool_rows.args_fp = loops.args_fp
	)`;
}

export function agentLoopStatsSql(
	table: string,
	baseWhere: string,
	threshold: number = AGENT_LOOP_THRESHOLD
): string {
	return `
		SELECT
			uniqExact(TraceId) AS tool_traces,
			uniqExactIf(TraceId, (group_key, tool_name, args_fp) IN (
				SELECT group_key, tool_name, args_fp
				FROM (${agentLoopGroupsSql(table, baseWhere, threshold)})
			)) AS loops
		FROM (${agentLoopToolRowsSql(table, baseWhere)})
	`;
}

export function agentLoopHitsByTraceSql(
	table: string,
	baseWhere: string,
	traceIds: string[],
	threshold: number = AGENT_LOOP_THRESHOLD
): string {
	const idList = traceIds.map((id) => `'${id.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`).join(", ");
	return `
		SELECT
			TraceId,
			argMax(tool_name, repeat_count) AS toolName,
			max(repeat_count) AS count,
			argMax(wasted_tokens, repeat_count) AS wastedTokens,
			argMax(wasted_cost, repeat_count) AS wastedCost
		FROM (
			SELECT
				tool_rows.TraceId AS TraceId,
				loops.tool_name AS tool_name,
				loops.repeat_count AS repeat_count,
				loops.wasted_tokens AS wasted_tokens,
				loops.wasted_cost AS wasted_cost
			FROM (${agentLoopToolRowsSql(table, baseWhere)}) AS tool_rows
			INNER JOIN (${agentLoopGroupsSql(table, baseWhere, threshold)}) AS loops
				ON tool_rows.group_key = loops.group_key
				AND tool_rows.tool_name = loops.tool_name
				AND tool_rows.args_fp = loops.args_fp
			WHERE tool_rows.TraceId IN (${idList})
		)
		GROUP BY TraceId
	`;
}

export function agentLoopHitsByGroupSql(
	table: string,
	baseWhere: string,
	groupIds: string[],
	threshold: number = AGENT_LOOP_THRESHOLD
): string {
	const keys = groupIds.flatMap((id) => {
		const safe = id.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
		return [`'c:${safe}'`, `'s:${safe}'`];
	});
	if (!keys.length) return "SELECT '' AS groupId, '' AS toolName, 0 AS count, 0 AS wastedTokens, 0 AS wastedCost WHERE 0";
	return `
		SELECT
			substring(group_key, 3) AS groupId,
			argMax(tool_name, repeat_count) AS toolName,
			max(repeat_count) AS count,
			argMax(wasted_tokens, repeat_count) AS wastedTokens,
			argMax(wasted_cost, repeat_count) AS wastedCost
		FROM (${agentLoopGroupsSql(table, baseWhere, threshold)})
		WHERE group_key IN (${keys.join(", ")})
		GROUP BY groupId
	`;
}
