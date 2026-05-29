/**
 * Fetches evaluation context from the rule engine by evaluating rules
 * against trace attributes. Used by both manual and auto evaluations.
 */
import { TraceRow } from "@/types/trace";
import { evaluateRules } from "@/lib/platform/rule-engine/evaluate";

/**
 * Maps trace attribute paths to rule engine field names.
 * Aligns with FIELD_COLUMN_MAP in api/rule-engine/field-values/route.ts
 * so rules can match on the same fields used in the condition builder.
 */
const TRACE_TO_RULE_FIELDS: Array<{
	field: string;
	getValue: (trace: TraceRow) => string | number | boolean | null | undefined;
}> = [
	{ field: "ServiceName", getValue: (t) => t.ServiceName },
	{ field: "SpanName", getValue: (t) => t.SpanName },
	{ field: "SpanKind", getValue: (t) => t.SpanKind },
	{ field: "StatusCode", getValue: (t) => t.StatusCode },
	{
		field: "deployment.environment",
		getValue: (t) =>
			(t as any).ResourceAttributes?.["deployment.environment"] ??
			(t as any).SpanAttributes?.["deployment.environment"],
	},
	{
		field: "service.name",
		getValue: (t) => (t as any).ResourceAttributes?.["service.name"],
	},
	{
		field: "gen_ai.system",
		getValue: (t) => (t as any).SpanAttributes?.["gen_ai.system"],
	},
	{
		field: "gen_ai.request.model",
		getValue: (t) => (t as any).SpanAttributes?.["gen_ai.request.model"],
	},
];

/**
 * Extracts rule engine input fields from a trace.
 * Only includes non-empty primitive values.
 */
export function extractRuleEngineFieldsFromTrace(
	trace: TraceRow
): Record<string, string | number | boolean> {
	const fields: Record<string, string | number | boolean> = {};
	for (const { field, getValue } of TRACE_TO_RULE_FIELDS) {
		const v = getValue(trace);
		if (v === null || v === undefined || v === "") continue;
		if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
			fields[field] = v;
		} else {
			fields[field] = String(v);
		}
	}
	return fields;
}

export interface RuleEngineContextResult {
	contextContents: string[];
	matchingRuleIds: string[];
	contextEntityIds?: string[];
}

/**
 * Fetches context content from the rule engine for a given trace.
 * Evaluates rules using trace attributes and returns concatenated context
 * content from matching context entities.
 *
 * @returns Context contents and matching rule IDs (for display and storage)
 */
export async function getContextFromRuleEngineForTrace(
	trace: TraceRow,
	databaseConfigId?: string
): Promise<RuleEngineContextResult> {
	const fields = extractRuleEngineFieldsFromTrace(trace);
	if (Object.keys(fields).length === 0) {
		return { contextContents: [], matchingRuleIds: [], contextEntityIds: [] };
	}

	try {
		const result = await evaluateRules(
			{
				fields,
				entity_type: "context",
				include_entity_data: true,
			},
			databaseConfigId
		);

		if (!result.entity_data) {
			return {
				contextContents: [],
				matchingRuleIds: result.matchingRuleIds || [],
				contextEntityIds: [],
			};
		}

		const contents: string[] = [];
		const contextEntityIds: string[] = [];
		for (const [key, entityData] of Object.entries(result.entity_data)) {
			if (entityData?.content) {
				contents.push(String(entityData.content));
				const match = key.match(/^context:(.+)$/);
				if (match) contextEntityIds.push(match[1]);
			}
		}
		return {
			contextContents: contents,
			matchingRuleIds: result.matchingRuleIds || [],
			contextEntityIds,
		};
	} catch {
		return { contextContents: [], matchingRuleIds: [], contextEntityIds: [] };
	}
}

export interface RuleWithPriority {
	ruleId: string;
	priority: number;
}

/**
 * Fetches context from rules in priority order. Used when evaluation types
 * config specifies which rules to use for auto evaluation.
 */
export async function getContextFromRulesWithPriority(
	trace: TraceRow,
	rulesWithPriority: RuleWithPriority[],
	databaseConfigId?: string
): Promise<RuleEngineContextResult> {
	const result = await getContextFromRuleEngineForTrace(trace, databaseConfigId);
	if (rulesWithPriority.length === 0) return result;

	const priorityByRule = new Map(
		rulesWithPriority.map((r) => [r.ruleId, r.priority])
	);
	const matchingRules = result.matchingRuleIds.filter((id) =>
		priorityByRule.has(id)
	);
	if (matchingRules.length === 0) return result;

	// Sort by priority descending (higher = first)
	matchingRules.sort(
		(a, b) => (priorityByRule.get(b) ?? 0) - (priorityByRule.get(a) ?? 0)
	);

	// Re-fetch with entity data to get ordered context
	const fields = extractRuleEngineFieldsFromTrace(trace);
	if (Object.keys(fields).length === 0) {
		return {
			contextContents: [],
			matchingRuleIds: matchingRules,
			contextEntityIds: [],
		};
	}

	try {
		const evalResult = await evaluateRules(
			{ fields, entity_type: "context", include_entity_data: true },
			databaseConfigId
		);
		if (!evalResult.entity_data || !evalResult.entities) {
			return {
				contextContents: [],
				matchingRuleIds: matchingRules,
				contextEntityIds: [],
			};
		}

		const contents: string[] = [];
		const contextEntityIds: string[] = [];
		for (const ruleId of matchingRules) {
			const ruleEntities = evalResult.entities.filter(
				(e: any) => e.rule_id === ruleId && e.entity_type === "context"
			);
			for (const ent of ruleEntities) {
				const key = `context:${ent.entity_id}`;
				const entityData = evalResult.entity_data[key];
				if (entityData?.content) {
					contents.push(String(entityData.content));
					contextEntityIds.push(ent.entity_id);
				}
			}
		}
		return {
			contextContents: contents,
			matchingRuleIds: matchingRules,
			contextEntityIds,
		};
	} catch {
		return result;
	}
}
