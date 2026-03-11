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
	ruleId?: string;
	priority?: number;
	label?: string;
	description?: string;
	defaultPrompt?: string;
	prompt?: string;
}

function normalizeTypeConfig(t: any): EvaluationTypeConfig {
	const rules = t.rules?.length
		? t.rules.filter((r: any) => r?.ruleId).map((r: any) => ({
				ruleId: r.ruleId,
				priority: Number(r.priority) || 0,
			}))
		: t.ruleId
		? [{ ruleId: t.ruleId, priority: Number(t.priority) || 0 }]
		: [];
	return {
		id: t.id,
		enabled: !!t.enabled,
		rules,
	};
}

export async function GET(_: NextRequest) {
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		return Response.json(
			{ err: "Evaluation config not found", data: [] },
			{ status: 200 }
		);
	}

	const types = (config as any).evaluationTypes ?? [];
	return Response.json({ data: types });
}

export async function POST(request: NextRequest) {
	const body = await request.json();
	const types = body.types as any[] | undefined;
	if (!Array.isArray(types)) {
		return Response.json({ err: "Invalid types array" }, { status: 400 });
	}

	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		return Response.json({ err: "Evaluation config not found" }, { status: 400 });
	}

	const normalizedTypes = types.map(normalizeTypeConfig);

	const prisma = (await import("@/lib/prisma")).default;
	const meta = jsonParse((config as any).meta || "{}") as Record<string, any>;
	meta.evaluationTypes = normalizedTypes;

	await prisma.evaluationConfigs.update({
		where: { id: config.id },
		data: { meta: jsonStringify(meta) },
	});

	await syncRuleEntitiesFromConfig();

	return Response.json({ data: normalizedTypes });
}
