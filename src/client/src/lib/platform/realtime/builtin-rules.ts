import getMessage from "@/constants/messages";
import type { RealtimeRule } from "./types";

function numberEnv(name: string, fallback: number, { min = 0 }: { min?: number } = {}) {
	const raw = Number(process.env[name]);
	return Number.isFinite(raw) && raw > min ? raw : fallback;
}

export function areBuiltinRealtimeRulesEnabled(): boolean {
	const raw = (process.env.OPENLIT_REALTIME_BUILTIN_RULES || "").trim().toLowerCase();
	return !["0", "false", "off", "no"].includes(raw);
}

/**
 * Fixed rule pack shipped with OpenLIT. Thresholds are operator configuration
 * (environment variables), not user-editable rules. Empty scope means the rule
 * applies to every organisation, project, and environment.
 */
export function getBuiltinRealtimeRules(): RealtimeRule[] {
	if (!areBuiltinRealtimeRulesEnabled()) return [];
	const messages = getMessage();
	const windowSec = Math.min(numberEnv("OPENLIT_REALTIME_WINDOW_SEC", 300), 3600);
	const minSamples = numberEnv("OPENLIT_REALTIME_MIN_SAMPLES", 20);
	const cooldownSec = numberEnv("OPENLIT_REALTIME_COOLDOWN_SEC", 900);

	return [
		{
			id: "builtin.error_rate",
			name: messages.REALTIME_RULE_ERROR_RATE,
			kind: "threshold",
			mode: "window",
			severity: "warning",
			scope: {},
			groupBy: ["service"],
			metric: "error_rate",
			operator: "gt",
			threshold: numberEnv("OPENLIT_REALTIME_ERROR_RATE", 0.25),
			windowSec,
			minSamples,
			cooldownSec,
		},
		{
			id: "builtin.p95_latency",
			name: messages.REALTIME_RULE_P95_LATENCY,
			kind: "threshold",
			mode: "window",
			severity: "warning",
			scope: {},
			groupBy: ["model"],
			metric: "p95_latency_ms",
			operator: "gt",
			threshold: numberEnv("OPENLIT_REALTIME_P95_LATENCY_MS", 30000),
			windowSec,
			minSamples,
			cooldownSec,
		},
		{
			id: "builtin.token_spike",
			name: messages.REALTIME_RULE_TOKEN_SPIKE,
			kind: "threshold",
			mode: "window",
			severity: "warning",
			scope: {},
			groupBy: ["model"],
			metric: "total_tokens",
			operator: "gt",
			threshold: numberEnv("OPENLIT_REALTIME_TOKENS_PER_WINDOW", 1_000_000),
			windowSec,
			minSamples: 1,
			cooldownSec,
		},
		{
			id: "builtin.cost_spike",
			name: messages.REALTIME_RULE_COST_SPIKE,
			kind: "cost",
			mode: "window",
			severity: "critical",
			scope: {},
			groupBy: ["model"],
			metric: "cost",
			operator: "gt",
			threshold: numberEnv("OPENLIT_REALTIME_COST_PER_WINDOW_USD", 25),
			windowSec,
			minSamples: 1,
			cooldownSec,
		},
	];
}
