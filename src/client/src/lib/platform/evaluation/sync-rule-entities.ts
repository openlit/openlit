/**
 * Syncs rule entities (ClickHouse) with evaluation type config (Prisma).
 * Keeps both in sync when rules are added/removed from either the rule
 * detail page or the evaluation types page.
 */
import { getEvaluationConfig } from "./config";
import asaw from "@/utils/asaw";
import { jsonParse, jsonStringify } from "@/utils/json";
import prisma from "@/lib/prisma";
import {
	addRuleEntity,
	deleteRuleEntity,
	getRuleEntities,
} from "@/lib/platform/rule-engine";

export interface RuleWithPriority {
	ruleId: string;
	priority: number;
}

/**
 * Add rule to evaluation type config. Call when user adds evaluation entity
 * from rule detail page.
 */
export async function addRuleToEvaluationType(
	ruleId: string,
	evalTypeId: string,
	priority: number = 0
) {
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) return;
	const meta = jsonParse((config as any).meta || "{}") as Record<string, any>;
	const types = (meta.evaluationTypes as Array<{ id: string; rules?: RuleWithPriority[] }>) || [];
	const idx = types.findIndex((t) => t.id === evalTypeId);
	if (idx < 0) return;
	const typeConfig = types[idx];
	const rules = typeConfig.rules || [];
	if (rules.some((r) => r.ruleId === ruleId)) return;
	rules.push({ ruleId, priority });
	types[idx] = { ...typeConfig, rules };
	meta.evaluationTypes = types;
	await prisma.evaluationConfigs.update({
		where: { id: config.id },
		data: { meta: jsonStringify(meta) },
	});
}

/**
 * Remove rule from evaluation type config. Call when user removes evaluation
 * entity from rule detail page.
 */
export async function removeRuleFromEvaluationType(
	ruleId: string,
	evalTypeId: string
) {
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) return;
	const meta = jsonParse((config as any).meta || "{}") as Record<string, any>;
	const types = (meta.evaluationTypes as Array<{ id: string; rules?: RuleWithPriority[] }>) || [];
	const idx = types.findIndex((t) => t.id === evalTypeId);
	if (idx < 0) return;
	const typeConfig = types[idx];
	const rules = (typeConfig.rules || []).filter((r) => r.ruleId !== ruleId);
	types[idx] = { ...typeConfig, rules };
	meta.evaluationTypes = types;
	await prisma.evaluationConfigs.update({
		where: { id: config.id },
		data: { meta: jsonStringify(meta) },
	});
}

/**
 * Sync rule entities to match evaluation config. Call when saving from
 * evaluation types page.
 */
export async function syncRuleEntitiesFromConfig() {
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) return;
	const meta = jsonParse((config as any).meta || "{}") as Record<string, any>;
	const types = (meta.evaluationTypes as Array<{ id: string; rules?: RuleWithPriority[] }>) || [];

	const { err: entitiesErr, data: entities } = (await getRuleEntities({
		entity_type: "evaluation",
	})) as { err?: any; data?: Array<{ id: string; rule_id: string; entity_id: string }> };
	if (entitiesErr || !entities) return;

	const desired = new Set<string>();
	for (const t of types) {
		for (const r of t.rules || []) {
			if (r.ruleId) desired.add(`${r.ruleId}:${t.id}`);
		}
	}

	for (const e of entities) {
		const key = `${e.rule_id}:${e.entity_id}`;
		if (!desired.has(key)) {
			await deleteRuleEntity(e.id);
		}
	}

	for (const t of types) {
		for (const r of t.rules || []) {
			if (!r.ruleId) continue;
			const exists = entities.some(
				(e) => e.rule_id === r.ruleId && e.entity_id === t.id
			);
			if (!exists) {
				const [addErr] = await asaw(
					addRuleEntity({
						rule_id: r.ruleId,
						entity_type: "evaluation",
						entity_id: t.id,
					})
				);
				if (addErr) {
					console.error("Failed to add rule entity:", addErr);
				}
			}
		}
	}
}
