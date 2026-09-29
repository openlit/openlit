/**
 * Shared HTTP helpers for memory connector adapters.
 *
 * Outbound calls reuse the datasource SSRF-safe fetch and self-hosted
 * network toggles. API keys are decrypted from inline `enc:v1:` secretRef
 * values and never loaded from the ClickHouse vault.
 */

import {
	safeFetch,
	selfHostedNetworkOptions,
} from "../datasource/http/safe-fetch";
import {
	redactableSecretValues,
	resolveSourceSecret,
	type ResolvedSecret,
} from "../datasource/http/secret";
import {
	joinDatasourceRequestUrl,
	normalizeDatasourceEndpointUrl,
} from "../datasource/http/endpoint-url";
import type { MemorySourceDescriptor } from "./types";

export function memoryBaseUrl(
	descriptor: MemorySourceDescriptor,
	fallback: string
): string {
	const raw = String(descriptor.settings.url || "").trim();
	return normalizeDatasourceEndpointUrl(raw || fallback);
}

export async function memoryRequest<T>(
	descriptor: MemorySourceDescriptor,
	baseUrl: string,
	path: string,
	opts: {
		method?: string;
		headers?: Record<string, string>;
		body?: unknown;
		authHeaders: (secret: ResolvedSecret) => Record<string, string>;
		timeoutMs?: number;
	}
): Promise<T> {
	const secret = await resolveSourceSecret(
		descriptor.secretRef,
		undefined,
		descriptor.projectId,
		{ clickHouseVault: false }
	);
	const network = selfHostedNetworkOptions(descriptor.settings);
	const url = joinDatasourceRequestUrl(baseUrl, path);
	return safeFetch<T>(url, {
		method: opts.method || "GET",
		headers: {
			Accept: "application/json",
			...(opts.body ? { "Content-Type": "application/json" } : {}),
			...opts.authHeaders(secret),
			...opts.headers,
		},
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		timeoutMs: opts.timeoutMs ?? 15_000,
		allowHttp: network.allowHttp,
		allowPrivateNetwork: network.allowPrivateNetwork,
		redactValues: redactableSecretValues(secret),
		concurrencyKey: descriptor.id,
		retry: true,
	});
}
