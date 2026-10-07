import { withApiKeyAccess, withApiKeyAudit } from "@/lib/access/api-key-route";
import { generateAPIKey, getAllAPIKeys } from "@/lib/platform/api-keys";
import {
	apiKeyAccessErrorResponse,
	resolveApiKeyScopeData,
} from "@/lib/platform/api-key-access/server";
import asaw from "@/utils/asaw";
import getMessage from "@/constants/messages";
import { MIDDLEWARE_DATABASE_CONFIG_HEADER } from "@/constants/openlit-context";

async function GETHandler(request: Request) {
	// Bearer requests carry the key's DB config (set by the auth middleware,
	// which strips client-supplied copies); session requests resolve their own.
	const apiKeyDatabaseConfigId =
		request.headers?.get?.(MIDDLEWARE_DATABASE_CONFIG_HEADER)?.trim() || undefined;
	const res: any = await getAllAPIKeys(apiKeyDatabaseConfigId);
	return Response.json(res);
}

async function POSTHandler(request: Request) {
	const formData = await request.json().catch(() => null);
	if (!formData || typeof formData !== "object") {
		return Response.json(
			{ error: getMessage().API_KEY_INVALID_JSON },
			{ status: 400 }
		);
	}
	const name = formData.name;

	// Validate requested feature access before the key exists. Not via asaw:
	// it stringifies errors and would drop the access error's status.
	let scopeData: Record<string, unknown>;
	try {
		scopeData = await resolveApiKeyScopeData(formData.scopes);
	} catch (scopeErr) {
		return (
			apiKeyAccessErrorResponse(scopeErr) ??
			Response.json(String(scopeErr), { status: 400 })
		);
	}

	const [err, res]: any = await asaw(generateAPIKey(name, scopeData));

	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}

export const GET = withApiKeyAccess("read", GETHandler);
export const POST = withApiKeyAudit(withApiKeyAccess("create", POSTHandler));
