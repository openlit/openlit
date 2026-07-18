import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getEvaluationConfigByDbConfigId } from "@/lib/platform/evaluation/config";
import { normalizeThresholdScore } from "@/lib/platform/evaluation/threshold";
import {
	normalizeTypeConfig,
	persistEvaluationTypes,
} from "@/lib/platform/evaluation/type-config";
import getMessage from "@/constants/messages";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/helpers/server/response";

export async function GET(request: Request) {
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

	const [configErr, config] = await asaw(
		getEvaluationConfigByDbConfigId(apiInfo.databaseConfigId, true)
	);
	if (configErr || !config?.id) {
		return errorResponse(
			"Evaluation not configured. Set up evaluation in the OpenLIT dashboard first.",
			200,
			{ eval_types: [], configured: false }
		);
	}

	const types = ((config as any).evaluationTypes || []).map((t: any) => ({
		id: t.id,
		label: t.label || t.id,
		description: t.description || "",
		enabled: !!t.enabled,
		is_custom: !!t.isCustom,
	}));

	return Response.json({ eval_types: types });
}

export async function POST(request: Request) {
	const startTimestamp = Date.now();

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
	const types = body.types as any[] | undefined;
	if (!Array.isArray(types)) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPE_CREATE_FAILURE,
			startTimestamp,
		});
		return errorResponse("Invalid types array", 400);
	}

	const thresholdScores: Array<number | undefined> = [];
	for (const t of types) {
		const normalized = normalizeThresholdScore(t?.thresholdScore);
		if (Number.isNaN(normalized)) {
			PostHogServer.fireEvent({
				event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPE_CREATE_FAILURE,
				startTimestamp,
			});
			return errorResponse(getMessage().EVALUATION_THRESHOLD_SCORE_INVALID, 400);
		}
		thresholdScores.push(normalized);
	}

	const [configErr, config] = await asaw(
		getEvaluationConfigByDbConfigId(apiInfo.databaseConfigId, true)
	);
	if (configErr || !config?.id) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPE_CREATE_FAILURE,
			startTimestamp,
		});
		return errorResponse(
			"Evaluation not configured. Set up evaluation in the OpenLIT dashboard first.",
			400
		);
	}

	const normalizedTypes = types.map((t, i) =>
		normalizeTypeConfig(t, thresholdScores[i])
	);

	await persistEvaluationTypes(config.id, (config as any).meta, normalizedTypes);

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPE_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json({ data: normalizedTypes });
}

export async function OPTIONS() {
	return new Response(null, {
		status: 200,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		},
	});
}
