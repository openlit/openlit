// Community edition: every API key has full access. Per-key feature access is
// an enterprise feature; the enterprise build overrides this module.
import getMessage from "@/constants/messages";

export class ApiKeyAccessError extends Error {
	constructor(message: string, public status = 400) {
		super(message);
		this.name = "ApiKeyAccessError";
	}
}

export async function getApiKeyScopes(_apiKeyId: string): Promise<string[] | null> {
	return null;
}

export async function getApiKeyScopesByIds(
	_apiKeyIds: string[]
): Promise<Record<string, string[] | null>> {
	return {};
}

export async function resolveApiKeyScopeData(
	_requested: unknown
): Promise<Record<string, unknown>> {
	return {};
}

export async function updateApiKeyScopes(
	_apiKeyId: string,
	_requested: unknown
): Promise<{ id: string; scopes: string[] | null }> {
	throw new ApiKeyAccessError(getMessage().API_KEY_ACCESS_CONTROL_UNAVAILABLE, 403);
}

export function apiKeyAccessErrorResponse(error: unknown) {
	if (error instanceof ApiKeyAccessError) {
		return Response.json({ error: error.message }, { status: error.status });
	}
	return null;
}
