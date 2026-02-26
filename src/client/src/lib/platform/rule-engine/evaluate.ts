import sqlString from "sqlstring";
import { EvaluateInput, EvaluateResult } from "@/types/rule-engine";
import {
	OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME,
	OPENLIT_RULE_CONDITIONS_TABLE_NAME,
	OPENLIT_RULE_ENTITIES_TABLE_NAME,
	OPENLIT_RULES_TABLE_NAME,
} from "./table-details";
import { dataCollector } from "../common";
import { getContextById } from "../context";
import { getCompiledPromptByDbConfig } from "../prompt/compiled";

export async function evaluateRules(
	{ fields, entity_type, include_entity_data, entity_inputs }: EvaluateInput,
	databaseConfigId?: string
): Promise<EvaluateResult> {
	if (!fields || Object.keys(fields).length === 0) {
		return { matchingRuleIds: [], entities: [] };
	}

	// Build input_values CTE using UNION ALL — reliable in ClickHouse.
	// Use sqlString.escape() so backslashes, single-quotes, null bytes and all
	// other ClickHouse string injection vectors are properly handled.
	const unionRows = Object.entries(fields)
		.map(([k, v]) => {
			const ek = sqlString.escape(String(k)).slice(1, -1);
			const ev = sqlString.escape(String(v)).slice(1, -1);
			return `SELECT '${ek}' AS field_name, '${ev}' AS field_value_str`;
		})
		.join("\n  UNION ALL\n  ");

	const query = `
WITH
input_values AS (
  ${unionRows}
),
condition_matches AS (
  SELECT
    c.rule_id,
    c.group_id,
    c.id AS condition_id,
    toUInt8(multiIf(
      c.data_type = 'string' AND c.operator = 'equals',       iv.field_value_str = c.value,
      c.data_type = 'string' AND c.operator = 'not_equals',   iv.field_value_str != c.value,
      c.data_type = 'string' AND c.operator = 'contains',     position(iv.field_value_str, c.value) > 0,
      c.data_type = 'string' AND c.operator = 'not_contains', position(iv.field_value_str, c.value) = 0,
      c.data_type = 'string' AND c.operator = 'starts_with',  startsWith(iv.field_value_str, c.value),
      c.data_type = 'string' AND c.operator = 'ends_with',    endsWith(iv.field_value_str, c.value),
      c.data_type = 'string' AND c.operator = 'regex',        match(iv.field_value_str, c.value),
      c.data_type = 'string' AND c.operator = 'in',           has(splitByChar(',', c.value), iv.field_value_str),
      c.data_type = 'string' AND c.operator = 'not_in',       NOT has(splitByChar(',', c.value), iv.field_value_str),
      c.data_type = 'number' AND c.operator = 'equals',       toFloat64OrZero(iv.field_value_str) = toFloat64OrZero(c.value),
      c.data_type = 'number' AND c.operator = 'not_equals',   toFloat64OrZero(iv.field_value_str) != toFloat64OrZero(c.value),
      c.data_type = 'number' AND c.operator = 'gt',           toFloat64OrZero(iv.field_value_str) > toFloat64OrZero(c.value),
      c.data_type = 'number' AND c.operator = 'gte',          toFloat64OrZero(iv.field_value_str) >= toFloat64OrZero(c.value),
      c.data_type = 'number' AND c.operator = 'lt',           toFloat64OrZero(iv.field_value_str) < toFloat64OrZero(c.value),
      c.data_type = 'number' AND c.operator = 'lte',          toFloat64OrZero(iv.field_value_str) <= toFloat64OrZero(c.value),
      c.data_type = 'number' AND c.operator = 'between',
        toFloat64OrZero(iv.field_value_str) >= toFloat64OrZero(splitByChar(',', c.value)[1])
        AND toFloat64OrZero(iv.field_value_str) <= toFloat64OrZero(splitByChar(',', c.value)[2]),
      c.data_type = 'boolean' AND c.operator = 'equals',      iv.field_value_str = c.value,
      0
    )) AS condition_match
  FROM ${OPENLIT_RULE_CONDITIONS_TABLE_NAME} c
  INNER JOIN input_values iv ON iv.field_name = c.field
),
group_matches AS (
  SELECT
    cm.rule_id,
    cm.group_id,
    CASE
      WHEN g.condition_operator = 'AND' THEN toUInt8(COALESCE(min(cm.condition_match), 0))
      ELSE                                   toUInt8(COALESCE(max(cm.condition_match), 0))
    END AS group_match
  FROM condition_matches cm
  INNER JOIN ${OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME} g ON g.id = cm.group_id
  GROUP BY cm.rule_id, cm.group_id, g.condition_operator
),
rule_matches AS (
  SELECT
    gm.rule_id,
    CASE
      WHEN r.group_operator = 'AND' THEN toUInt8(COALESCE(min(gm.group_match), 0))
      ELSE                               toUInt8(COALESCE(max(gm.group_match), 0))
    END AS rule_match
  FROM group_matches gm
  INNER JOIN ${OPENLIT_RULES_TABLE_NAME} r ON r.id = gm.rule_id
  WHERE r.status = 'ACTIVE'
  GROUP BY gm.rule_id, r.group_operator
)
SELECT
  rm.rule_id,
  re.entity_type,
  re.entity_id
FROM rule_matches rm
INNER JOIN ${OPENLIT_RULE_ENTITIES_TABLE_NAME} re ON re.rule_id = rm.rule_id
WHERE rm.rule_match = 1
  AND re.entity_type = '${entity_type}'
ORDER BY rm.rule_id, re.entity_type;
  `;

	const { err, data } = await dataCollector({ query }, "query", databaseConfigId);

	if (err) {
		throw new Error(
			typeof err?.toString === "function" ? err.toString() : String(err)
		);
	}

	const rows = (data as any[]) || [];

	const matchingRuleIds = Array.from(new Set(rows.map((r: any) => r.rule_id))) as string[];
	const entities = rows.map((r: any) => ({
		rule_id: r.rule_id,
		entity_type: r.entity_type,
		entity_id: r.entity_id,
	}));

	if (!include_entity_data) {
		return { matchingRuleIds, entities };
	}

	// Fetch full entity data for each unique entity
	const entity_data: Record<string, any> = {};
	const seen = new Set<string>();

	// Cast to typed prompt inputs when entity_type is "prompt"
	const promptInputs = (entity_inputs || {}) as {
		variables?: Record<string, any>;
		version?: string;
		shouldCompile?: boolean;
	};

	await Promise.all(
		entities.map(async (entity) => {
			const key = `${entity.entity_type}:${entity.entity_id}`;
			if (seen.has(key)) return;
			seen.add(key);

			try {
				if (entity.entity_type === "context") {
					const { data: ctxData } = await getContextById(entity.entity_id, databaseConfigId);
					entity_data[key] = (ctxData as any[])?.[0] || null;
				} else if (entity.entity_type === "prompt") {
					entity_data[key] = await getCompiledPromptByDbConfig({
						id: entity.entity_id,
						version: promptInputs.version,
						variables: promptInputs.variables,
						shouldCompile: promptInputs.shouldCompile,
						databaseConfigId,
					});
				}
			} catch {
				entity_data[key] = null;
			}
		})
	);

	return { matchingRuleIds, entities, entity_data };
}
