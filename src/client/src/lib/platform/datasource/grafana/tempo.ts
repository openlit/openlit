/**
 * Grafana Tempo adapter (traces).
 *
 * TraceQL search (`GET /api/search`) with the AI selector pushed down, plus
 * `GET /api/traces/{id}` for full spans (including events, so chat view + evals
 * work). Tempo has no server-side aggregation, so summaries and the aggregate
 * agent DAG are built in-process from a bounded sample of full traces
 * (`buildAggregateDag`); cost/token rollups are gated accordingly.
 */

import { BaseExternalAdapter } from "../base-adapter";
import type {
	AISignalValidation,
	DataFrame,
	HealthCheckResult,
	NormalizedSpan,
	OpenLITQuery,
	QueryTimeRange,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { safeFetch } from "../http/safe-fetch";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";
import { parseOtlpTrace } from "../otlp-json";
import {
	buildAITelemetrySelector,
	type AITelemetrySelector,
	type SelectorCondition,
} from "../ai-selector";

const TTL_MS = 30_000;
const MAX_TRACE_FETCH = 100;

function traceqlValue(v: string): string {
	return `"${v.replace(/"/g, '\\"')}"`;
}

function conditionToTraceQL(cond: SelectorCondition): string {
	if (cond.target === "spanName") {
		const values = Array.isArray(cond.value) ? cond.value : [cond.value || ""];
		return `(${values.map((v) => `name = ${traceqlValue(String(v))}`).join(" || ")})`;
	}
	const scope = cond.scope === "resource" ? "resource" : "span";
	const key = `${scope}.${cond.key}`;
	if (cond.op === "exists") return `${key} != ""`;
	if (cond.op === "eq") return `${key} = ${traceqlValue(String(cond.value ?? ""))}`;
	if (cond.op === "in") {
		const values = Array.isArray(cond.value) ? cond.value : [cond.value || ""];
		return `(${values.map((v) => `${key} = ${traceqlValue(String(v))}`).join(" || ")})`;
	}
	return "";
}

export function tempoAISelectorQuery(
	selector: AITelemetrySelector = buildAITelemetrySelector()
): string {
	const groups = selector.anyOf.map((p) => {
		const parts = p.allOf.map(conditionToTraceQL).filter(Boolean);
		return parts.length === 1 ? parts[0] : `(${parts.join(" && ")})`;
	});
	return `{ ${groups.join(" || ")} }`;
}

export class TempoAdapter extends BaseExternalAdapter {
	readonly type = "tempo";

	private get baseUrl(): string {
		return String(this.descriptor.settings.url || "").replace(/\/$/, "");
	}

	private get allowHttp(): boolean {
		return this.descriptor.settings.allowHttp !== false;
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
		return { headers, redact: redactableSecretValues(secret) };
	}

	capabilities(): SourceCapabilities {
		return {
			signals: ["traces"],
			traceTree: true,
			spanEvents: true,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const start = Date.now();
		try {
			const { headers, redact } = await this.authHeaders();
			await safeFetch(`${this.baseUrl}/api/echo`, {
				headers,
				allowHttp: this.allowHttp,
				redactValues: redact,
				timeoutMs: 8000,
			});
			return { ok: true, latencyMs: Date.now() - start };
		} catch (err) {
			return { ok: false, message: String((err as Error)?.message || err) };
		}
	}

	private async searchTraceIds(
		query: OpenLITQuery,
		limit: number
	): Promise<string[]> {
		const { headers, redact } = await this.authHeaders();
		const url = new URL(`${this.baseUrl}/api/search`);
		if (query.aiSelector !== false) {
			url.searchParams.set("q", tempoAISelectorQuery());
		}
		url.searchParams.set(
			"start",
			String(Math.floor(query.timeRange.start.getTime() / 1000))
		);
		url.searchParams.set(
			"end",
			String(Math.floor(query.timeRange.end.getTime() / 1000))
		);
		url.searchParams.set("limit", String(limit));
		const key = cacheKey(this.descriptor.id, ["search", url.toString()]);
		const response = await cachedQuery(key, TTL_MS, () =>
			safeFetch<{ traces?: { traceID?: string }[] }>(url.toString(), {
				headers,
				allowHttp: this.allowHttp,
				redactValues: redact,
			})
		);
		return (response?.traces || [])
			.map((t) => t.traceID)
			.filter((id): id is string => !!id);
	}

	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		const { headers, redact } = await this.authHeaders();
		const key = cacheKey(this.descriptor.id, ["trace", traceId]);
		const payload = await cachedQuery(key, TTL_MS, () =>
			safeFetch(`${this.baseUrl}/api/traces/${encodeURIComponent(traceId)}`, {
				headers,
				allowHttp: this.allowHttp,
				redactValues: redact,
			})
		);
		return parseOtlpTrace(payload);
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		// Tempo has no direct span lookup; callers use getTraceSpans. Return null
		// so surfaces fall back to the trace-level fetch.
		void spanId;
		return null;
	}

	private async fetchSampledSpans(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		const ids = await this.searchTraceIds(
			query,
			Math.min(maxTraces, MAX_TRACE_FETCH)
		);
		const all: NormalizedSpan[] = [];
		for (const id of ids) {
			const spans = await this.getTraceSpans(id);
			all.push(...spans);
		}
		return all;
	}

	async listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		const start = Date.now();
		const traceCap = Math.min(query.limit || 20, MAX_TRACE_FETCH);
		const rows = await this.fetchSampledSpans(query, traceCap);
		return {
			fields: [],
			rows,
			meta: {
				latencyMs: Date.now() - start,
				rowsScanned: rows.length,
				degraded: ["serverAggregation"],
			},
		};
	}

	async sampleTracesForGraph(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		return this.fetchSampledSpans(query, maxTraces);
	}

	async validateAISignal(window: QueryTimeRange): Promise<AISignalValidation> {
		try {
			const ids = await this.searchTraceIds(
				{ signal: "traces", timeRange: window, aiSelector: true },
				1
			);
			return { ok: ids.length > 0, sampleCount: ids.length, missingAttributes: [] };
		} catch (err) {
			return {
				ok: false,
				sampleCount: 0,
				missingAttributes: [],
				message: String((err as Error)?.message || err),
			};
		}
	}
}

export const tempoAdapterFactory = {
	type: "tempo",
	create: (descriptor: TelemetrySourceDescriptor) => new TempoAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "tempo",
		displayName: "Grafana Tempo",
		declaredSignals: ["traces"],
		capabilities: {
			traceTree: true,
			spanEvents: true,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: {
			crossSignal: true,
			keys: ["traceId", "spanId", "service"],
		},
	}),
};
