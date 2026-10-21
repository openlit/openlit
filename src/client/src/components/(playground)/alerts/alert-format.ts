import getMessage from "@/constants/messages";
import type { RealtimeRuleCondition } from "@/lib/platform/realtime/types";

export const SEVERITY_CLASSES: Record<string, string> = {
	critical: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300",
	warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300",
	info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300",
};

export const STATUS_CLASSES: Record<string, string> = {
	firing: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300",
	ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300",
	disabled: "border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400",
	resolved: "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300",
};

export function metricLabel(metric?: string | null): string {
	const m = getMessage();
	const labels: Record<string, string> = {
		error_rate: m.ALERTING_METRIC_ERROR_RATE,
		error_count: m.ALERTING_METRIC_ERROR_COUNT,
		count: m.ALERTING_METRIC_COUNT,
		p95_latency_ms: m.ALERTING_METRIC_P95_LATENCY,
		avg_latency_ms: m.ALERTING_METRIC_AVG_LATENCY,
		total_tokens: m.ALERTING_METRIC_TOTAL_TOKENS,
		cost: m.ALERTING_METRIC_COST,
	};
	return metric ? labels[metric] || metric : "—";
}

/** Unit hint shown next to the threshold input. */
export function metricUnit(metric?: string | null): string {
	switch (metric) {
		case "error_rate":
			return "0–1";
		case "p95_latency_ms":
		case "avg_latency_ms":
			return "ms";
		case "cost":
			return "USD";
		case "total_tokens":
			return "tokens";
		default:
			return "";
	}
}

export function formatMetricValue(metric: string | null | undefined, value: number): string {
	switch (metric) {
		case "error_rate":
			return `${(value * 100).toFixed(1)}%`;
		case "p95_latency_ms":
		case "avg_latency_ms":
			return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
		case "cost":
			return `$${value.toFixed(value < 1 ? 4 : 2)}`;
		case "total_tokens":
		case "count":
		case "error_count":
			return Math.round(value).toLocaleString();
		default:
			return String(value);
	}
}

export function operatorSymbol(op?: string | null): string {
	switch (op) {
		case "gt":
			return ">";
		case "gte":
			return "≥";
		case "lt":
			return "<";
		case "lte":
			return "≤";
		case "eq":
			return "=";
		case "neq":
			return "≠";
		case "in":
			return "in";
		case "not_in":
			return "not in";
		case "contains":
			return "contains";
		case "exists":
			return "exists";
		default:
			return op || "";
	}
}

export function windowLabel(seconds?: number): string {
	if (!seconds) return "";
	if (seconds % 3600 === 0) return `${seconds / 3600}h`;
	if (seconds % 60 === 0) return `${seconds / 60}m`;
	return `${seconds}s`;
}

export function conditionSummary(definition: {
	metric?: string;
	operator?: string;
	threshold: number;
	windowSec?: number;
	groupBy?: string[];
}): string {
	const m = getMessage();
	const head = `${metricLabel(definition.metric)} ${operatorSymbol(definition.operator)} ${formatMetricValue(definition.metric, definition.threshold)}`;
	const window = definition.windowSec ? ` ${m.ALERTING_OVER} ${windowLabel(definition.windowSec)}` : "";
	const group = definition.groupBy?.length ? ` · ${m.ALERTING_PER} ${definition.groupBy.join(", ")}` : "";
	return `${head}${window}${group}`;
}

export function filtersSummary(match: RealtimeRuleCondition[] | undefined): string {
	if (!match?.length) return getMessage().ALERTING_ALL_SPANS;
	return match
		.map((c) => (c.op === "exists" ? `${c.field} exists` : `${c.field} ${operatorSymbol(c.op)} ${(c.values || []).join(", ")}`))
		.join(" and ");
}

export function relativeTime(iso: string | null | undefined): string {
	if (!iso) return "—";
	const diff = Date.now() - new Date(iso).getTime();
	const m = getMessage();
	if (diff < 60_000) return m.ALERTING_JUST_NOW;
	if (diff < 3_600_000) return m.ALERTING_MINUTES_AGO(Math.floor(diff / 60_000));
	if (diff < 86_400_000) return m.ALERTING_HOURS_AGO(Math.floor(diff / 3_600_000));
	return new Date(iso).toLocaleString();
}
