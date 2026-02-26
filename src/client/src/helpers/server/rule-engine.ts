import { RuleConditionInput, RuleEntityInput, RuleEntityType, RuleInput } from "@/types/rule-engine";

const VALID_ENTITY_TYPES: RuleEntityType[] = ["context", "prompt", "dataset", "meta_config"];
const VALID_OPERATORS = [
	"equals", "not_equals", "contains", "not_contains",
	"starts_with", "ends_with", "regex", "in", "not_in",
	"gt", "gte", "lt", "lte", "between",
];
const VALID_GROUP_OPERATORS = ["AND", "OR"];
const VALID_STATUSES = ["ACTIVE", "INACTIVE"];

export function verifyRuleInput(input: Partial<RuleInput>) {
	if (!input.name || input.name.trim().length === 0) {
		return { success: false, err: "Rule name is required!" };
	}
	if (input.group_operator && !VALID_GROUP_OPERATORS.includes(input.group_operator)) {
		return { success: false, err: "group_operator must be AND or OR!" };
	}
	if (input.status && !VALID_STATUSES.includes(input.status)) {
		return { success: false, err: "status must be ACTIVE or INACTIVE!" };
	}
	return { success: true };
}

export function verifyConditionInput(input: Partial<RuleConditionInput>) {
	if (!input.field || input.field.trim().length === 0) {
		return { success: false, err: "Condition field is required!" };
	}
	if (!input.operator || !VALID_OPERATORS.includes(input.operator)) {
		return { success: false, err: "Condition operator is required and must be valid!" };
	}
	if (input.value === undefined || input.value === null || String(input.value).trim().length === 0) {
		return { success: false, err: "Condition value is required!" };
	}
	return { success: true };
}

export function verifyConditionGroupInput(input: { conditions?: RuleConditionInput[] }) {
	if (!input.conditions || !Array.isArray(input.conditions) || input.conditions.length === 0) {
		return { success: false, err: "At least one condition is required in each group!" };
	}
	for (const condition of input.conditions) {
		const result = verifyConditionInput(condition);
		if (!result.success) return result;
	}
	return { success: true };
}

export function verifyEntityInput(input: Partial<RuleEntityInput>) {
	if (!input.rule_id || input.rule_id.trim().length === 0) {
		return { success: false, err: "Rule ID is required!" };
	}
	if (!input.entity_type || !VALID_ENTITY_TYPES.includes(input.entity_type)) {
		return { success: false, err: "Invalid entity type!" };
	}
	if (!input.entity_id || input.entity_id.trim().length === 0) {
		return { success: false, err: "Entity ID is required!" };
	}
	return { success: true };
}
