import { getEvaluationConfig } from "@/lib/platform/evaluation/config";
import { normalizeThresholdScore } from "@/lib/platform/evaluation/threshold";
import { syncRuleEntitiesFromConfig } from "@/lib/platform/evaluation/sync-rule-entities";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";
import { jsonParse, jsonStringify } from "@/utils/json";
import getMessage from "@/constants/messages";

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

function normalizeTypeConfig(
	t: any,
	thresholdScore: number | undefined
): EvaluationTypeConfig {
	const rules = t.rules?.length
		? t.rules.filter((r: any) => r?.ruleId).map((r: any) => ({
				ruleId: r.ruleId,
				priority: Number(r.priority) || 0,
			}))
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

export async function GET(_: NextRequest) {
	const startTimestamp = Date.now();
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_TYPE_LIST_FAILURE,
			startTimestamp,
		});
		return Response.json(
			{ err: "Evaluation config not found", data: [] },
			{ status: 200 }
		);
	}

	const types = (config as any).evaluationTypes ?? [];
	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_TYPE_LIST_SUCCESS,
		startTimestamp,
	});
	return Response.json({ data: types });
}

export async function POST(request: NextRequest) {
	const startTimestamp = Date.now();
	let body: any;
	try {
		body = await request.json();
	} catch {
		return Response.json({ err: "Invalid JSON body" }, { status: 400 });
	}
	const types = body.types as any[] | undefined;
	if (!Array.isArray(types)) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_TYPE_CREATE_FAILURE,
			startTimestamp,
		});
		return Response.json({ err: "Invalid types array" }, { status: 400 });
	}

	const thresholdScores: Array<number | undefined> = [];
	for (const t of types) {
		const normalized = normalizeThresholdScore(t?.thresholdScore);
		if (Number.isNaN(normalized)) {
			PostHogServer.fireEvent({
				event: SERVER_EVENTS.EVALUATION_TYPE_CREATE_FAILURE,
				startTimestamp,
			});
			return Response.json(
				{ err: getMessage().EVALUATION_THRESHOLD_SCORE_INVALID },
				{ status: 400 }
			);
		}
		thresholdScores.push(normalized);
	}

	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_TYPE_CREATE_FAILURE,
			startTimestamp,
		});
		return Response.json({ err: "Evaluation config not found" }, { status: 400 });
	}

	const normalizedTypes = types.map((t, i) =>
		normalizeTypeConfig(t, thresholdScores[i])
	);

	const prisma = (await import("@/lib/prisma")).default;
	const meta = jsonParse((config as any).meta || "{}") as Record<string, any>;
	meta.evaluationTypes = normalizedTypes;

	await prisma.evaluationConfigs.update({
		where: { id: config.id },
		data: { meta: jsonStringify(meta) },
	});

	await syncRuleEntitiesFromConfig();

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_TYPE_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json({ data: normalizedTypes });
}
