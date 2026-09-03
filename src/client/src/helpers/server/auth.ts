import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getCurrentUser } from "@/lib/session";

/** Middleware injects this after a successful Bearer API key verification. */
export const MIDDLEWARE_DATABASE_CONFIG_HEADER = "x-database-config-id";

export type RequestAuth = {
	/** Bound database config (API key) or undefined for session (caller may resolve current). */
	databaseConfigId?: string;
	/** Session user id, or the API key creator when authenticated via Bearer. */
	userId?: string;
	via: "apiKey" | "session";
};

/**
 * Resolves the database configuration ID from the request headers or the current user session.
 * Prefer middleware-injected API key binding (`x-database-config-id`), then fall back to session.
 * Returns a tuple of [error, databaseConfigId].
 */
export async function resolveDbConfigId(
	request: Request
): Promise<[string | null, string | undefined]> {
	const [authErr, auth] = await resolveRequestAuth(request);
	if (authErr || !auth) {
		return [authErr || "Unauthorized", undefined];
	}
	return [null, auth.databaseConfigId];
}

/**
 * Prefer API key (middleware `x-database-config-id` / Bearer), then session.
 * Used by Ask Otter / AI Analysis and other dual-auth routes.
 */
export async function resolveRequestAuth(
	request: Request
): Promise<[string | null, RequestAuth | null]> {
	const middlewareDbConfigId = request.headers
		?.get?.(MIDDLEWARE_DATABASE_CONFIG_HEADER)
		?.trim();
	if (middlewareDbConfigId) {
		let userId: string | undefined;
		const authorizationHeader = request.headers?.get?.("Authorization") || "";
		if (authorizationHeader.startsWith("Bearer ")) {
			const apiKey = authorizationHeader.replace(/^Bearer /, "").trim();
			if (apiKey) {
				const [keyErr, apiInfo] = await getAPIKeyInfo({ apiKey });
				if (!keyErr && apiInfo?.createdByUserId) {
					userId = apiInfo.createdByUserId;
				}
			}
		}
		return [
			null,
			{
				databaseConfigId: middlewareDbConfigId,
				userId,
				via: "apiKey",
			},
		];
	}

	const user = await getCurrentUser();
	if (!user) {
		return ["Unauthorized", null];
	}

	return [
		null,
		{
			databaseConfigId: undefined,
			userId: user.id,
			via: "session",
		},
	];
}
