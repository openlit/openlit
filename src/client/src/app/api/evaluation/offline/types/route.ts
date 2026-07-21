import { SERVER_EVENTS } from "@/constants/events";
import {
	authenticateOfflineApiKey,
	loadOfflineEvaluationConfig,
	EVALUATION_NOT_CONFIGURED_MESSAGE,
} from "@/lib/platform/evaluation/offline-auth";
import { normalizeThresholdScore } from "@/lib/platform/evaluation/threshold";
import {
	normalizeTypeConfig,
	persistEvaluationTypes,
	upsertEvaluationTypes,
	EvaluationTypeConfig,
} from "@/lib/platform/evaluation/type-config";
import getMessage from "@/constants/messages";
import PostHogServer from "@/lib/posthog";
import { errorResponse } from "@/helpers/server/response";
import { jsonParse } from "@/utils/json";

export async function GET(request: Request) {
	const startTimestamp = Date.now();

	const auth = await authenticateOfflineApiKey(request);
	if ("error" in auth) return auth.error;

	const loaded = await loadOfflineEvaluationConfig(auth.databaseConfigId, () =>
		errorResponse(EVALUATION_NOT_CONFIGURED_MESSAGE, 200, {
			eval_types: [],
			configured: false,
		})
	);
	if ("error" in loaded) return loaded.error;

	const types = (loaded.config.evaluationTypes || []).map((t: any) => ({
		id: t.id,
		label: t.label || t.id,
		description: t.description || "",
		enabled: !!t.enabled,
		is_custom: !!t.isCustom,
		...(typeof t.thresholdScore === "number"
			? { threshold_score: t.thresholdScore }
			: {}),
	}));

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPES_SUCCESS,
		startTimestamp,
	});
	return Response.json({ eval_types: types });
}

export async function POST(request: Request) {
	const startTimestamp = Date.now();

	const auth = await authenticateOfflineApiKey(request);
	if ("error" in auth) return auth.error;

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

	const loaded = await loadOfflineEvaluationConfig(auth.databaseConfigId, () => {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPE_CREATE_FAILURE,
			startTimestamp,
		});
		return errorResponse(EVALUATION_NOT_CONFIGURED_MESSAGE, 400);
	});
	if ("error" in loaded) return loaded.error;

	const normalizedTypes = types.map((t, i) =>
		normalizeTypeConfig(t, thresholdScores[i])
	);

	// Upsert into the existing meta list. Unlike the dashboard POST (which
	// always sends the full UI list), API-key clients may post a partial
	// array — a full replace would wipe unrelated types and thresholds.
	const meta = jsonParse((loaded.config as any).meta || "{}") as Record<
		string,
		any
	>;
	const existingTypes: EvaluationTypeConfig[] =
		(meta.evaluationTypes as EvaluationTypeConfig[]) || [];
	const nextTypes = upsertEvaluationTypes(existingTypes, normalizedTypes);

	await persistEvaluationTypes(
		loaded.config.id,
		(loaded.config as any).meta,
		nextTypes
	);

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
