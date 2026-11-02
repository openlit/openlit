// Client-safe rule vocabulary shared by the rule store and the rule editor.
// Keep in sync with src/engine/internal/rules/rules.go and
// src/engine/internal/signal/attrs.go. The engine re-validates every rule and
// skips any it rejects, so drift here only drops a rule, never widens it.

export const REALTIME_RULE_METRICS = [
	"error_rate",
	"error_count",
	"count",
	"p95_latency_ms",
	"avg_latency_ms",
	"total_tokens",
	"cost",
] as const;

export const REALTIME_RULE_OPERATORS = ["gt", "gte", "lt", "lte"] as const;

export const REALTIME_CONDITION_OPS = [
	"eq",
	"neq",
	"in",
	"not_in",
	"exists",
	"gt",
	"gte",
	"lt",
	"lte",
	"contains",
] as const;

export const REALTIME_NUMERIC_CONDITION_OPS = ["gt", "gte", "lt", "lte"] as const;

export const REALTIME_STRING_FIELDS = [
	"service",
	"model",
	"provider",
	"operation",
	"status",
	"error_type",
	"span_name",
] as const;

export const REALTIME_NUMERIC_FIELDS = [
	"http_status",
	"duration_ms",
	"input_tokens",
	"output_tokens",
	"total_tokens",
	"cost",
] as const;

export const REALTIME_RULE_LIMITS = {
	maxRulesPerProject: 50,
	maxName: 120,
	maxConditions: 10,
	maxConditionValues: 20,
	maxValueLength: 256,
	maxGroupBy: 3,
	minWindowSec: 30,
	maxWindowSec: 3600,
	minCooldownSec: 60,
	maxCooldownSec: 86_400,
	maxMinSamples: 100_000,
} as const;
