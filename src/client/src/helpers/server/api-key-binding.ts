import { MIDDLEWARE_DATABASE_CONFIG_HEADER } from "@/constants/openlit-context";

type HeaderSource = { get(name: string): string | null };

// One lookup per request even when several wrappers ask.
const verified = new WeakMap<object, Promise<string | undefined>>();

async function verify(headers: HeaderSource): Promise<string | undefined> {
	const bound = headers.get(MIDDLEWARE_DATABASE_CONFIG_HEADER)?.trim();
	if (!bound) return undefined;
	const authorization = headers.get("authorization") || headers.get("Authorization") || "";
	if (!authorization.startsWith("Bearer ")) return undefined;
	const apiKey = authorization.slice("Bearer ".length).trim();
	if (!apiKey) return undefined;
	// Lazy: the API key module pulls in Prisma, and this helper sits on shared
	// import paths (route wrappers, telemetry source resolution).
	const { getAPIKeyInfo } = await import("@/lib/platform/api-keys");
	const [err, info] = await getAPIKeyInfo({ apiKey });
	if (err || !info || info.databaseConfigId !== bound) return undefined;
	return bound;
}

/**
 * The database config an API-key request is bound to, or undefined.
 *
 * Middleware sets `x-database-config-id` after verifying the Bearer key, but a
 * header is not proof on its own: if middleware is ever skipped (for example
 * CVE-2025-29927) or misconfigured, a caller could set it directly. So the
 * binding counts only when the same request carries a live API key whose
 * database config is that id.
 */
export function getVerifiedApiKeyDatabaseConfigId(
	source: { headers?: HeaderSource } | HeaderSource
): Promise<string | undefined> {
	const headers: HeaderSource | undefined =
		"get" in source && typeof source.get === "function"
			? (source as HeaderSource)
			: (source as { headers?: HeaderSource }).headers;
	if (!headers || typeof headers.get !== "function") return Promise.resolve(undefined);
	const key = source as object;
	let pending = verified.get(key);
	if (!pending) {
		pending = verify(headers).catch(() => undefined);
		verified.set(key, pending);
	}
	return pending;
}
