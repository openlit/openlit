/**
 * Resolve an external telemetry source's credentials from the vault.
 *
 * `TelemetrySource.secretRef` is an `openlit_vault` secret id. The secret value
 * is a JSON blob of vendor credentials (e.g. `{ "apiKey": "...", "appKey": "..." }`
 * for Datadog, `{ "token": "..." }` for New Relic). Decryption happens
 * server-side only; secret values are never logged.
 */

import { getSecretById } from "@/lib/platform/vault";

export interface ResolvedSecret {
	/** Raw decrypted secret string. */
	raw: string;
	/** Parsed JSON credentials when the secret is a JSON object; else {}. */
	credentials: Record<string, string>;
}

/**
 * Fetch and decrypt a vault secret for a source. Returns empty credentials
 * when no secretRef is set (public/no-auth sources).
 */
export async function resolveSourceSecret(
	secretRef: string | null | undefined,
	dbConfigId?: string
): Promise<ResolvedSecret> {
	if (!secretRef) return { raw: "", credentials: {} };

	const result = await getSecretById(secretRef, dbConfigId, false, {
		logDecryptErrors: false,
	});
	const row = (result?.data as { value?: string }[] | undefined)?.[0];
	const raw = typeof row?.value === "string" ? row.value : "";

	let credentials: Record<string, string> = {};
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				credentials = Object.fromEntries(
					Object.entries(parsed).map(([k, v]) => [k, String(v)])
				);
			}
		} catch {
			// Not JSON: treat the whole value as a single opaque token.
			credentials = {};
		}
	}

	return { raw, credentials };
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
