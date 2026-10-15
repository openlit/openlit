import { withApiKeyAccess, withApiKeyAudit } from "@/lib/access/api-key-route";
import { deleteAPIKey } from "@/lib/platform/api-keys/index";
import {
	apiKeyAccessErrorResponse,
	updateApiKeyScopes,
} from "@/lib/platform/api-key-access/server";
import getMessage from "@/constants/messages";

async function DELETEHandler(_: Request, context: any) {
	const { id } = context.params;
	const [err, res] = await deleteAPIKey(id);
	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}

async function PATCHHandler(request: Request, context: any) {
	const { id } = context.params;
	// Never fall back to `{}`: a missing `scopes` means full access.
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== "object" || !("scopes" in body)) {
		return Response.json(
			{ error: getMessage().API_KEY_INVALID_JSON },
			{ status: 400 }
		);
	}
	try {
		return Response.json(await updateApiKeyScopes(id, body?.scopes));
	} catch (err) {
		return (
			apiKeyAccessErrorResponse(err) ??
			Response.json(String(err), { status: 400 })
		);
	}
}

export const DELETE = withApiKeyAudit(withApiKeyAccess("delete", DELETEHandler));
export const PATCH = withApiKeyAudit(withApiKeyAccess("update", PATCHHandler));
