import prisma from "@/lib/prisma";
import { toRealtimeFindingView } from "@/lib/platform/realtime/findings";
import { listLiveSignals, type LiveSignal } from "@/lib/platform/realtime/signals";
import { signalMatchesConditions } from "@/lib/platform/realtime/match";
import {
	createRealtimeRule,
	deleteRealtimeRule,
	engineRuleId,
	findScopedRule,
	listRealtimeRules,
	setRealtimeRuleEnabled,
	toRealtimeRuleView,
	updateRealtimeRule,
	type RealtimeRuleInput,
	type RealtimeRuleScopeContext,
	type RealtimeRuleView,
} from "@/lib/platform/realtime/rule-store";
import {
	REALTIME_FINDING_STATES,
	type RealtimeFindingState,
	type RealtimeFindingView,
} from "@/lib/platform/realtime/types";

/** Threshold alerts are realtime rules owned by the Alerts feature. */
export const THRESHOLD_ALERT_OWNER = "alert" as const;

export type ThresholdAlertStatus = "firing" | "ok" | "disabled";

export type ThresholdAlertView = RealtimeRuleView & {
	type: "threshold";
	status: ThresholdAlertStatus;
	firingCount: number;
	occurrences: number;
	lastTriggeredAt: string | null;
};

export type ThresholdAlertOverview = {
	alerts: number;
	enabled: number;
	firingAlerts: number;
	firingFindings: number;
	resolvedLast24h: number;
	firingBySeverity: Record<string, number>;
	recent: (RealtimeFindingView & { alertId: string | null })[];
	noisiest: { alertId: string; name: string; severity: string; occurrences: number }[];
};

type AlertStats = { firing: number; occurrences: number; lastSeenAt: Date | null };

async function statsByRule(scope: RealtimeRuleScopeContext): Promise<Map<string, AlertStats>> {
	const rows = await prisma.realtimeFinding.groupBy({
		by: ["ruleId", "state"],
		where: { projectId: scope.projectId, environment: scope.environment },
		_count: { _all: true },
		_sum: { occurrences: true },
		_max: { lastSeenAt: true },
	});
	const out = new Map<string, AlertStats>();
	for (const row of rows) {
		const stats = out.get(row.ruleId) || { firing: 0, occurrences: 0, lastSeenAt: null };
		if (row.state === "firing") stats.firing += row._count._all;
		stats.occurrences += row._sum.occurrences || 0;
		const last = row._max.lastSeenAt;
		if (last && (!stats.lastSeenAt || last > stats.lastSeenAt)) stats.lastSeenAt = last;
		out.set(row.ruleId, stats);
	}
	return out;
}

function withStats(rule: RealtimeRuleView, stats: AlertStats | undefined): ThresholdAlertView {
	const firing = stats?.firing || 0;
	return {
		...rule,
		type: "threshold",
		status: !rule.enabled ? "disabled" : firing > 0 ? "firing" : "ok",
		firingCount: firing,
		occurrences: stats?.occurrences || 0,
		lastTriggeredAt: stats?.lastSeenAt ? stats.lastSeenAt.toISOString() : null,
	};
}

export async function listThresholdAlerts(scope: RealtimeRuleScopeContext): Promise<ThresholdAlertView[]> {
	const [rules, stats] = await Promise.all([
		listRealtimeRules(scope, THRESHOLD_ALERT_OWNER),
		statsByRule(scope),
	]);
	return rules.map((rule) => withStats(rule, stats.get(rule.engineRuleId)));
}

export async function getThresholdAlert(scope: RealtimeRuleScopeContext, id: string): Promise<ThresholdAlertView> {
	const row = await findScopedRule(scope, THRESHOLD_ALERT_OWNER, id);
	const stats = await statsByRule(scope);
	return withStats(toRealtimeRuleView(row), stats.get(engineRuleId(row)));
}

export async function createThresholdAlert(scope: RealtimeRuleScopeContext, input: RealtimeRuleInput) {
	return withStats(await createRealtimeRule(scope, THRESHOLD_ALERT_OWNER, input), undefined);
}

export async function updateThresholdAlert(
	scope: RealtimeRuleScopeContext,
	id: string,
	input: RealtimeRuleInput
) {
	await updateRealtimeRule(scope, THRESHOLD_ALERT_OWNER, id, input);
	return getThresholdAlert(scope, id);
}

export async function setThresholdAlertEnabled(scope: RealtimeRuleScopeContext, id: string, enabled: boolean) {
	await setRealtimeRuleEnabled(scope, THRESHOLD_ALERT_OWNER, id, enabled);
	return getThresholdAlert(scope, id);
}

/** Deletes the alert and its findings; history for a deleted alert has no owner. */
export async function deleteThresholdAlert(scope: RealtimeRuleScopeContext, id: string) {
	const row = await findScopedRule(scope, THRESHOLD_ALERT_OWNER, id);
	await prisma.realtimeFinding.deleteMany({
		where: { projectId: scope.projectId, environment: scope.environment, ruleId: engineRuleId(row) },
	});
	return deleteRealtimeRule(scope, THRESHOLD_ALERT_OWNER, id);
}

export async function listThresholdAlertFindings(
	scope: RealtimeRuleScopeContext,
	id: string,
	options: { state?: string | null; limit?: number } = {}
): Promise<RealtimeFindingView[]> {
	const row = await findScopedRule(scope, THRESHOLD_ALERT_OWNER, id);
	const state =
		options.state && REALTIME_FINDING_STATES.includes(options.state as RealtimeFindingState)
			? options.state
			: undefined;
	const rows = await prisma.realtimeFinding.findMany({
		where: {
			projectId: scope.projectId,
			environment: scope.environment,
			ruleId: engineRuleId(row),
			...(state ? { state } : {}),
		},
		orderBy: { lastSeenAt: "desc" },
		take: Math.min(Math.max(Math.floor(options.limit || 100), 1), 500),
	});
	return rows.map(toRealtimeFindingView);
}

/** Recent spans in this project environment that satisfy the alert's span filters. */
export async function listThresholdAlertSignals(
	scope: RealtimeRuleScopeContext,
	id: string,
	limit = 100
): Promise<{ available: boolean; signals: LiveSignal[] }> {
	const rule = toRealtimeRuleView(await findScopedRule(scope, THRESHOLD_ALERT_OWNER, id));
	const live = await listLiveSignals({ environment: scope.environment, limit: 200 });
	const signals = live.signals
		.filter((signal) => signalMatchesConditions(signal, rule.definition.match || [], scope.environment))
		.slice(0, Math.min(Math.max(limit, 1), 200));
	return { available: live.available, signals };
}

export async function getThresholdAlertOverview(scope: RealtimeRuleScopeContext): Promise<ThresholdAlertOverview> {
	const alerts = await listThresholdAlerts(scope);
	const byEngineId = new Map(alerts.map((alert) => [alert.engineRuleId, alert]));
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const where = { projectId: scope.projectId, environment: scope.environment };
	const [firing, resolvedLast24h, recentRows] = await Promise.all([
		prisma.realtimeFinding.findMany({ where: { ...where, state: "firing" }, select: { severity: true, ruleId: true } }),
		prisma.realtimeFinding.count({ where: { ...where, state: "resolved", resolvedAt: { gte: since } } }),
		prisma.realtimeFinding.findMany({ where, orderBy: { lastSeenAt: "desc" }, take: 20 }),
	]);
	const firingBySeverity: Record<string, number> = { critical: 0, warning: 0, info: 0 };
	for (const finding of firing) {
		firingBySeverity[finding.severity] = (firingBySeverity[finding.severity] || 0) + 1;
	}
	return {
		alerts: alerts.length,
		enabled: alerts.filter((alert) => alert.enabled).length,
		firingAlerts: alerts.filter((alert) => alert.status === "firing").length,
		firingFindings: firing.length,
		resolvedLast24h,
		firingBySeverity,
		recent: recentRows.map((row) => ({
			...toRealtimeFindingView(row),
			alertId: byEngineId.get(row.ruleId)?.id ?? null,
		})),
		noisiest: alerts
			.filter((alert) => alert.occurrences > 0)
			.sort((a, b) => b.occurrences - a.occurrences)
			.slice(0, 5)
			.map((alert) => ({ alertId: alert.id, name: alert.name, severity: alert.severity, occurrences: alert.occurrences })),
	};
}
