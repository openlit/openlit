/**
 * Jaeger DataSourceAdapter (traces only).
 *
 * HTTP + span normalization come from `@openplait/adapter-jaeger`. OpenLIT keeps
 * project-scoped secrets, SSRF-safe fetch, caching, AI-selector filtering, and
 * in-process L1 aggregation (Jaeger cannot aggregate server-side).
 */

import {
	JaegerAdapter as OpenPlaitJaegerAdapter,
	flattenJaegerTraces,
	type JaegerAdapterConfig,
	type JaegerNormalizedSpan,
	type JaegerTrace,
} from "@openplait/adapter-jaeger";
import { BaseExternalAdapter } from "../base-adapter";
import type {
	AISignalValidation,
	DataFrame,
	DiscoveredService,
	HealthCheckResult,
	NormalizedFilter,
	NormalizedSpan,
	OpenLITQuery,
	QueryTimeRange,
	ServiceRollup,
	Signal,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { applyHttpAuthCredentials } from "../http/auth-headers";
import { httpVendorFields } from "../config-fields";
import getMessage from "@/constants/messages";
import {
	safeFetch,
	selfHostedNetworkOptions,
	SourceResponseError,
} from "../http/safe-fetch";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";
import { spanMatchesAISelector, traceMatchesAISelector } from "../selector-match";
import {
	computeAggregateSpansL1,
	computeDistinctValuesL1,
} from "../l1-compute";
import { spanFieldValue } from "../graph/sample-aggregate";
import { mapPool } from "../graph/map-pool";

const TTL_MS = 30_000;
const MAX_SERVICES = 50;
const MAX_QUERY_SERVICES = 24;
const SERVICE_TRACE_TIMEOUT_MS = 15_000;
const SERVICE_TRACE_CONCURRENCY = 8;
const SPAN_INDEX_MAX = 5_000;
const ZERO_PARENT = new Set(["", "0".repeat(16), "0".repeat(32)]);

const spanIndexBySource = new Map<string, Map<string, NormalizedSpan>>();
const timedOutServices = new Map<string, number>();

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

function toNormalizedSpan(span: JaegerNormalizedSpan): NormalizedSpan {
	return {
		traceId: span.traceId,
		spanId: span.spanId,
		parentSpanId: span.parentSpanId,
		name: span.name,
		serviceName: span.serviceName,
		timestamp: span.timestamp,
		durationNs: span.durationNs,
		statusCode: span.statusCode,
		...(span.spanKind ? { spanKind: span.spanKind } : {}),
		spanAttributes: span.spanAttributes,
		resourceAttributes: span.resourceAttributes,
		events: span.events,
		...(span.cost !== undefined ? { cost: span.cost } : {}),
	};
}

function pickRootSpan(spans: NormalizedSpan[]): NormalizedSpan | undefined {
	if (spans.length === 0) return undefined;
	const ids = new Set(spans.map((s) => s.spanId));
	const explicit =
		spans.find((s) => ZERO_PARENT.has(s.parentSpanId || "")) ||
		spans.find((s) => s.parentSpanId && !ids.has(s.parentSpanId));
	if (explicit) return explicit;
	return [...spans].sort((a, b) => {
		const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
		const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
		return ta - tb;
	})[0];
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
			if (filter.op === "neq") return value !== String(filter.value ?? "");
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

/** Prefer explicit service.name filters so we do not fan out across every service. */
function servicesFromFilters(filters?: NormalizedFilter[]): string[] | undefined {
	if (!filters?.length) return undefined;
	const matched = new Set<string>();
	for (const filter of filters) {
		if (filter.target !== "attribute" || filter.key !== "service.name") continue;
		if (filter.op === "eq" && filter.value != null) {
			matched.add(String(filter.value));
		} else if (filter.op === "in") {
			const values = Array.isArray(filter.value)
				? filter.value
				: [filter.value];
			for (const value of values) {
				if (value != null && String(value)) matched.add(String(value));
			}
		}
	}
	return matched.size ? Array.from(matched) : undefined;
}

/** Map UI span-name filters onto Jaeger's single `operation` search param. */
function operationFromFilters(filters?: NormalizedFilter[]): string | undefined {
	if (!filters?.length) return undefined;
	for (const filter of filters) {
		if (filter.target !== "spanName") continue;
		if (filter.op === "eq" && filter.value != null && String(filter.value)) {
			return String(filter.value);
		}
		if (filter.op === "in") {
			const values = (Array.isArray(filter.value) ? filter.value : [filter.value])
				.map((value) => String(value || ""))
				.filter(Boolean);
			// Jaeger accepts one operation per search; use the first selected name.
			if (values[0]) return values[0];
		}
	}
	return undefined;
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

	/**
	 * Bind OpenPlait's Jaeger adapter to OpenLIT's guarded HTTP transport.
	 */
	private async openPlaitAdapter(): Promise<OpenPlaitJaegerAdapter> {
		const { headers, redact } = await this.authHeaders();
		const guardedFetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit
		): Promise<Response> => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			const requestHeaders = Object.fromEntries(
				new Headers(init?.headers).entries()
			);
			let payload: unknown;
			try {
				payload = await safeFetch<unknown>(url, {
					method: init?.method || "GET",
					headers: requestHeaders,
					...this.networkOpts,
					redactValues: redact,
					timeoutMs: SERVICE_TRACE_TIMEOUT_MS,
					concurrencyKey: this.descriptor.id,
					retry: true,
				});
			} catch (error) {
				if (error instanceof SourceResponseError) {
					return {
						ok: false,
						status: error.status,
						statusText: "Upstream Jaeger error",
						headers: new Headers({ "Content-Type": "text/plain" }),
						json: async () => ({ error: error.message }),
						text: async () => error.message,
					} as Response;
				}
				throw error;
			}
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Headers({ "Content-Type": "application/json" }),
				json: async () => payload,
				text: async () => JSON.stringify(payload),
			} as Response;
		}) as typeof fetch;

		const config: JaegerAdapterConfig = {
			url: this.apiBaseUrl || this.baseUrl,
			httpHeaders: headers,
			requestTimeoutMs: SERVICE_TRACE_TIMEOUT_MS,
			maxResultRows: 1_000,
			perServiceLimit: this.perServiceLimit,
			...(this.configuredServices ? { services: this.configuredServices } : {}),
		};
		return new OpenPlaitJaegerAdapter(config, { fetch: guardedFetch });
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
			// Build a probe adapter without the configured-services short-circuit so
			// Test Connection always hits Jaeger Query Service.
			const { headers, redact } = await this.authHeaders();
			const probeFetch = (async (
				input: RequestInfo | URL,
				init?: RequestInit
			): Promise<Response> => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;
				const requestHeaders = Object.fromEntries(
					new Headers(init?.headers).entries()
				);
				try {
					const payload = await safeFetch<unknown>(url, {
						method: init?.method || "GET",
						headers: requestHeaders,
						...this.networkOpts,
						redactValues: redact,
						timeoutMs: SERVICE_TRACE_TIMEOUT_MS,
						concurrencyKey: `${this.descriptor.id}:health`,
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
					if (error instanceof SourceResponseError) {
						return {
							ok: false,
							status: error.status,
							statusText: "Upstream Jaeger error",
							headers: new Headers({ "Content-Type": "text/plain" }),
							json: async () => ({ error: error.message }),
							text: async () => error.message,
						} as Response;
					}
					throw error;
				}
			}) as typeof fetch;

			const probe = new OpenPlaitJaegerAdapter(
				{
					url: this.baseUrl,
					httpHeaders: headers,
					requestTimeoutMs: SERVICE_TRACE_TIMEOUT_MS,
				},
				{ fetch: probeFetch }
			);
			const services = await probe.listServices();
			this.apiBaseUrl = probe.resolvedUrl;
			if (!services.length) {
				return {
					ok: false,
					latencyMs: Date.now() - start,
					message: "Jaeger returned no services",
				};
			}
			return { ok: true, latencyMs: Date.now() - start };
		} catch (err) {
			return { ok: false, message: String((err as Error)?.message || err) };
		}
	}

	private async listServices(): Promise<string[]> {
		if (this.configuredServices) return this.configuredServices;
		const key = cacheKey(this.descriptor.id, ["services"]);
		const services = await cachedQuery(key, TTL_MS, async () => {
			const adapter = await this.openPlaitAdapter();
			const discovered = await adapter.listServices();
			this.apiBaseUrl = adapter.resolvedUrl;
			return discovered.map(String).filter(Boolean).slice(0, MAX_SERVICES);
		});
		console.log("[jaeger] services discovered", {
			sourceId: this.descriptor.id,
			baseUrl: this.apiBaseUrl,
			count: services.length,
			configured: false,
		});
		return services;
	}

	private async fetchServiceTraces(
		service: string,
		window: QueryTimeRange,
		limit: number,
		operation?: string
	): Promise<JaegerTrace[]> {
		const key = cacheKey(this.descriptor.id, [
			"traces",
			service,
			operation || "",
			String(window.start.getTime()),
			String(window.end.getTime()),
			String(limit),
		]);
		return cachedQuery(key, TTL_MS, async () => {
			const adapter = await this.openPlaitAdapter();
			return adapter.searchTraces({
				service,
				startMs: window.start.getTime(),
				endMs: window.end.getTime(),
				limit,
				...(operation ? { operation } : {}),
			});
		});
	}

	/** GET /api/services/{service}/operations — Jaeger Search operation enum. */
	private async listOperations(service: string): Promise<string[]> {
		const key = cacheKey(this.descriptor.id, ["operations", service]);
		return cachedQuery(key, TTL_MS, async () => {
			const adapter = await this.openPlaitAdapter();
			const base = adapter.resolvedUrl.replace(/\/$/, "");
			const { headers, redact } = await this.authHeaders();
			const payload = await safeFetch<{ data?: string[] }>(
				`${base}/api/services/${encodeURIComponent(service)}/operations`,
				{
					method: "GET",
					headers: { Accept: "application/json", ...headers },
					...this.networkOpts,
					redactValues: redact,
					timeoutMs: SERVICE_TRACE_TIMEOUT_MS,
					concurrencyKey: this.descriptor.id,
					retry: true,
				}
			);
			return (payload?.data || []).map(String).filter(Boolean);
		});
	}

	private async resolveQueryServices(query: OpenLITQuery): Promise<string[]> {
		const filteredServices = servicesFromFilters(query.filters);
		const discoveredServices = filteredServices?.length
			? filteredServices
			: await this.listServices();
		return discoveredServices.slice(0, MAX_QUERY_SERVICES);
	}

	/**
	 * Search Jaeger by **trace** budget (not span count). Fat traces (1000+
	 * spans) previously filled a span budget after one Cursor session and made
	 * the Telemetry list show "1 of 1".
	 */
	private async collectTraces(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<JaegerTrace[]> {
		const services = await this.resolveQueryServices(query);
		const operation = operationFromFilters(query.filters);
		const perServiceLimit = Math.min(
			this.perServiceLimit,
			Math.max(maxTraces, 25)
		);
		console.log("[jaeger] collecting traces", {
			sourceId: this.descriptor.id,
			serviceCount: services.length,
			maxTraces,
			operation: operation || null,
			start: query.timeRange.start.toISOString(),
			end: query.timeRange.end.toISOString(),
			aiSelector: query.aiSelector !== false,
		});

		const traceBatches = await mapPool(
			services,
			SERVICE_TRACE_CONCURRENCY,
			async (service) => {
				const failureKey = `${this.descriptor.id}:${service}`;
				const retryAfter = timedOutServices.get(failureKey) || 0;
				if (retryAfter > Date.now()) {
					console.log("[jaeger] skipping recently timed out service", {
						sourceId: this.descriptor.id,
						service,
						retryAfter: new Date(retryAfter).toISOString(),
					});
					return [] as JaegerTrace[];
				}
				try {
					const traces = await this.fetchServiceTraces(
						service,
						query.timeRange,
						perServiceLimit,
						operation
					);
					console.log("[jaeger] service traces fetched", {
						sourceId: this.descriptor.id,
						service,
						traceCount: traces.length,
					});
					timedOutServices.delete(failureKey);
					return traces;
				} catch (error) {
					timedOutServices.set(failureKey, Date.now() + 30_000);
					console.log("[jaeger] service traces failed", {
						sourceId: this.descriptor.id,
						service,
						error: String((error as Error)?.message || error),
					});
					return [] as JaegerTrace[];
				}
			}
		);

		const byId = new Map<string, { trace: JaegerTrace; startMs: number }>();
		for (const trace of traceBatches.flat()) {
			const traceId = String(trace.traceID || "");
			if (!traceId || byId.has(traceId)) continue;
			const spans = flattenJaegerTraces([trace]).map(toNormalizedSpan);
			if (query.aiSelector !== false && !traceMatchesAISelector(spans)) {
				continue;
			}
			if (query.filters?.length) {
				const anyMatch = spans.some((span) =>
					spanMatchesFilters(span, query.filters)
				);
				if (!anyMatch) continue;
			}
			const root = pickRootSpan(spans);
			const startMs = root?.timestamp
				? new Date(root.timestamp).getTime()
				: Math.min(
						...spans.map((s) =>
							s.timestamp ? new Date(s.timestamp).getTime() : Date.now()
						)
					);
			byId.set(traceId, { trace, startMs: Number.isFinite(startMs) ? startMs : 0 });
		}

		const sorted = Array.from(byId.values())
			.sort((a, b) => b.startMs - a.startMs)
			.slice(0, Math.max(1, maxTraces))
			.map((entry) => entry.trace);

		console.log("[jaeger] traces collected", {
			sourceId: this.descriptor.id,
			serviceCount: services.length,
			traceCount: sorted.length,
		});
		return sorted;
	}

	private spansFromTraces(traces: JaegerTrace[]): NormalizedSpan[] {
		const spans = flattenJaegerTraces(traces).map(toNormalizedSpan);
		rememberSpans(this.descriptor.id, spans);
		return spans;
	}

	/** Legacy helper: flatten accepted traces, optionally capping total spans. */
	private async collectSpans(
		query: OpenLITQuery,
		maxSpans: number
	): Promise<NormalizedSpan[]> {
		const maxTraces = Math.min(Math.max(25, Math.ceil(maxSpans / 20)), 200);
		const traces = await this.collectTraces(query, maxTraces);
		return this.spansFromTraces(traces).slice(0, maxSpans);
	}

	/**
	 * Explore-style list: one row per Jaeger search hit (root / orphan top).
	 * Full trees load on detail via getTraceSpans.
	 */
	async listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		const start = Date.now();
		const pageSize = Math.min(query.limit || 25, 200);
		const offset = Math.max(0, query.offset || 0);
		const traces = await this.collectTraces(query, offset + pageSize);
		const roots = traces
			.map((trace) => pickRootSpan(flattenJaegerTraces([trace]).map(toNormalizedSpan)))
			.filter((span): span is NormalizedSpan => !!span);
		rememberSpans(this.descriptor.id, this.spansFromTraces(traces));
		const rows = roots.slice(offset, offset + pageSize);
		return {
			fields: [],
			rows,
			meta: {
				latencyMs: Date.now() - start,
				truncated: roots.length >= offset + pageSize,
				degraded: ["serverAggregation"],
			},
		};
	}

	async countTraces(
		query: OpenLITQuery
	): Promise<{ total: number; truncated: boolean }> {
		const traces = await this.collectTraces(query, 200);
		return { total: traces.length, truncated: traces.length >= 200 };
	}

	/**
	 * Trace-level volume series from Jaeger search hits (not child-span flood).
	 * Powers Telemetry summary bars with unique-trace counts per bucket.
	 */
	async traceTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		const start = Date.now();
		const traces = await this.collectTraces(query, 200);
		const roots = traces
			.map((trace) => pickRootSpan(flattenJaegerTraces([trace]).map(toNormalizedSpan)))
			.filter((span): span is NormalizedSpan => !!span);
		rememberSpans(this.descriptor.id, this.spansFromTraces(traces));
		const { bucketSpansByInterval } = await import("../graph/sample-aggregate");
		const frame = bucketSpansByInterval(
			roots,
			query.interval || "1h",
			query.aggregations || [{ fn: "count" }],
			query.timeRange
		);
		return {
			...frame,
			meta: {
				...frame.meta,
				latencyMs: Date.now() - start,
				freshness: "sampled",
				truncated: traces.length >= 200,
				degraded: ["serverAggregation"],
				rowsScanned: traces.length,
			},
		};
	}

	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		const key = cacheKey(this.descriptor.id, ["trace", traceId]);
		const spans = await cachedQuery(key, TTL_MS, async () => {
			const adapter = await this.openPlaitAdapter();
			const trace = await adapter.getTrace(traceId);
			if (!trace) return [] as NormalizedSpan[];
			return flattenJaegerTraces([trace]).map(toNormalizedSpan);
		});
		rememberSpans(this.descriptor.id, spans);
		return spans;
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		const indexed = spanIndexBySource.get(this.descriptor.id)?.get(spanId);
		if (indexed) return indexed;

		const end = new Date();
		const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
		const traces = await this.collectTraces(
			{ signal: "traces", timeRange: { start, end }, aiSelector: false },
			50
		);
		const rows = this.spansFromTraces(traces);
		return rows.find((span) => span.spanId === spanId) || null;
	}

	async sampleTracesForGraph(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		const traces = await this.collectTraces(
			query,
			Math.min(maxTraces || 100, 100)
		);
		// Cap flattened spans so one Cursor session cannot explode L1 memory.
		return this.spansFromTraces(traces).slice(0, 5_000);
	}

	async aggregateSpans(query: OpenLITQuery): Promise<DataFrame> {
		return computeAggregateSpansL1(this, query);
	}

	async spanTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		return this.traceTimeSeries(query);
	}

	async distinctValues(key: string, query: OpenLITQuery): Promise<string[]> {
		const normalized = key.replace(/^SpanAttributes\./, "").replace(/^ResourceAttributes\./, "");
		if (
			normalized === "SpanName" ||
			normalized === "span.name" ||
			normalized === "name"
		) {
			const services = await this.resolveQueryServices(query);
			const ops = new Set<string>();
			await mapPool(services, SERVICE_TRACE_CONCURRENCY, async (service) => {
				try {
					for (const op of await this.listOperations(service)) ops.add(op);
				} catch {
					// Fall through to L1 sample below when operations endpoint fails.
				}
			});
			if (ops.size) return Array.from(ops).sort();
		}
		if (normalized === "service.name" || normalized === "ServiceName") {
			return this.resolveQueryServices(query);
		}
		return computeDistinctValuesL1(this, key, query);
	}

	async attributeKeys(
		_signal: Signal,
		window: QueryTimeRange
	): Promise<string[]> {
		const traces = await this.collectTraces(
			{ signal: "traces", timeRange: window, aiSelector: false },
			40
		);
		const spans = this.spansFromTraces(traces).slice(0, 2_000);
		const keys = new Set<string>();
		for (const span of spans) {
			for (const key of Object.keys(span.spanAttributes || {})) keys.add(key);
			for (const key of Object.keys(span.resourceAttributes || {})) keys.add(key);
		}
		return Array.from(keys).sort();
	}

	async discoverServices(_window: QueryTimeRange): Promise<DiscoveredService[]> {
		// Application Names filter should mirror Jaeger Search's service dropdown
		// (`GET /api/services`), not a sampled AI-only subset.
		const services = await this.listServices();
		return services.map((serviceName) => ({
			serviceName,
			environment: "",
			clusterId: "",
		}));
	}

	async aggregateByService(window: QueryTimeRange): Promise<ServiceRollup[]> {
		const discovered = await this.discoverServices(window);
		const rollups: ServiceRollup[] = [];
		for (const svc of discovered) {
			const traces = await this.fetchServiceTraces(svc.serviceName, window, 20);
			const spans = flattenJaegerTraces(traces).map(toNormalizedSpan);
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
				requestCount: new Set(spans.map((s) => s.traceId).filter(Boolean)).size,
				models: Array.from(models),
				providers: Array.from(providers),
			});
		}
		return rollups;
	}

	async validateAISignal(window: QueryTimeRange): Promise<AISignalValidation> {
		try {
			const traces = await this.collectTraces(
				{ signal: "traces", timeRange: window, aiSelector: true },
				1
			);
			return {
				ok: traces.length > 0,
				sampleCount: traces.length,
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
