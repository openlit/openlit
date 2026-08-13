/**
 * Resolve an external telemetry source's credentials from the vault.
 *
 * `TelemetrySource.secretRef` is an `openlit_vault` secret id. The secret value
 * is a JSON blob of vendor credentials (e.g. `{ "apiKey": "...", "appKey": "..." }`
 * for Datadog, `{ "token": "..." }` for New Relic). Decryption happens
 * server-side only; secret values are never logged.
 */

import { getSecretById } from "@/lib/platform/vault";
import {
	DATA_SOURCE_SECRET_DECRYPT_FAILED,
	DATA_SOURCE_SECRET_NOT_FOUND,
	DATA_SOURCE_SECRET_UNAVAILABLE,
} from "@/constants/messages/en";

export interface ResolvedSecret {
	/** Raw decrypted secret string. */
	raw: string;
	/** Parsed JSON credentials when the secret is a JSON object; else {}. */
	credentials: Record<string, string>;
}

interface CachedSecret {
	value: ResolvedSecret;
	expiresAt: number;
	staleUntil: number;
}

// Adapters are request-scoped, while a short ClickHouse reset can outlive one
// request. Keep successfully decrypted credentials briefly at the server
// boundary so new adapter instances do not immediately lose vendor auth. The
// stale copy is used only when the vault read itself fails, never when the
// secret was deleted or is unreadable.
const SOURCE_SECRET_CACHE_TTL_MS = 5 * 60_000;
const SOURCE_SECRET_STALE_TTL_MS = 30 * 60_000;
const sourceSecretCache = new Map<string, CachedSecret>();

function sourceSecretCacheKey(
	secretRef: string,
	dbConfigId?: string,
	projectId?: string | null
): string {
	return `${projectId || "session"}:${dbConfigId || "current"}:${secretRef}`;
}

/**
 * Drop cached vault credentials after rotate/rebind. When `secretRef` is
 * omitted, clears the entire process cache.
 */
export function invalidateSourceSecretCache(secretRef?: string): void {
	if (!secretRef) {
		sourceSecretCache.clear();
		return;
	}
	const needle = `:${secretRef}`;
	for (const key of Array.from(sourceSecretCache.keys())) {
		if (key.endsWith(needle)) sourceSecretCache.delete(key);
	}
}

/** Test-only cache reset. */
export function __resetSourceSecretCacheForTests(): void {
	invalidateSourceSecretCache();
}

/**
 * Fetch and decrypt a vault secret for a source. Returns empty credentials
 * when no secretRef is set (public/no-auth sources).
 */
export async function resolveSourceSecret(
	secretRef: string | null | undefined,
	dbConfigId?: string,
	projectId?: string | null
): Promise<ResolvedSecret> {
	if (!secretRef) return { raw: "", credentials: {} };
	const cacheKey = sourceSecretCacheKey(secretRef, dbConfigId, projectId);
	const cached = sourceSecretCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.value;

	let result: Awaited<ReturnType<typeof getSecretById>>;
	try {
		result = await getSecretById(secretRef, dbConfigId, false, {
			logDecryptErrors: false,
			projectId: projectId || undefined,
		});
	} catch {
		if (cached && cached.staleUntil > Date.now()) return cached.value;
		throw new Error(DATA_SOURCE_SECRET_UNAVAILABLE);
	}
	if ((result as { err?: unknown } | null | undefined)?.err) {
		if (cached && cached.staleUntil > Date.now()) return cached.value;
		throw new Error(DATA_SOURCE_SECRET_UNAVAILABLE);
	}
	const row = (result?.data as { value?: string }[] | undefined)?.[0];
	const raw = typeof row?.value === "string" ? row.value : "";
	if (!row || !raw) throw new Error(DATA_SOURCE_SECRET_NOT_FOUND);

	let credentials: Record<string, string> = {};
	if (raw) {
		// decryptValue returns the ciphertext unchanged when decryption fails.
		if (raw.startsWith("enc:v1:")) {
			throw new Error(DATA_SOURCE_SECRET_DECRYPT_FAILED);
		}
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				credentials = Object.fromEntries(
					Object.entries(parsed).map(([k, v]) => [k, String(v)])
				);
			}
		} catch {
			// A manually selected vault value may be a single opaque bearer token.
			credentials = { token: raw };
		}
	}

	const value = { raw, credentials };
	sourceSecretCache.set(cacheKey, {
		value,
		expiresAt: Date.now() + SOURCE_SECRET_CACHE_TTL_MS,
		staleUntil: Date.now() + SOURCE_SECRET_STALE_TTL_MS,
	});
	return value;
}

/** All secret values that must be redacted from any outbound error message. */
export function redactableSecretValues(secret: ResolvedSecret): string[] {
	const values = new Set<string>();
	if (secret.raw) values.add(secret.raw);
	for (const v of Object.values(secret.credentials)) {
		if (v) values.add(v);
	}
	return Array.from(values);
}
