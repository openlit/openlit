import getMessage from "@/constants/messages";
import type { RealtimeRuleInput } from "./rule-store";

export type ThresholdAlertTemplate = {
	id: string;
	name: string;
	description: string;
	input: RealtimeRuleInput;
};

function numberEnv(name: string, fallback: number) {
	const raw = Number(process.env[name]);
	return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Starting points for the New alert form. Nothing runs until a user saves an
 * alert from one of these; the OPENLIT_REALTIME_* variables only change the
 * suggested values.
 */
export function getThresholdAlertTemplates(): ThresholdAlertTemplate[] {
	const m = getMessage();
	const windowSec = Math.min(numberEnv("OPENLIT_REALTIME_WINDOW_SEC", 300), 3600);
	const minSamples = numberEnv("OPENLIT_REALTIME_MIN_SAMPLES", 20);
	const cooldownSec = Math.max(numberEnv("OPENLIT_REALTIME_COOLDOWN_SEC", 900), 60);
	const base = { mode: "window" as const, enabled: true };
	return [
		{
			id: "error_rate",
			name: m.REALTIME_RULE_ERROR_RATE,
			description: m.ALERT_TEMPLATE_ERROR_RATE,
			input: {
				...base,
				name: m.REALTIME_RULE_ERROR_RATE,
				description: m.ALERT_TEMPLATE_ERROR_RATE,
				kind: "threshold",
				severity: "warning",
				definition: {
					match: [],
					groupBy: ["service"],
					metric: "error_rate",
					operator: "gt",
					threshold: numberEnv("OPENLIT_REALTIME_ERROR_RATE", 0.25),
					windowSec,
					minSamples,
					cooldownSec,
				},
			},
		},
		{
			id: "p95_latency",
			name: m.REALTIME_RULE_P95_LATENCY,
			description: m.ALERT_TEMPLATE_P95_LATENCY,
			input: {
				...base,
				name: m.REALTIME_RULE_P95_LATENCY,
				description: m.ALERT_TEMPLATE_P95_LATENCY,
				kind: "threshold",
				severity: "warning",
				definition: {
					match: [],
					groupBy: ["model"],
					metric: "p95_latency_ms",
					operator: "gt",
					threshold: numberEnv("OPENLIT_REALTIME_P95_LATENCY_MS", 30000),
					windowSec,
					minSamples,
					cooldownSec,
				},
			},
		},
		{
			id: "token_spike",
			name: m.REALTIME_RULE_TOKEN_SPIKE,
			description: m.ALERT_TEMPLATE_TOKEN_SPIKE,
			input: {
				...base,
				name: m.REALTIME_RULE_TOKEN_SPIKE,
				description: m.ALERT_TEMPLATE_TOKEN_SPIKE,
				kind: "threshold",
				severity: "warning",
				definition: {
					match: [],
					groupBy: ["model"],
					metric: "total_tokens",
					operator: "gt",
					threshold: numberEnv("OPENLIT_REALTIME_TOKENS_PER_WINDOW", 1_000_000),
					windowSec,
					minSamples: 1,
					cooldownSec,
				},
			},
		},
		{
			id: "cost_spike",
			name: m.REALTIME_RULE_COST_SPIKE,
			description: m.ALERT_TEMPLATE_COST_SPIKE,
			input: {
				...base,
				name: m.REALTIME_RULE_COST_SPIKE,
				description: m.ALERT_TEMPLATE_COST_SPIKE,
				kind: "cost",
				severity: "critical",
				definition: {
					match: [],
					groupBy: ["model"],
					metric: "cost",
					operator: "gt",
					threshold: numberEnv("OPENLIT_REALTIME_COST_PER_WINDOW_USD", 25),
					windowSec,
					minSamples: 1,
					cooldownSec,
				},
			},
		},
	];
}
