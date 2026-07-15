import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getEvaluationConfigByDbConfigId } from "@/lib/platform/evaluation/config";
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
