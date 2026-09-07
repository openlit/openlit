export type GovernanceSeverity = "info" | "minor" | "major" | "critical";

export type GovernanceFindingCategory =
	| "span_error"
	| "generation_health"
	| "agent_loop"
	| "evaluation"
	| "coding_agent"
	| "harness"
	| "policy"
	| "prompt_injection"
	| "tool_misuse";

export type GovernancePolicyFramework =
	| "nist_ai_rmf"
	| "eu_ai_act"
	| "owasp_asi";

export type GovernancePolicyControl = {
	framework: GovernancePolicyFramework;
	control_id: string;
	title: string;
	finding_categories: GovernanceFindingCategory[];
};

export type GovernanceRuleEntityType =
	| "context"
	| "prompt"
	| "evaluation"
	| "alert";

export type GovernanceFinding = {
	id: string;
	category: GovernanceFindingCategory;
	severity: GovernanceSeverity;
	summary: string;
	detail: string;
	/** Deterministic next-step guidance derived from the finding category (no LLM). */
	remediation?: string;
	/** File path or other resource implicated by the finding, when known. */
	resource?: string;
	span_refs: string[];
	evidence?: Record<string, string | number | boolean>;
};

export type GovernanceRuleMatch = {
	rule_id: string;
	rule_name?: string;
	span_id: string;
	matched_fields: Record<string, string | number | boolean>;
	entities: Array<{
		entity_type: GovernanceRuleEntityType;
		entity_id: string;
	}>;
};

export type GovernanceEvaluationRow = {
	span_id: string;
	evaluation_type: string;
	score?: number;
	classification?: string;
	verdict?: string;
	explanation?: string;
};

export type GovernanceHarnessReport = {
	span_count: number;
	max_depth: number;
	llm_call_count: number;
	tool_call_count: number;
	retrieval_call_count: number;
	embedding_call_count: number;
	database_call_count: number;
	http_call_count: number;
	error_count: number;
	total_cost_usd: number;
	/** True when at least one span reported a positive USD cost attribute. */
	cost_reported?: boolean;
	total_tokens: number;
	total_duration_ms: number;
	models_used: string[];
	tools_used: string[];
	permission_mode?: string;
	content_capture_mode?: string;
	user_classification?: string;
	agent_loop?: {
		tool_name: string;
		count: number;
		wasted_tokens: number;
		wasted_cost: number;
		wasted_duration_ms?: number;
		usage_reported?: boolean;
	};
};

export type TraceGovernanceReport = {
	trace_id: string;
	root_span_id: string;
	/** Stable id for CI / evidence correlation (`openlit.governance.report_id`). */
	report_id?: string;
	risk_level: GovernanceSeverity | "none";
	summary: string;
	harness: GovernanceHarnessReport;
	rules: GovernanceRuleMatch[];
	security: GovernanceFinding[];
	evaluations: GovernanceEvaluationRow[];
	finding_count: number;
	rule_match_count: number;
	analysis_limited?: boolean;
	/** Latest Otter trace_analysis run id when security dims were merged. */
	otter_run_id?: string;
	/** Policy pack controls implicated by findings on this trace. */
	policy_controls?: GovernancePolicyControl[];
};
