import type { RealtimeRule as RealtimeRuleRow } from "@prisma/client";
import prisma from "@/lib/prisma";
import type {
	RealtimeRule,
	RealtimeRuleCondition,
	RealtimeRuleKind,
	RealtimeRuleMode,
	RealtimeSeverity,
} from "./types";

// Engine-facing side of stored realtime rules: ids, engine shape, and the
// cached active set. No session or request context, so the engine's
// internal routes and the findings recorder can use it directly.

/**
 * Product features that own realtime rules. The engine treats them the same;
 * each feature lists, edits, and presents only its own rules.
 */
export const REALTIME_RULE_OWNERS = ["alert"] as const;
export type RealtimeRuleOwner = (typeof REALTIME_RULE_OWNERS)[number];

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type RealtimeRuleDefinition = {
	match: RealtimeRuleCondition[];
	groupBy: string[];
	metric?: string;
	operator?: "gt" | "gte" | "lt" | "lte";
	threshold: number;
	windowSec?: number;
	minSamples?: number;
	cooldownSec: number;
};

/** Engine id of a stored rule: `<owner>.<id>`, e.g. `alert.cmv…`. */
export function engineRuleId(row: Pick<RealtimeRuleRow, "owner" | "id">): string {
	return `${row.owner}.${row.id}`;
}

/** Split an engine rule id back into owner and row id, or null. */
export function parseEngineRuleId(ruleId: string): { owner: RealtimeRuleOwner; id: string } | null {
	const dot = ruleId.indexOf(".");
	if (dot <= 0) return null;
	const owner = ruleId.slice(0, dot);
	const id = ruleId.slice(dot + 1);
	if (!(REALTIME_RULE_OWNERS as readonly string[]).includes(owner) || !ID_PATTERN.test(id)) return null;
	return { owner: owner as RealtimeRuleOwner, id };
}

export function parseStoredDefinition(raw: string): RealtimeRuleDefinition | null {
	try {
		const value = JSON.parse(raw);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as RealtimeRuleDefinition)
			: null;
	} catch {
		return null;
	}
}

/** Engine shape. Scope is always the stored organisation/project/environment. */
export function toEngineRule(row: RealtimeRuleRow): RealtimeRule | null {
	const definition = parseStoredDefinition(row.definition);
	if (!definition) return null;
	return {
		id: engineRuleId(row),
		name: row.name,
		kind: row.kind as RealtimeRuleKind,
		mode: row.mode as RealtimeRuleMode,
		severity: row.severity as RealtimeSeverity,
		scope: {
			organisationId: row.organisationId,
			projectId: row.projectId,
			environment: row.environment,
		},
		match: definition.match,
		groupBy: definition.groupBy,
		metric: definition.metric,
		operator: definition.operator,
		threshold: definition.threshold,
		windowSec: definition.windowSec,
		minSamples: definition.minSamples,
		cooldownSec: definition.cooldownSec,
	};
}

// The engine polls rules and every finding post re-resolves its rule, so a
// short cache keeps both off the database. Writes in this process reset it.
const RULE_CACHE_MS = 10_000;
let cached: { at: number; rules: RealtimeRule[] } | null = null;
let inflight: Promise<RealtimeRule[]> | null = null;

export function resetRealtimeRuleCache() {
	cached = null;
	inflight = null;
}

/** Every enabled stored rule, in engine shape. */
export async function listEngineRealtimeRules(): Promise<RealtimeRule[]> {
	const now = Date.now();
	if (cached && now - cached.at < RULE_CACHE_MS) return cached.rules;
	if (!inflight) {
		inflight = prisma.realtimeRule
			.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } })
			.then((rows) => {
				const rules = rows.map(toEngineRule).filter((rule): rule is RealtimeRule => rule !== null);
				cached = { at: Date.now(), rules };
				return rules;
			})
			.finally(() => {
				inflight = null;
			});
	}
	return inflight;
}
