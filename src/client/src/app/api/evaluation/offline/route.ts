import { SERVER_EVENTS } from "@/constants/events";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getEvaluationConfigByDbConfigId } from "@/lib/platform/evaluation/config";
import {
	runOfflineEvaluation,
	OfflineEvaluationInput,
} from "@/lib/platform/evaluation";
import getMessage from "@/constants/messages";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

export async function POST(request: Request) {
	const startTimestamp = Date.now();

	const authorizationHeader = request.headers.get("Authorization") || "";
	if (!authorizationHeader.startsWith("Bearer ")) {
		return Response.json({ err: getMessage().NO_API_KEY }, { status: 401 });
	}
	const apiKey = authorizationHeader.replace(/^Bearer /, "").trim();
	if (!apiKey) {
		return Response.json({ err: getMessage().NO_API_KEY }, { status: 401 });
	}
	const [keyErr, apiInfo] = await getAPIKeyInfo({ apiKey });
	if (keyErr || !apiInfo?.databaseConfigId) {
		return Response.json({ err: getMessage().NO_API_KEY }, { status: 401 });
	}
	const databaseConfigId = apiInfo.databaseConfigId;

	let body: any;
	try {
		body = await request.json();
	} catch {
		return Response.json({ err: "Invalid JSON body" }, { status: 400 });
	}

	if (!body.prompt || typeof body.prompt !== "string") {
		return Response.json(
			{ err: "prompt is required and must be a string" },
			{ status: 400 }
		);
	}
	if (!body.response || typeof body.response !== "string") {
		return Response.json(
			{ err: "response is required and must be a string" },
			{ status: 400 }
		);
	}

	const [configErr, evaluationConfig] = await asaw(
		getEvaluationConfigByDbConfigId(databaseConfigId, false)
	);
	if (configErr || !evaluationConfig?.id) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_OFFLINE_FAILURE,
			startTimestamp,
		});
		return Response.json(
			{
				err: "Evaluation not configured. Set up evaluation in the OpenLIT dashboard first.",
			},
			{ status: 400 }
		);
	}

	const input: OfflineEvaluationInput = {
		prompt: body.prompt,
		response: body.response,
		contexts: Array.isArray(body.contexts)
			? body.contexts.filter((c: any) => typeof c === "string")
			: undefined,
		evalTypes: Array.isArray(body.eval_types)
			? body.eval_types.filter((t: any) => typeof t === "string")
			: undefined,
		thresholdScore:
			typeof body.threshold_score === "number"
				? body.threshold_score
				: 0.5,
		storeResults: body.store_results !== false,
		runId: typeof body.run_id === "string" ? body.run_id : undefined,
		metadata:
			body.metadata &&
			typeof body.metadata === "object" &&
			!Array.isArray(body.metadata)
				? (Object.fromEntries(
						Object.entries(body.metadata)
							.filter((entry): entry is [string, string] => typeof entry[1] === "string")
							.slice(0, 20)
					) as Record<string, string>)
				: undefined,
		attributes:
			body.attributes &&
			typeof body.attributes === "object" &&
			!Array.isArray(body.attributes)
				? body.attributes
				: undefined,
	};

	const result = await runOfflineEvaluation(
		input,
		evaluationConfig,
		databaseConfigId
	);

	if (!result.success) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_OFFLINE_FAILURE,
			startTimestamp,
		});
		return Response.json(
			{ success: false, err: result.error },
			{ status: 400 }
		);
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_OFFLINE_SUCCESS,
		startTimestamp,
	});
	return Response.json({
		success: true,
		evaluations: (result.evaluations || []).map((e) => ({
			type: e.evaluation,
			score: e.score,
			verdict: e.verdict,
			classification: e.classification,
			explanation: e.explanation,
		})),
		context_applied: result.contextApplied,
		metadata: result.metadata,
	});
}

export async function OPTIONS() {
	return new Response(null, {
		status: 200,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		},
	});
}
