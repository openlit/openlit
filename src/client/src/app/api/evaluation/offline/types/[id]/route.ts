import { SERVER_EVENTS } from "@/constants/events";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getEvaluationConfigByDbConfigId } from "@/lib/platform/evaluation/config";
import { normalizeThresholdScore } from "@/lib/platform/evaluation/threshold";
import {
	normalizeRules,
	mergeTypeIntoList,
	persistEvaluationTypes,
	EvaluationTypeConfig,
} from "@/lib/platform/evaluation/type-config";
import getMessage from "@/constants/messages";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";
import { jsonParse } from "@/utils/json";
import { errorResponse } from "@/helpers/server/response";

export async function PATCH(
	request: Request,
	{ params }: { params: { id: string } }
) {
	const startTimestamp = Date.now();
	const typeId = params.id;

	const authorizationHeader = request.headers.get("Authorization") || "";
	if (!authorizationHeader.startsWith("Bearer ")) {
		return errorResponse(getMessage().NO_API_KEY, 401);
	}
	const apiKey = authorizationHeader.replace(/^Bearer /, "").trim();
	if (!apiKey) {
		return errorResponse(getMessage().NO_API_KEY, 401);
	}
	const [keyErr, apiInfo] = await getAPIKeyInfo({ apiKey });
	if (keyErr || !apiInfo?.databaseConfigId) {
		return errorResponse(getMessage().NO_API_KEY, 401);
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return errorResponse("Invalid JSON body", 400);
	}

	const thresholdScore =
		body.thresholdScore !== undefined
			? normalizeThresholdScore(body.thresholdScore)
			: undefined;
	if (Number.isNaN(thresholdScore)) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPE_UPDATE_FAILURE,
			startTimestamp,
		});
		return errorResponse(getMessage().EVALUATION_THRESHOLD_SCORE_INVALID, 400);
	}

	const [configErr, config] = await asaw(
		getEvaluationConfigByDbConfigId(apiInfo.databaseConfigId, true)
	);
	if (configErr || !config?.id) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPE_UPDATE_FAILURE,
			startTimestamp,
		});
		return errorResponse(
			"Evaluation not configured. Set up evaluation in the OpenLIT dashboard first.",
			400
		);
	}

	const meta = jsonParse((config as any).meta || "{}") as Record<string, any>;
	const types: EvaluationTypeConfig[] =
		(meta.evaluationTypes as EvaluationTypeConfig[]) || [];
	const idx = types.findIndex((t: any) => t.id === typeId);
	const existing = idx >= 0 ? types[idx] : { id: typeId, enabled: false, rules: [] };
	const updated: EvaluationTypeConfig = {
		id: typeId,
		enabled: body.enabled ?? existing.enabled,
		rules: body.rules !== undefined ? normalizeRules(body.rules) : existing.rules || [],
		prompt: body.prompt !== undefined ? body.prompt : existing.prompt,
		thresholdScore:
			body.thresholdScore !== undefined
				? thresholdScore
				: (existing as any).thresholdScore,
	};
	if (body.isCustom || (existing as any).isCustom) {
		updated.isCustom = true;
		updated.label = body.label ?? (existing as any).label ?? typeId;
		updated.description = body.description ?? (existing as any).description ?? "";
	}

	await persistEvaluationTypes(
		config.id,
		(config as any).meta,
		mergeTypeIntoList(types, updated)
	);

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPE_UPDATE_SUCCESS,
		startTimestamp,
	});
	return Response.json({ data: updated });
}

export async function OPTIONS() {
	return new Response(null, {
		status: 200,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "PATCH, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		},
	});
}
