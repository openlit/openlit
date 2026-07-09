/**
 * Jaeger DataSourceAdapter (traces only).
 *
 * Jaeger's query API (`/api/services`, `/api/traces`, `/api/traces/{id}`) only
 * supports service/operation/tag-equality search — it cannot express the
 * OR-of-AND AI selector or any server-side aggregation. So this adapter fetches
 * a bounded sample of full traces per service and filters them in-process with
 * `traceMatchesAISelector`, then reconstructs the aggregate DAG in-process too
 * (via `buildAggregateDag` in the graph module). Jaeger keeps span logs, which
 * we map to OTel span events, so the chat view + evals work.
 */

import { BaseExternalAdapter } from "../base-adapter";
import type {
	AISignalValidation,
	DataFrame,
	DiscoveredService,
	HealthCheckResult,
	NormalizedSpan,
	NormalizedSpanEvent,
	OpenLITQuery,
	QueryTimeRange,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { safeFetch } from "../http/safe-fetch";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";
import { spanMatchesAISelector, traceMatchesAISelector } from "../selector-match";

const TTL_MS = 30_000;
const MAX_SERVICES = 50;

interface JaegerTag {
	key: string;
	type?: string;
	value: unknown;
}
interface JaegerLog {
	timestamp?: number;
	fields?: JaegerTag[];
}
interface JaegerRef {
	refType?: string;
	traceID?: string;
	spanID?: string;
}
interface JaegerSpan {
	traceID?: string;
	spanID?: string;
	operationName?: string;
	references?: JaegerRef[];
	startTime?: number;
	duration?: number;
	tags?: JaegerTag[];
	logs?: JaegerLog[];
	processID?: string;
}
interface JaegerProcess {
	serviceName?: string;
	tags?: JaegerTag[];
}
interface JaegerTrace {
	traceID?: string;
	spans?: JaegerSpan[];
	processes?: Record<string, JaegerProcess>;
}

function tagsToMap(tags?: JaegerTag[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const t of tags || []) {
		if (t.key !== undefined) out[t.key] = String(t.value);
	}
	return out;
}

export class JaegerAdapter extends BaseExternalAdapter {
	readonly type = "jaeger";

	private get baseUrl(): string {
		return String(this.descriptor.settings.url || "").replace(/\/$/, "");
	}
	private get allowHttp(): boolean {
		return this.descriptor.settings.allowHttp !== false;
	}
	private get configuredServices(): string[] | undefined {
		const s = this.descriptor.settings.services;
		return Array.isArray(s) ? s.map(String) : undefined;
	}
	private get perServiceLimit(): number {
		return Number(this.descriptor.settings.perServiceLimit) || 100;
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
			await this.listServices();
			return { ok: true, latencyMs: Date.now() - start };
		} catch (err) {
			return { ok: false, message: String((err as Error)?.message || err) };
		}
	}

	private async listServices(): Promise<string[]> {
		if (this.configuredServices) return this.configuredServices;
		const { headers, redact } = await this.authHeaders();
		const key = cacheKey(this.descriptor.id, ["services"]);
		const response = await cachedQuery(key, TTL_MS, () =>
			safeFetch<{ data?: string[] }>(`${this.baseUrl}/api/services`, {
				headers,
				allowHttp: this.allowHttp,
				redactValues: redact,
			})
		);
		return (response?.data || []).slice(0, MAX_SERVICES);
	}

	private normalizeSpan(
		span: JaegerSpan,
		processes: Record<string, JaegerProcess>
	): NormalizedSpan {
		const process = span.processID ? processes[span.processID] : undefined;
		const resourceAttributes = tagsToMap(process?.tags);
		const serviceName = process?.serviceName || resourceAttributes["service.name"] || "";
		if (serviceName) resourceAttributes["service.name"] = serviceName;
		const spanAttributes = tagsToMap(span.tags);
		const parentRef = (span.references || []).find(
			(r) => r.refType === "CHILD_OF" || r.refType === "FOLLOWS_FROM"
		);
		const events: NormalizedSpanEvent[] = (span.logs || []).map((log) => {
			const fields = tagsToMap(log.fields);
			return {
				name: fields.event || fields.name || "log",
				timestamp: log.timestamp
					? new Date(log.timestamp / 1000).toISOString()
					: undefined,
				attributes: fields,
			};
		});
		const statusCode =
			spanAttributes["otel.status_code"] ||
			(spanAttributes.error === "true" ? "STATUS_CODE_ERROR" : "");
		const costStr = spanAttributes["gen_ai.usage.cost"];
		return {
			traceId: String(span.traceID || ""),
			spanId: String(span.spanID || ""),
			parentSpanId: String(parentRef?.spanID || ""),
			name: String(span.operationName || ""),
			serviceName,
			timestamp: span.startTime
				? new Date(span.startTime / 1000).toISOString()
				: "",
			durationNs: Math.round((span.duration || 0) * 1000),
			statusCode,
			spanKind: spanAttributes["span.kind"],
			spanAttributes,
			resourceAttributes,
			events,
			cost: costStr !== undefined ? Number(costStr) || 0 : undefined,
		};
	}

	private async fetchServiceTraces(
		service: string,
		window: QueryTimeRange,
		limit: number
	): Promise<JaegerTrace[]> {
		const { headers, redact } = await this.authHeaders();
		const url = new URL(`${this.baseUrl}/api/traces`);
		url.searchParams.set("service", service);
		// Jaeger expects microseconds for start/end.
		url.searchParams.set("start", String(window.start.getTime() * 1000));
		url.searchParams.set("end", String(window.end.getTime() * 1000));
		url.searchParams.set("limit", String(limit));
		const key = cacheKey(this.descriptor.id, ["traces", url.toString()]);
		const response = await cachedQuery(key, TTL_MS, () =>
			safeFetch<{ data?: JaegerTrace[] }>(url.toString(), {
				headers,
				allowHttp: this.allowHttp,
				redactValues: redact,
			})
		);
		return response?.data || [];
	}

	/** Fetch + normalize + AI-filter spans across a bounded set of services. */
	private async collectSpans(
		query: OpenLITQuery,
		maxSpans: number
	): Promise<NormalizedSpan[]> {
		const services = await this.listServices();
		const out: NormalizedSpan[] = [];
		for (const service of services) {
			if (out.length >= maxSpans) break;
			const traces = await this.fetchServiceTraces(
				service,
				query.timeRange,
				this.perServiceLimit
			);
			for (const trace of traces) {
				const spans = (trace.spans || []).map((s) =>
					this.normalizeSpan(s, trace.processes || {})
				);
				if (query.aiSelector === false || traceMatchesAISelector(spans)) {
					out.push(...spans);
				}
				if (out.length >= maxSpans) break;
			}
		}
		return out.slice(0, maxSpans);
	}

	async listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		const start = Date.now();
		const rows = await this.collectSpans(query, query.limit || 200);
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

	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		const { headers, redact } = await this.authHeaders();
		const key = cacheKey(this.descriptor.id, ["trace", traceId]);
		const response = await cachedQuery(key, TTL_MS, () =>
			safeFetch<{ data?: JaegerTrace[] }>(
				`${this.baseUrl}/api/traces/${encodeURIComponent(traceId)}`,
				{ headers, allowHttp: this.allowHttp, redactValues: redact }
			)
		);
		const trace = response?.data?.[0];
		if (!trace) return [];
		return (trace.spans || []).map((s) =>
			this.normalizeSpan(s, trace.processes || {})
		);
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		void spanId;
		// Jaeger has no direct span lookup; callers use getTraceSpans.
		return null;
	}

	async sampleTracesForGraph(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		return this.collectSpans(query, Math.min((maxTraces || 100) * 20, 5000));
	}

	async discoverServices(window: QueryTimeRange): Promise<DiscoveredService[]> {
		const services = await this.listServices();
		const discovered: DiscoveredService[] = [];
		for (const service of services) {
			const traces = await this.fetchServiceTraces(service, window, 5);
			const spans = traces.flatMap((t) =>
				(t.spans || []).map((s) => this.normalizeSpan(s, t.processes || {}))
			);
			if (spans.some((s) => spanMatchesAISelector(s))) {
				const withSdk = spans.find((s) => s.resourceAttributes["telemetry.sdk.name"]);
				discovered.push({
					serviceName: service,
					environment: "",
					clusterId: "",
					sdkName: withSdk?.resourceAttributes["telemetry.sdk.name"],
					sdkLanguage: withSdk?.resourceAttributes["telemetry.sdk.language"],
				});
			}
		}
		return discovered;
	}

	async validateAISignal(window: QueryTimeRange): Promise<AISignalValidation> {
		try {
			const rows = await this.collectSpans(
				{ signal: "traces", timeRange: window, aiSelector: true },
				1
			);
			return {
				ok: rows.length > 0,
				sampleCount: rows.length,
				missingAttributes: [],
			};
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

export const jaegerAdapterFactory = {
	type: "jaeger",
	create: (descriptor: TelemetrySourceDescriptor) => new JaegerAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "jaeger",
		displayName: "Jaeger",
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
