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
	NormalizedFilter,
	NormalizedSpan,
	NormalizedSpanEvent,
	OpenLITQuery,
	QueryTimeRange,
	ServiceRollup,
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
import { spanMatchesAISelector, traceMatchesAISelector } from "../selector-match";
import {
	computeAggregateSpansL1,
	computeDistinctValuesL1,
	computeSpanTimeSeriesL1,
} from "../l1-compute";
import { spanFieldValue } from "../graph/sample-aggregate";
import { mapPool } from "../graph/map-pool";

const TTL_MS = 30_000;
const MAX_SERVICES = 50;
const SPAN_INDEX_MAX = 5_000;

const spanIndexBySource = new Map<string, Map<string, NormalizedSpan>>();

function rememberSpans(sourceId: string, spans: NormalizedSpan[]) {
	let index = spanIndexBySource.get(sourceId);
	if (!index) {
		index = new Map();
		spanIndexBySource.set(sourceId, index);
	}
	for (const span of spans) {
		if (!span.spanId) continue;
		if (index.size >= SPAN_INDEX_MAX) {
			const oldest = index.keys().next().value;
			if (oldest) index.delete(oldest);
		}
		index.set(span.spanId, span);
	}
}

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

function spanMatchesFilters(
	span: NormalizedSpan,
	filters?: NormalizedFilter[]
): boolean {
	if (!filters?.length) return true;
	return filters.every((filter) => {
		if (filter.target === "spanName") {
			const values = Array.isArray(filter.value)
				? filter.value.map(String)
				: [String(filter.value || "")];
			return values.includes(span.name);
		}
		if (filter.target === "status") {
			const values = Array.isArray(filter.value)
				? filter.value.map(String)
				: [String(filter.value || "")];
			const wantsError = values.some(
				(v) => /error/i.test(v) || v === "STATUS_CODE_ERROR"
			);
			const isError = /error/i.test(span.statusCode || "");
			return wantsError ? isError : !isError;
		}
		if (filter.target === "attribute" && filter.key) {
			const raw = spanFieldValue(span, filter.key);
			const value = raw === undefined ? undefined : String(raw);
			if (filter.op === "exists") return !!value;
			if (filter.op === "eq") return value === String(filter.value ?? "");
			if (filter.op === "in") {
				const values = Array.isArray(filter.value)
					? filter.value.map(String)
					: [String(filter.value || "")];
				return value !== undefined && values.includes(value);
			}
		}
		return true;
	});
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
	/** Jaeger already fans out `/api/traces?service=` per service. */
	readonly samplesAreServiceStratified = true;
	private apiBaseUrl = this.baseUrl;

	private get baseUrl(): string {
		return String(this.descriptor.settings.url || "").replace(/\/$/, "");
	}
	private get networkOpts() {
		return selfHostedNetworkOptions(this.descriptor.settings);
	}
	private get configuredServices(): string[] | undefined {
		const s = this.descriptor.settings.services;
		const services = Array.isArray(s) ? s.map(String).filter(Boolean) : [];
		return services.length ? services : undefined;
	}
	private get perServiceLimit(): number {
		return Number(this.descriptor.settings.perServiceLimit) || 100;
	}

	private async authHeaders() {
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId,
			this.descriptor.projectId
		);
		return {
			headers: applyHttpAuthCredentials(secret.credentials, {
				authType: this.descriptor.settings.authType as string | undefined,
			}),
			redact: redactableSecretValues(secret),
		};
	}

	capabilities(): SourceCapabilities {
		return {
			signals: ["traces"],
			traceTree: true,
			spanEvents: true,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: true,
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
		let response = await cachedQuery(key, TTL_MS, () =>
			safeFetch<{ data?: string[] }>(`${this.baseUrl}/api/services`, {
				headers,
				...this.networkOpts,
				redactValues: redact,
				concurrencyKey: this.descriptor.id,
				retry: false,
				timeoutMs: 8_000,
			})
		);
		if (typeof response === "string" && new URL(this.baseUrl).pathname === "/") {
			this.apiBaseUrl = `${this.baseUrl}/jaeger`;
			response = await safeFetch<{ data?: string[] }>(`${this.apiBaseUrl}/api/services`, {
				headers,
				...this.networkOpts,
				redactValues: redact,
				concurrencyKey: this.descriptor.id,
				retry: true,
			});
		}
		const services = (response?.data || []).map(String).filter(Boolean).slice(0, MAX_SERVICES);
		console.log("[jaeger] services discovered", {
			sourceId: this.descriptor.id,
			baseUrl: this.baseUrl,
			count: services.length,
			configured: false,
		});
		return services;
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
		const url = new URL(`${this.apiBaseUrl}/api/traces`);
		url.searchParams.set("service", service);
		// Jaeger expects microseconds for start/end.
		url.searchParams.set("start", String(window.start.getTime() * 1000));
		url.searchParams.set("end", String(window.end.getTime() * 1000));
		url.searchParams.set("limit", String(limit));
		const key = cacheKey(this.descriptor.id, ["traces", url.toString()]);
		const response = await cachedQuery(key, TTL_MS, () =>
			safeFetch<{ data?: JaegerTrace[] }>(url.toString(), {
				headers,
				...this.networkOpts,
				redactValues: redact,
				concurrencyKey: this.descriptor.id,
				retry: true,
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
		console.log("[jaeger] collecting spans", {
			sourceId: this.descriptor.id,
			serviceCount: services.length,
			start: query.timeRange.start.toISOString(),
			end: query.timeRange.end.toISOString(),
			maxSpans,
			aiSelector: query.aiSelector !== false,
		});
		const perServiceLimit = Math.min(
			this.perServiceLimit,
			Math.max(10, Math.ceil(maxSpans / Math.max(1, services.length)))
		);
		const traceBatches = await mapPool(services, 6, async (service) => {
			try {
				const traces = await this.fetchServiceTraces(
					service,
					query.timeRange,
					perServiceLimit
				);
				console.log("[jaeger] service traces fetched", {
					sourceId: this.descriptor.id,
					service,
					traceCount: traces.length,
				});
				return traces;
			} catch (error) {
				console.log("[jaeger] service traces failed", {
					sourceId: this.descriptor.id,
					service,
					error: String((error as Error)?.message || error),
				});
				return [];
			}
		});
		const out: NormalizedSpan[] = [];
		for (const trace of traceBatches.flat()) {
			if (out.length >= maxSpans) break;
			const spans = (trace.spans || []).map((s) =>
				this.normalizeSpan(s, trace.processes || {})
			);
			if (query.aiSelector === false || traceMatchesAISelector(spans)) {
				const filtered = spans.filter((s) =>
					spanMatchesFilters(s, query.filters)
				);
				out.push(...(query.filters?.length ? filtered : spans));
			}
		}
		const rows = out.slice(0, maxSpans);
		console.log("[jaeger] spans collected", {
			sourceId: this.descriptor.id,
			serviceCount: services.length,
			spanCount: rows.length,
		});
		rememberSpans(this.descriptor.id, rows);
		return rows;
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
				`${this.apiBaseUrl}/api/traces/${encodeURIComponent(traceId)}`,
				{
					headers,
					...this.networkOpts,
					redactValues: redact,
					concurrencyKey: this.descriptor.id,
					retry: false,
					timeoutMs: 8_000,
				}
			)
		);
		const trace = response?.data?.[0];
		if (!trace) return [];
		const spans = (trace.spans || []).map((s) =>
			this.normalizeSpan(s, trace.processes || {})
		);
		rememberSpans(this.descriptor.id, spans);
		return spans;
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		const indexed = spanIndexBySource.get(this.descriptor.id)?.get(spanId);
		if (indexed) return indexed;

		// Jaeger has no direct span endpoint. Search a bounded recent window so a
		// detail/evaluation request still works when it arrives in another
		// request after the list response populated no in-process index.
		const end = new Date();
		const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
		const rows = await this.collectSpans(
			{ signal: "traces", timeRange: { start, end }, aiSelector: false },
			Math.min(this.perServiceLimit * 10, 1_000)
		);
		return rows.find((span) => span.spanId === spanId) || null;
	}

	async sampleTracesForGraph(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		return this.collectSpans(query, Math.min((maxTraces || 100) * 5, 1_000));
	}

	async aggregateSpans(query: OpenLITQuery): Promise<DataFrame> {
		return computeAggregateSpansL1(this, query);
	}

	async spanTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		return computeSpanTimeSeriesL1(this, query);
	}

	async distinctValues(key: string, query: OpenLITQuery): Promise<string[]> {
		return computeDistinctValuesL1(this, key, query);
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

	async aggregateByService(window: QueryTimeRange): Promise<ServiceRollup[]> {
		const discovered = await this.discoverServices(window);
		const rollups: ServiceRollup[] = [];
		for (const svc of discovered) {
			const traces = await this.fetchServiceTraces(svc.serviceName, window, 20);
			const spans = traces.flatMap((t) =>
				(t.spans || []).map((s) => this.normalizeSpan(s, t.processes || {}))
			);
			const models = new Set<string>();
			const providers = new Set<string>();
			for (const span of spans) {
				const model = span.spanAttributes["gen_ai.request.model"];
				const provider = span.spanAttributes["gen_ai.system"];
				if (model) models.add(model);
				if (provider) providers.add(provider);
			}
			rollups.push({
				serviceName: svc.serviceName,
				environment: svc.environment || "default",
				clusterId: svc.clusterId || "default",
				requestCount: spans.length,
				models: Array.from(models),
				providers: Array.from(providers),
			});
		}
		return rollups;
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
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: {
			crossSignal: true,
			keys: ["traceId", "spanId", "service"],
		},
		configFields: httpVendorFields({
			placeholder: "https://jaeger.example.com",
		}),
		authStyle: "http",
		authHelp: getMessage().DATA_SOURCE_AUTH_HELP_HTTP,
	}),
};
