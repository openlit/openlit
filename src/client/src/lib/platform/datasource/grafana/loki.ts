/**
 * Grafana Loki adapter (logs).
 *
 * Queries `GET /loki/api/v1/query_range` with a LogQL expression. AI relevance
 * for logs is best-effort: Loki indexes stream labels, not arbitrary OTel
 * attributes, so the adapter applies a JSON line-filter for `gen_ai`/`coding_agent`
 * keys on top of a configurable base stream selector.
 */

import { BaseExternalAdapter } from "../base-adapter";
import type {
	DataFrame,
	HealthCheckResult,
	NormalizedLog,
	OpenLITQuery,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { applyHttpAuthCredentials } from "../http/auth-headers";
import { httpVendorFields } from "../config-fields";
import getMessage from "@/constants/messages";
import { safeFetch, selfHostedNetworkOptions } from "../http/safe-fetch";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";

const TTL_MS = 30_000;

export class LokiAdapter extends BaseExternalAdapter {
	readonly type = "loki";

	private get baseUrl(): string {
		return String(this.descriptor.settings.url || "").replace(/\/$/, "");
	}
	private get networkOpts() {
		return selfHostedNetworkOptions(this.descriptor.settings);
	}
	private get baseSelector(): string {
		return (
			(this.descriptor.settings.logQL as string) ||
			`{service_name=~".+"}`
		);
	}

	private async authHeaders() {
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId
		);
		return {
			headers: applyHttpAuthCredentials(secret.credentials, {
				tenantHeader: "X-Scope-OrgID",
			}),
			redact: redactableSecretValues(secret),
		};
	}

	capabilities(): SourceCapabilities {
		return {
			signals: ["logs"],
			traceTree: false,
			spanEvents: false,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		try {
			const { headers, redact } = await this.authHeaders();
			await safeFetch(`${this.baseUrl}/loki/api/v1/labels`, {
				headers,
				...this.networkOpts,
				redactValues: redact,
				timeoutMs: 8000,
			});
			return { ok: true };
		} catch (err) {
			return { ok: false, message: String((err as Error)?.message || err) };
		}
	}

	async listLogs(query: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		const start = Date.now();
		const { headers, redact } = await this.authHeaders();
		const expr =
			query.aiSelector !== false
				? `${this.baseSelector} | json | gen_ai_operation_name != "" or coding_agent_session_id != ""`
				: this.baseSelector;
		const url = new URL(`${this.baseUrl}/loki/api/v1/query_range`);
		url.searchParams.set("query", expr);
		url.searchParams.set("start", `${query.timeRange.start.getTime()}000000`);
		url.searchParams.set("end", `${query.timeRange.end.getTime()}000000`);
		const effectiveLimit = Math.min(query.limit || 100, 5000);
		url.searchParams.set("limit", String(effectiveLimit));
		url.searchParams.set("direction", "backward");

		const key = cacheKey(this.descriptor.id, ["logs", url.toString()]);
		const response = await cachedQuery(key, TTL_MS, () =>
			safeFetch<{
				data?: {
					result?: {
						stream?: Record<string, string>;
						values?: [string, string][];
					}[];
				};
			}>(url.toString(), {
				headers: { ...headers, "X-Query-Tags": "source=openlit,type=logs" },
				...this.networkOpts,
				redactValues: redact,
				concurrencyKey: this.descriptor.id,
				retry: true,
				timeoutMs: 20_000,
			})
		);

		const rows: NormalizedLog[] = [];
		for (const stream of response?.data?.result || []) {
			const labels = stream.stream || {};
			for (const [tsNano, line] of stream.values || []) {
				rows.push({
					timestamp: new Date(Number(tsNano) / 1e6).toISOString(),
					body: line,
					serviceName: labels.service_name || labels.service || undefined,
					severityText: labels.level || labels.severity || undefined,
					logAttributes: labels,
					resourceAttributes: {},
				});
			}
		}
		return {
			fields: [],
			rows,
			meta: {
				latencyMs: Date.now() - start,
				truncated: rows.length >= effectiveLimit,
				freshness: "live",
			},
		};
	}
}

export const lokiAdapterFactory = {
	type: "loki",
	create: (descriptor: TelemetrySourceDescriptor) => new LokiAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "loki",
		displayName: "Grafana Loki",
		declaredSignals: ["logs"],
		capabilities: {
			traceTree: false,
			spanEvents: false,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: {
			crossSignal: true,
			keys: ["traceId", "service"],
		},
		configFields: httpVendorFields({
			placeholder: "https://logs-prod-xxx.grafana.net",
			tenant: true,
		}),
		authStyle: "http",
		authHelp: getMessage().DATA_SOURCE_AUTH_HELP_HTTP,
	}),
};
