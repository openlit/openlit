import { jsonParse, jsonStringify } from "@/utils/json";
import { syncRuleEntitiesFromConfig } from "./sync-rule-entities";

export interface RuleWithPriority {
	ruleId: string;
	priority: number;
}

export interface EvaluationTypeConfig {
	id: string;
	enabled: boolean;
	isCustom?: boolean;
	label?: string;
	description?: string;
	rules?: RuleWithPriority[];
	ruleId?: string;
	priority?: number;
	defaultPrompt?: string;
	prompt?: string;
	thresholdScore?: number;
}

/**
 * Normalizes a raw rules array (as received from a request body) into
 * validated { ruleId, priority } pairs, dropping entries without a ruleId.
 */
export function normalizeRules(rules: any[]): RuleWithPriority[] {
	if (!Array.isArray(rules)) return [];
	return rules
		.filter((r: any) => r?.ruleId)
		.map((r: any) => ({
			ruleId: r.ruleId,
			priority: Number(r.priority) || 0,
		}));
}

/**
 * Normalizes a single raw evaluation type entry (as received from a request
 * body) into a persistable EvaluationTypeConfig. The threshold is validated
 * and normalized by the caller (via normalizeThresholdScore) beforehand,
 * since only the caller knows how to surface a validation error.
 */
export function normalizeTypeConfig(
	t: any,
	thresholdScore: number | undefined
): EvaluationTypeConfig {
	const rules = t.rules?.length
		? normalizeRules(t.rules)
		: t.ruleId
		? [{ ruleId: t.ruleId, priority: Number(t.priority) || 0 }]
		: [];
	const config: EvaluationTypeConfig = {
		id: t.id,
		enabled: !!t.enabled,
		rules,
	};
	if (thresholdScore !== undefined) config.thresholdScore = thresholdScore;
	// Preserve custom type metadata
	if (t.isCustom) {
		config.isCustom = true;
		if (t.label) config.label = String(t.label).trim();
		if (t.description) config.description = String(t.description).trim();
		if (t.prompt) config.prompt = String(t.prompt).trim();
	} else if (t.prompt) {
		config.prompt = String(t.prompt).trim();
	}
	return config;
}

/**
 * Upserts a single type into an existing evaluationTypes list by id,
 * appending it when no entry with that id exists yet.
 */
export function mergeTypeIntoList(
	types: EvaluationTypeConfig[],
	updated: EvaluationTypeConfig
): EvaluationTypeConfig[] {
	const idx = types.findIndex((t) => t.id === updated.id);
	if (idx >= 0) {
		const next = [...types];
		next[idx] = updated;
		return next;
	}
	return [...types, updated];
}

/**
 * Persists an evaluationTypes array into an evaluation config's meta JSON
 * and re-syncs rule-engine entities. Shared by every route (dashboard and
 * API-key-authed) that creates or updates evaluation types, so the
 * persistence step behaves identically regardless of caller.
 */
export async function persistEvaluationTypes(
	configId: string,
	configMeta: string | null | undefined,
	evaluationTypes: EvaluationTypeConfig[]
): Promise<void> {
	const prisma = (await import("@/lib/prisma")).default;
	const meta = jsonParse(configMeta || "{}") as Record<string, any>;
	meta.evaluationTypes = evaluationTypes;

	await prisma.evaluationConfigs.update({
		where: { id: configId },
		data: { meta: jsonStringify(meta) },
	});

	await syncRuleEntitiesFromConfig();
}
