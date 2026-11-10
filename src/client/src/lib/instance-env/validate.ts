import { getInstanceEnvField, isInstanceEnvKey, type InstanceEnvKey } from "./catalog";
import { normalizeAzureTenant, normalizeClientId, normalizeOktaIssuer, normalizeSecret } from "./values";

export type InstanceEnvParseError =
	| "malformed"
	| "unknown_key"
	| "invalid_value"
	| "invalid_issuer"
	| "invalid_tenant";

export type InstanceEnvChange =
	| { key: InstanceEnvKey; action: "set"; value: string }
	| { key: InstanceEnvKey; action: "clear" };

export type InstanceEnvParseResult =
	| { ok: true; changes: InstanceEnvChange[] }
	| { ok: false; error: InstanceEnvParseError };

function normalizeField(key: InstanceEnvKey, raw: string): { value: string } | { error: InstanceEnvParseError } {
	if (key === "OKTA_ISSUER") {
		const issuer = normalizeOktaIssuer(raw);
		return issuer ? { value: issuer } : { error: "invalid_issuer" };
	}
	if (key === "AZURE_AD_TENANT_ID") {
		const tenant = normalizeAzureTenant(raw);
		return tenant ? { value: tenant } : { error: "invalid_tenant" };
	}
	const field = getInstanceEnvField(key);
	const value = field?.secret ? normalizeSecret(raw) : normalizeClientId(raw);
	return value ? { value } : { error: "invalid_value" };
}

export function parseInstanceEnvUpdates(body: unknown): InstanceEnvParseResult {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return { ok: false, error: "malformed" };
	}
	const updates = (body as { updates?: unknown }).updates;
	if (!Array.isArray(updates) || updates.length > 20) {
		return { ok: false, error: "malformed" };
	}

	const changes = new Map<InstanceEnvKey, InstanceEnvChange>();
	for (const item of updates) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			return { ok: false, error: "malformed" };
		}
		const record = item as { key?: unknown; value?: unknown; clear?: unknown };
		if (typeof record.key !== "string" || !isInstanceEnvKey(record.key)) {
			return { ok: false, error: record.key === undefined ? "malformed" : "unknown_key" };
		}
		if (record.clear === true) {
			changes.set(record.key, { key: record.key, action: "clear" });
			continue;
		}
		if (record.value === undefined) return { ok: false, error: "malformed" };
		if (typeof record.value !== "string") return { ok: false, error: "malformed" };

		const field = getInstanceEnvField(record.key);
		if (field?.secret && !record.value.trim()) continue;

		if (!record.value.trim()) {
			changes.set(record.key, { key: record.key, action: "clear" });
			continue;
		}

		const normalized = normalizeField(record.key, record.value);
		if ("error" in normalized) return { ok: false, error: normalized.error };
		changes.set(record.key, { key: record.key, action: "set", value: normalized.value });
	}

	return { ok: true, changes: Array.from(changes.values()) };
}
