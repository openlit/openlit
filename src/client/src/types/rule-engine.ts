export type RuleGroupOperator = "AND" | "OR";
export type RuleStatus = "ACTIVE" | "INACTIVE";
export type RuleConditionOperator =
	| "equals"
	| "not_equals"
	| "contains"
	| "not_contains"
	| "starts_with"
	| "ends_with"
	| "regex"
	| "in"
	| "not_in"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "between";
export type RuleConditionDataType = "string" | "number" | "boolean";
export type RuleEntityType = "context" | "prompt" | "dataset" | "meta_config";

export interface Rule {
	id: string;
	name: string;
	description: string;
	group_operator: RuleGroupOperator;
	status: RuleStatus;
	created_by: string;
	created_at: string;
	updated_at: string;
}

export interface RuleInput {
	id?: string;
	name: string;
	description?: string;
	group_operator?: RuleGroupOperator;
	status?: RuleStatus;
}

export interface RuleCondition {
	id: string;
	rule_id: string;
	group_id: string;
	field: string;
	operator: RuleConditionOperator;
	value: string;
	data_type: RuleConditionDataType;
	created_at: string;
}

export interface RuleConditionInput {
	field: string;
	operator: RuleConditionOperator;
	value: string;
	data_type?: RuleConditionDataType;
}

export interface RuleConditionGroup {
	id: string;
	rule_id: string;
	condition_operator: RuleGroupOperator;
	created_at: string;
	conditions?: RuleCondition[];
}

export interface RuleConditionGroupInput {
	condition_operator?: RuleGroupOperator;
	conditions: RuleConditionInput[];
}

export interface RuleEntity {
	id: string;
	rule_id: string;
	entity_type: RuleEntityType;
	entity_id: string;
	created_by: string;
	created_at: string;
}

export interface RuleEntityInput {
	rule_id: string;
	entity_type: RuleEntityType;
	entity_id: string;
}

export interface PromptEntityInputs {
	variables?: Record<string, any>;
	version?: string;
	shouldCompile?: boolean;
}

export interface EvaluateInput {
	fields: Record<string, string | number | boolean>;
	entity_type: RuleEntityType;
	include_entity_data?: boolean;
	entity_inputs?: PromptEntityInputs | Record<string, any>;
}

export interface EvaluateResult {
	matchingRuleIds: string[];
	entities: Array<{
		rule_id: string;
		entity_type: RuleEntityType;
		entity_id: string;
	}>;
	entity_data?: Record<string, any>;
}
