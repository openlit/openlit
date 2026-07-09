/**
 * VictoriaLogs adapter (logs).
 *
 * Queries LogsQL via `GET /select/logsql/query`, which streams newline-delimited
 * JSON (one log object per line with `_time`, `_msg`, `_stream` and arbitrary
 * fields). `safeFetch` returns the raw text when the body is not a single JSON
 * document, so this adapter parses the NDJSON stream itself. AI relevance is a
 * best-effort LogsQL field-presence filter layered on a configurable base
 * query, since arbitrary OTel attributes are not always indexed.
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
import { safeFetch } from "../http/safe-fetch";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";

const TTL_MS = 30_000;
const RESERVED = new Set(["_time", "_msg", "_stream", "_stream_id"]);

export class VictoriaLogsAdapter extends BaseExternalAdapter {
	readonly type = "victorialogs";

	private get baseUrl(): string {
		return String(this.descriptor.settings.url || "").replace(/\/$/, "");
	}
	private get allowHttp(): boolean {
		return this.descriptor.settings.allowHttp !== false;
	}
	private get baseQuery(): string {
		return (this.descriptor.settings.logsQL as string) || "*";
	}

	private async authHeaders() {
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId
		);
		const headers: Record<string, string> = {};
		if (secret.credentials.token) {
			headers.Authorization = `Bearer ${secret.credentials.token}`;
		} else if (secret.credentials.username) {
			const basic = Buffer.from(
				`${secret.credentials.username}:${secret.credentials.password || ""}`
			).toString("base64");
			headers.Authorization = `Basic ${basic}`;
		}
		if (secret.credentials.tenant) {
			headers.AccountID = secret.credentials.tenant;
		}
		return { headers, redact: redactableSecretValues(secret) };
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
			await safeFetch(`${this.baseUrl}/select/logsql/query?query=*&limit=1`, {
				headers,
				allowHttp: this.allowHttp,
				redactValues: redact,
				timeoutMs: 8000,
			});
			return { ok: true };
		} catch (err) {
			return { ok: false, message: String((err as Error)?.message || err) };
		}
	}

	private buildQuery(query: OpenLITQuery): string {
		if (query.aiSelector === false) return this.baseQuery;
		// LogsQL field-presence: keep logs carrying AI identity fields.
		return `${this.baseQuery} AND ("gen_ai.operation.name":* OR "coding_agent.session.id":* OR telemetry.sdk.name:openlit)`;
	}

	async listLogs(query: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		const start = Date.now();
		const { headers, redact } = await this.authHeaders();
		const url = new URL(`${this.baseUrl}/select/logsql/query`);
		url.searchParams.set("query", this.buildQuery(query));
		url.searchParams.set("start", query.timeRange.start.toISOString());
		url.searchParams.set("end", query.timeRange.end.toISOString());
		url.searchParams.set("limit", String(Math.min(query.limit || 100, 5000)));

		const key = cacheKey(this.descriptor.id, ["logs", url.toString()]);
		const text = await cachedQuery(key, TTL_MS, () =>
			safeFetch<string>(url.toString(), {
				headers,
				allowHttp: this.allowHttp,
				redactValues: redact,
			})
		);
		const rows = parseNdjsonLogs(text);
		return { fields: [], rows, meta: { latencyMs: Date.now() - start } };
	}
}

/** Parse VictoriaLogs NDJSON (or a pre-parsed array) into normalized logs. */
export function parseNdjsonLogs(payload: unknown): NormalizedLog[] {
	let records: Record<string, unknown>[] = [];
	if (typeof payload === "string") {
		records = payload
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				try {
					return JSON.parse(line) as Record<string, unknown>;
				} catch {
					return null;
				}
			})
			.filter((r): r is Record<string, unknown> => r !== null);
	} else if (Array.isArray(payload)) {
		records = payload as Record<string, unknown>[];
	}

	return records.map((r) => {
		const logAttributes: Record<string, string> = {};
		for (const [k, v] of Object.entries(r)) {
			if (RESERVED.has(k) || v === null || v === undefined) continue;
			logAttributes[k] = String(v);
		}
		return {
			timestamp: r._time ? String(r._time) : "",
			body: String(r._msg || ""),
			serviceName:
				(r["service.name"] as string) ||
				(r.service_name as string) ||
				undefined,
			severityText:
				(r.level as string) || (r.severity as string) || undefined,
			traceId: (r["trace.id"] as string) || (r.trace_id as string) || undefined,
			spanId: (r["span.id"] as string) || (r.span_id as string) || undefined,
			logAttributes,
			resourceAttributes: {},
		};
	});
}

export const victoriaLogsAdapterFactory = {
	type: "victorialogs",
	create: (descriptor: TelemetrySourceDescriptor) =>
		new VictoriaLogsAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "victorialogs",
		displayName: "VictoriaLogs",
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
	}),
};
