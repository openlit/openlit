/**
 * Shared realtime contracts. The Go engine (`src/engine`) consumes
 * `RealtimeRule` from `/api/internal/realtime/rules` and posts
 * `RealtimeFindingInput` to `/api/internal/realtime/findings`.
 */

export const REALTIME_RULE_MODES = ["window", "instant"] as const;
export type RealtimeRuleMode = (typeof REALTIME_RULE_MODES)[number];

export const REALTIME_RULE_KINDS = ["threshold", "cost", "compliance", "security"] as const;
export type RealtimeRuleKind = (typeof REALTIME_RULE_KINDS)[number];

export const REALTIME_SEVERITIES = ["info", "warning", "critical"] as const;
export type RealtimeSeverity = (typeof REALTIME_SEVERITIES)[number];

export const REALTIME_FINDING_STATES = ["firing", "resolved"] as const;
export type RealtimeFindingState = (typeof REALTIME_FINDING_STATES)[number];

export interface RealtimeRuleScope {
	organisationId?: string;
	projectId?: string;
	environment?: string;
}

export interface RealtimeRuleCondition {
	field: string;
	op: string;
	values?: string[];
}

export interface RealtimeRule {
	id: string;
	name: string;
	kind: RealtimeRuleKind;
	mode: RealtimeRuleMode;
	severity: RealtimeSeverity;
	scope: RealtimeRuleScope;
	match?: RealtimeRuleCondition[];
	groupBy?: string[];
	metric?: string;
	operator?: "gt" | "gte" | "lt" | "lte";
	threshold: number;
	windowSec?: number;
	minSamples?: number;
	cooldownSec?: number;
}

export interface RealtimeFindingInput {
	ruleId: string;
	state: RealtimeFindingState;
	organisationId: string;
	projectId: string;
	environment: string;
	group: Record<string, string>;
	metric?: string;
	operator?: string;
	value: number;
	threshold: number;
	windowSec?: number;
	sampleCount: number;
	dedupeKey: string;
	observedAt: Date;
	sample: Record<string, string>;
}

export type RealtimeFindingTransition =
	| "opened"
	| "updated"
	| "reopened"
	| "resolved"
	| "ignored";

export interface RealtimeFindingView {
	id: string;
	organisationId: string;
	projectId: string;
	environment: string;
	ruleId: string;
	ruleName: string;
	kind: string;
	mode: string;
	severity: string;
	state: string;
	metric: string | null;
	operator: string | null;
	value: number;
	threshold: number;
	windowSec: number | null;
	sampleCount: number;
	group: Record<string, string>;
	sample: Record<string, string>;
	occurrences: number;
	firstSeenAt: string;
	lastSeenAt: string;
	resolvedAt: string | null;
}
