import { getBuiltinRealtimeRules } from "./builtin-rules";
import { getExtensionRealtimeRules } from "@/lib/platform/realtime/extension";
import type { RealtimeRule } from "./types";

/** Every rule the engine should evaluate: the built-in pack plus extensions. */
export async function getActiveRealtimeRules(): Promise<RealtimeRule[]> {
	const builtin = getBuiltinRealtimeRules();
	let extension: RealtimeRule[] = [];
	try {
		extension = await getExtensionRealtimeRules();
	} catch (error) {
		console.error("[realtime] extension rule source failed", error);
	}
	const seen = new Set<string>();
	const out: RealtimeRule[] = [];
	for (const rule of [...builtin, ...extension]) {
		if (!rule?.id || seen.has(rule.id)) continue;
		seen.add(rule.id);
		out.push(rule);
	}
	return out;
}

export async function findActiveRealtimeRule(id: string): Promise<RealtimeRule | null> {
	const rules = await getActiveRealtimeRules();
	return rules.find((rule) => rule.id === id) || null;
}

export function isWithinRuleScope(
	rule: RealtimeRule,
	tenant: { organisationId: string; projectId: string; environment: string }
): boolean {
	const scope = rule.scope || {};
	if (scope.organisationId && scope.organisationId !== tenant.organisationId) return false;
	if (scope.projectId && scope.projectId !== tenant.projectId) return false;
	if (scope.environment && scope.environment !== tenant.environment) return false;
	return true;
}
