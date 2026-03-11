import { getEvaluationConfig } from "@/lib/platform/evaluation/config";
import { syncRuleEntitiesFromConfig } from "@/lib/platform/evaluation/sync-rule-entities";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";
import { jsonParse, jsonStringify } from "@/utils/json";

export interface RuleWithPriority {
	ruleId: string;
	priority: number;
}

export interface EvaluationTypeConfig {
	id: string;
	enabled: boolean;
	rules?: RuleWithPriority[];
	prompt?: string;
	defaultPrompt?: string;
	label?: string;
	description?: string;
}

function normalizeRules(rules: any[]): RuleWithPriority[] {
	if (!Array.isArray(rules)) return [];
	return rules
		.filter((r: any) => r?.ruleId)
		.map((r: any) => ({
			ruleId: r.ruleId,
			priority: Number(r.priority) || 0,
		}));
}

export async function GET(
	_: NextRequest,
	{ params }: { params: { id: string } }
) {
	const typeId = params.id;
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		return Response.json(
			{ err: "Evaluation config not found" },
			{ status: 404 }
		);
	}
	const types = (config as any).evaluationTypes ?? [];
	const typeConfig = types.find((t: any) => t.id === typeId);
	if (!typeConfig) {
		return Response.json(
			{ err: "Evaluation type not found" },
			{ status: 404 }
		);
	}
	return Response.json({ data: typeConfig });
}

export async function PATCH(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const typeId = params.id;
	const body = await request.json();
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		return Response.json(
			{ err: "Evaluation config not found" },
			{ status: 400 }
		);
	}
	const prisma = (await import("@/lib/prisma")).default;
	const meta = jsonParse((config as any).meta || "{}") as Record<string, any>;
	let types: EvaluationTypeConfig[] =
		(meta.evaluationTypes as EvaluationTypeConfig[]) || [];
	const idx = types.findIndex((t: any) => t.id === typeId);
	const existing = idx >= 0 ? types[idx] : { id: typeId, enabled: false, rules: [] };
	const updated: EvaluationTypeConfig = {
		id: typeId,
		enabled: body.enabled ?? existing.enabled,
		rules: body.rules !== undefined ? normalizeRules(body.rules) : existing.rules || [],
		prompt: body.prompt !== undefined ? body.prompt : existing.prompt,
	};
	if (idx >= 0) {
		types[idx] = updated;
	} else {
		types = [...types, updated];
	}
	meta.evaluationTypes = types;
	await prisma.evaluationConfigs.update({
		where: { id: config.id },
		data: { meta: jsonStringify(meta) },
	});
	await syncRuleEntitiesFromConfig();
	return Response.json({ data: updated });
}
