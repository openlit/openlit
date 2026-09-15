/**
 * ClickHouse-backed OpenLIT feature families covered by the shared OpenPlait
 * read boundary. New ClickHouse read features are covered automatically when
 * they use `dataCollector`; this catalog makes that architectural promise
 * explicit and testable.
 */
export const OPENPLAIT_CLICKHOUSE_READ_FEATURES = [
	"traces",
	"logs",
	"metrics",
	"telemetry",
	"openground",
	"rule-engine",
	"evaluations",
	"dashboards",
	"alerts",
	"prompts",
	"models-and-pricing",
	"management-data",
] as const;

export type OpenPlaitClickHouseReadFeature =
	(typeof OPENPLAIT_CLICKHOUSE_READ_FEATURES)[number];

/**
 * OpenLIT-owned intelligence/materialization reads intentionally stay on the
 * native ClickHouse client. They consume internal state rather than a routed
 * traces/logs/metrics datasource contract.
 */
export const DIRECT_INTELLIGENCE_READ_FEATURES = [
	"otter",
	"ai-analysis",
	"coding-agents",
	"telemetry-rollups",
] as const;
