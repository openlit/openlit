import type { NativeQuery, QueryResult } from "@openplait/core";
import { OPENPLAIT_API_VERSION } from "@openplait/core";
import type { DatasourceAdapter as OpenPlaitDatasourceAdapter } from "@openplait/adapter-sdk";
import { BaseExternalAdapter } from "../base-adapter";
import type { TelemetrySourceDescriptor } from "../types";
import { applyHttpAuthCredentials } from "../http/auth-headers";
import { normalizeDatasourceEndpointUrl, rewriteLoopbackEndpointForDocker } from "../http/endpoint-url";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";
import { safeFetch, selfHostedNetworkOptions, SourceResponseError } from "../http/safe-fetch";

const AUTH_TTL_MS = 30_000;

/** Shared OpenLIT host boundary for OpenPlait's HTTP datasource adapters. */
export abstract class OpenPlaitHttpAdapter extends BaseExternalAdapter {
	private authCache?: { expiresAt: number; headers: Record<string, string>; redact: string[] };

	constructor(descriptor: TelemetrySourceDescriptor) {
		super(descriptor);
	}

	protected get baseUrl(): string {
		const url = normalizeDatasourceEndpointUrl(String(this.descriptor.settings.url || ""));
		const network = selfHostedNetworkOptions(this.descriptor.settings);
		return network.allowPrivateNetwork
			? rewriteLoopbackEndpointForDocker(url)
			: url;
	}

	protected positiveSetting(key: string): number | undefined {
		const value = Number(this.descriptor.settings[key]);
		return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
	}

	private async auth() {
		if (this.authCache && this.authCache.expiresAt > Date.now()) return this.authCache;
		const secret = await resolveSourceSecret(this.descriptor.secretRef, this.descriptor.dbConfigId, this.descriptor.projectId);
		const headers = applyHttpAuthCredentials(secret.credentials, {
			authType: this.descriptor.settings.authType as string | undefined,
			tenantHeader: "X-Scope-OrgID",
		});
		this.authCache = { expiresAt: Date.now() + AUTH_TTL_MS, headers, redact: redactableSecretValues(secret) };
		return this.authCache;
	}

	protected async openPlaitConnection(): Promise<{ headers: Record<string, string>; fetch: typeof fetch }> {
		const { headers, redact } = await this.auth();
		const network = selfHostedNetworkOptions(this.descriptor.settings);
		const sourceId = this.descriptor.id;
		const guarded = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			try {
				const payload = await safeFetch<unknown>(url, {
					method: init?.method || "GET",
					headers: Object.fromEntries(new Headers(init?.headers).entries()),
					...network,
					redactValues: redact,
					timeoutMs: 15_000,
					concurrencyKey: sourceId,
					maxConcurrent: 6,
					retry: true,
				});
				return {
					ok: true,
					status: 200,
					statusText: "OK",
					headers: new Headers({ "Content-Type": "application/json" }),
					json: async () => payload,
					text: async () => JSON.stringify(payload),
				} as Response;
			} catch (error) {
				if (error instanceof SourceResponseError) return {
					ok: false,
					status: error.status,
					statusText: "Upstream datasource error",
					headers: new Headers(),
					json: async () => ({ error: error.message }),
					text: async () => error.message,
				} as Response;
				throw error;
			}
		}) as typeof fetch;
		return { headers, fetch: guarded };
	}

	protected async executeNative(
		adapter: OpenPlaitDatasourceAdapter<unknown, unknown>,
		options: { operation: string; kind: string; language: string; statement: string; extension: string; extensionValue: Record<string, unknown> }
	): Promise<QueryResult> {
		const query: NativeQuery = {
			apiVersion: OPENPLAIT_API_VERSION,
			kind: "Query",
			metadata: { name: `openlit-${this.type}-${options.operation}` },
			spec: {
				mode: "native",
				datasource: { kind: options.kind, name: this.descriptor.id },
				native: { language: options.language, statement: options.statement },
				extensions: { [options.extension]: options.extensionValue },
			},
		};
		const requestId = `openlit:${this.type}:${this.descriptor.id.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 64)}:${options.operation}:${Date.now()}`;
		return adapter.execute(query, { audit: { requestId }, queryId: requestId });
	}
}
