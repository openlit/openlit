import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getEvaluationConfigByDbConfigId } from "./config";
import getMessage from "@/constants/messages";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/helpers/server/response";
import { EvaluationConfigWithSecret } from "@/types/evaluation";

export type OfflineEvaluationTypeConfig = EvaluationConfigWithSecret & {
	evaluationTypes?: any[];
};

/**
 * Authenticates an offline/SDK request via its Bearer API key. Shared by
 * every /api/evaluation/offline/types handler so the auth check and its
 * 401 responses can't drift between them.
 */
export async function authenticateOfflineApiKey(
	request: Request
): Promise<{ error: Response } | { databaseConfigId: string }> {
	const authorizationHeader = request.headers.get("Authorization") || "";
	if (!authorizationHeader.startsWith("Bearer ")) {
		return { error: errorResponse(getMessage().NO_API_KEY, 401) };
	}
	const apiKey = authorizationHeader.replace(/^Bearer /, "").trim();
	if (!apiKey) {
		return { error: errorResponse(getMessage().NO_API_KEY, 401) };
	}
	const [keyErr, apiInfo] = await getAPIKeyInfo({ apiKey });
	if (keyErr || !apiInfo?.databaseConfigId) {
		return { error: errorResponse(getMessage().NO_API_KEY, 401) };
	}
	return { databaseConfigId: apiInfo.databaseConfigId };
}

/**
 * Loads the evaluation config for an authenticated offline/SDK request's
 * own database config, scoped by databaseConfigId. `notConfiguredResponse`
 * lets each caller shape its own "not configured" response (e.g. GET
 * degrades gracefully with a 200, while mutating routes return a 400) while
 * still sharing the lookup and error-detection logic.
 */
export async function loadOfflineEvaluationConfig(
	databaseConfigId: string,
	notConfiguredResponse: () => Response
): Promise<{ error: Response } | { config: OfflineEvaluationTypeConfig }> {
	const [configErr, config] = await asaw(
		getEvaluationConfigByDbConfigId(databaseConfigId, true)
	);
	if (configErr || !config?.id) {
		return { error: notConfiguredResponse() };
	}
	return { config: config as OfflineEvaluationTypeConfig };
}

export const EVALUATION_NOT_CONFIGURED_MESSAGE =
	"Evaluation not configured. Set up evaluation in the OpenLIT dashboard first.";
