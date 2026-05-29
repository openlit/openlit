import { SERVER_EVENTS } from "@/constants/events";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getEvaluationConfigByDbConfigId } from "@/lib/platform/evaluation/config";
import getMessage from "@/constants/messages";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

export async function GET(request: Request) {
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

	const [configErr, config] = await asaw(
		getEvaluationConfigByDbConfigId(apiInfo.databaseConfigId, true)
	);
	if (configErr || !config?.id) {
		return Response.json(
			{
				err: "Evaluation not configured. Set up evaluation in the OpenLIT dashboard first.",
				eval_types: [],
				configured: false,
			},
			{ status: 200 }
		);
	}

	const types = ((config as any).evaluationTypes || []).map((t: any) => ({
		id: t.id,
		label: t.label || t.id,
		description: t.description || "",
		enabled: !!t.enabled,
		is_custom: !!t.isCustom,
	}));

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_OFFLINE_TYPES_SUCCESS,
		startTimestamp,
	});
	return Response.json({ eval_types: types });
}

export async function OPTIONS() {
	return new Response(null, {
		status: 200,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		},
	});
}
