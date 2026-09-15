import { SERVER_EVENTS } from "@/constants/events";
import {
	authenticateOfflineApiKey,
	loadOfflineEvaluationConfig,
	EVALUATION_NOT_CONFIGURED_MESSAGE,
} from "@/lib/platform/evaluation/offline-auth";
import { normalizeThresholdScore } from "@/lib/platform/evaluation/threshold";
import {
	normalizeRules,
	mergeTypeIntoList,
	persistEvaluationTypes,
	EvaluationTypeConfig,
} from "@/lib/platform/evaluation/type-config";
import getMessage from "@/constants/messages";
import PostHogServer from "@/lib/posthog";
import { jsonParse } from "@/utils/json";
import { errorResponse } from "@/helpers/server/response";

export async function PATCH(
	request: Request,
	{ params }: { params: { id: string } }
) {
	const startTimestamp = Date.now();
	const typeId = params.id;

	const auth = await authenticateOfflineApiKey(request);
	if ("error" in auth) return auth.error;

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

	const loaded = await loadOfflineEvaluationConfig(auth.databaseConfigId, () => {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPE_UPDATE_FAILURE,
			startTimestamp,
		});
		return errorResponse(EVALUATION_NOT_CONFIGURED_MESSAGE, 400);
	});
	if ("error" in loaded) return loaded.error;

	const meta = jsonParse((loaded.config as any).meta || "{}") as Record<string, any>;
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
		loaded.config.id,
		(loaded.config as any).meta,
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
