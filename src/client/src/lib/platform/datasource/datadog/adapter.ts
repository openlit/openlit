/**
 * Datadog DataSourceAdapter.
 *
 * Reads AI telemetry from Datadog via the Spans (`/api/v2/spans/events`),
 * Aggregate Spans (`/api/v2/spans/analytics/aggregate`), Logs
 * (`/api/v2/logs/events/search`) and Metrics (`/api/v1/query`) APIs. The AI
 * selector is always pushed down. Because Datadog rate-limits the spans
 * endpoint hard (~300 req/hr), every read goes through the per-source query
 * cache and summaries prefer the aggregate endpoint. Datadog does not expose
 * OTel span events and cannot mutate spans, so `spanEvents`/`spanMutation` are
 * false and cost is surfaced as reported by the source (read-only).
 */

import { BaseExternalAdapter } from "../base-adapter";
import type {
	AISignalValidation,
	DataFrame,
	DiscoveredService,
	HealthCheckResult,
	NormalizedLog,
	NormalizedSpan,
	OpenLITQuery,
	QueryTimeRange,
	ServiceRollup,
	SourceCapabilities,
	SourceTypeDescriptor,
} from "../types";
import { safeFetch } from "../http/safe-fetch";
import { cacheKey, cachedQuery } from "../http/cache";
import { resolveSourceSecret, redactableSecretValues } from "../http/secret";
import { datadogAISelectorQuery } from "./selector";

const SPANS_CACHE_TTL_MS = 30_000;

interface DatadogSpanAttributes {
	custom?: Record<string, unknown>;
	service?: string;
	resource_name?: string;
	operation_name?: string;
	trace_id?: string;
	span_id?: string;
	parent_id?: string;
	start_timestamp?: string;
	duration?: number;
	status?: string;
	[k: string]: unknown;
}

interface DatadogSpanEvent {
	id?: string;
	attributes?: DatadogSpanAttributes;
}

export class DatadogAdapter extends BaseExternalAdapter {
	readonly type = "datadog";

	private get site(): string {
		return (this.descriptor.settings.site as string) || "datadoghq.com";
	}

	private get baseUrl(): string {
		return `https://api.${this.site}`;
	}

	private async authHeaders(): Promise<{
		headers: Record<string, string>;
		redact: string[];
	}> {
		const secret = await resolveSourceSecret(
			this.descriptor.secretRef,
			this.descriptor.dbConfigId
		);
		const apiKey = secret.credentials.apiKey || secret.raw;
		const appKey = secret.credentials.appKey || "";
		return {
			headers: {
				"Content-Type": "application/json",
				"DD-API-KEY": apiKey,
				"DD-APPLICATION-KEY": appKey,
			},
			redact: redactableSecretValues(secret),
		};
	}

	capabilities(): SourceCapabilities {
		return {
			signals: this.descriptor.signals,
			traceTree: true,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const start = Date.now();
		try {
			const { headers, redact } = await this.authHeaders();
			await safeFetch(`${this.baseUrl}/api/v1/validate`, {
				headers,
				redactValues: redact,
				timeoutMs: 8000,
			});
			return { ok: true, latencyMs: Date.now() - start };
		} catch (err) {
			return {
				ok: false,
				message: String((err as Error)?.message || err),
				latencyMs: Date.now() - start,
			};
		}
	}

	async validateAISignal(window: QueryTimeRange): Promise<AISignalValidation> {
		try {
			const frame = await this.listSpans({
				signal: "traces",
				timeRange: window,
				limit: 1,
				aiSelector: true,
			});
			const count = frame.rows.length;
			return {
				ok: count > 0,
				sampleCount: count,
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

	private buildQueryString(query: OpenLITQuery): string {
		const parts: string[] = [];
		if (query.aiSelector !== false) parts.push(datadogAISelectorQuery());
		for (const f of query.filters || []) {
			if (f.target === "attribute" && f.key && f.op === "eq") {
				const prefix = f.scope === "resource" ? "" : "@";
				parts.push(`${prefix}${f.key}:${String(f.value)}`);
			}
		}
		return parts.filter(Boolean).join(" AND ");
	}

	private async searchSpans(
		query: OpenLITQuery,
		extraFilter?: string
	): Promise<DatadogSpanEvent[]> {
		const { headers, redact } = await this.authHeaders();
		const filterQuery = [this.buildQueryString(query), extraFilter]
			.filter(Boolean)
			.join(" AND ");
		const body = {
			data: {
				type: "search_request",
				attributes: {
					filter: {
						query: filterQuery,
						from: query.timeRange.start.toISOString(),
						to: query.timeRange.end.toISOString(),
					},
					sort: "-timestamp",
					page: { limit: Math.min(query.limit || 100, 1000) },
				},
			},
		};
		const key = cacheKey(this.descriptor.id, ["spans", body]);
		const response = await cachedQuery(key, SPANS_CACHE_TTL_MS, () =>
			safeFetch<{ data?: DatadogSpanEvent[] }>(
				`${this.baseUrl}/api/v2/spans/events/search`,
				{
					method: "POST",
					headers,
					body: JSON.stringify(body),
					redactValues: redact,
					concurrencyKey: this.descriptor.id,
					maxConcurrent: 2,
					retry: true,
				}
			)
		);
		return response?.data || [];
	}

	private normalizeDDSpan(ev: DatadogSpanEvent): NormalizedSpan {
		const a = ev.attributes || {};
		const custom = (a.custom || {}) as Record<string, unknown>;
		const spanAttributes: Record<string, string> = {};
		const resourceAttributes: Record<string, string> = {};
		for (const [k, v] of Object.entries(custom)) {
			// Datadog nests OTel resource attrs under custom as well; route the
			// known resource identity keys to resourceAttributes.
			if (
				k.startsWith("telemetry.") ||
				k.startsWith("service.") ||
				k.startsWith("deployment.") ||
				k.startsWith("k8s.") ||
				k === "coding_agent.agent.parent_id"
			) {
				resourceAttributes[k] = String(v);
			} else {
				spanAttributes[k] = String(v);
			}
		}
		if (a.service) resourceAttributes["service.name"] = String(a.service);
		const durationNs = Number(a.duration) || 0;
		const costStr = spanAttributes["gen_ai.usage.cost"];
		return {
			traceId: String(a.trace_id || ""),
			spanId: String(a.span_id || ev.id || ""),
			parentSpanId: String(a.parent_id || ""),
			name: String(a.operation_name || a.resource_name || ""),
			serviceName: String(a.service || resourceAttributes["service.name"] || ""),
			timestamp: String(a.start_timestamp || ""),
			durationNs,
			statusCode: String(a.status || ""),
			spanAttributes,
			resourceAttributes,
			events: [],
			cost: costStr !== undefined ? Number(costStr) || 0 : undefined,
		};
	}

	async listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		const start = Date.now();
		const events = await this.searchSpans(query);
		const rows = events.map((e) => this.normalizeDDSpan(e));
		return {
			fields: [],
			rows,
			meta: { latencyMs: Date.now() - start, rowsScanned: rows.length },
		};
	}

	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		const now = new Date();
		const events = await this.searchSpans(
			{
				signal: "traces",
				timeRange: { start: new Date(now.getTime() - 30 * 864e5), end: now },
				limit: 1,
				aiSelector: false,
			},
			`span_id:${spanId}`
		);
		return events[0] ? this.normalizeDDSpan(events[0]) : null;
	}

	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		const now = new Date();
		const events = await this.searchSpans(
			{
				signal: "traces",
				timeRange: { start: new Date(now.getTime() - 30 * 864e5), end: now },
				limit: 1000,
				aiSelector: false,
			},
			`trace_id:${traceId}`
		);
		return events.map((e) => this.normalizeDDSpan(e));
	}

	async aggregateSpans(query: OpenLITQuery): Promise<DataFrame> {
		const start = Date.now();
		const { headers, redact } = await this.authHeaders();
		const compute = (query.aggregations || [{ fn: "count" as const }]).map(
			(a) => {
				if (a.fn === "count") return { aggregation: "count", type: "total" };
				const metric = a.field ? `@${a.field}` : undefined;
				const map: Record<string, string> = {
					sum: "sum",
					avg: "avg",
					min: "min",
					max: "max",
					p50: "pc50",
					p90: "pc90",
					p95: "pc95",
					p99: "pc99",
					cardinality: "cardinality",
				};
				return { aggregation: map[a.fn] || "count", metric, type: "total" };
			}
		);
		const groupBy = (query.groupBy || []).map((g) => ({
			facet: g.includes(".") ? `@${g}` : g,
			limit: 100,
		}));
		const body = {
			data: {
				type: "aggregate_request",
				attributes: {
					filter: {
						query: this.buildQueryString(query),
						from: query.timeRange.start.toISOString(),
						to: query.timeRange.end.toISOString(),
					},
					compute,
					group_by: groupBy,
				},
			},
		};
		const key = cacheKey(this.descriptor.id, ["aggregate", body]);
		const response = await cachedQuery(key, SPANS_CACHE_TTL_MS, () =>
			safeFetch<{ data?: { buckets?: unknown[] } }>(
				`${this.baseUrl}/api/v2/spans/analytics/aggregate`,
				{
					method: "POST",
					headers,
					body: JSON.stringify(body),
					redactValues: redact,
					concurrencyKey: this.descriptor.id,
					maxConcurrent: 2,
					retry: true,
				}
			)
		);
		const buckets = (response?.data?.buckets as
			| { by?: Record<string, unknown>; computes?: Record<string, unknown> }[]
			| undefined) || [];
		const rows = buckets.map((b) => ({ ...(b.by || {}), ...(b.computes || {}) }));
		return { fields: [], rows, meta: { latencyMs: Date.now() - start } };
	}

	async spanTimeSeries(query: OpenLITQuery): Promise<DataFrame> {
		// Aggregate with an implicit time bucket via group_by on timestamp is not
		// exposed the same way; delegate to aggregateSpans for totals. The chart
		// surfaces bucket via the aggregate timeseries type when interval is set.
		return this.aggregateSpans(query);
	}

	async listLogs(query: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		const start = Date.now();
		const { headers, redact } = await this.authHeaders();
		const body = {
			filter: {
				query: this.buildQueryString({ ...query, aiSelector: false }),
				from: query.timeRange.start.toISOString(),
				to: query.timeRange.end.toISOString(),
			},
			sort: "-timestamp",
			page: { limit: Math.min(query.limit || 100, 1000) },
		};
		const key = cacheKey(this.descriptor.id, ["logs", body]);
		const response = await cachedQuery(key, SPANS_CACHE_TTL_MS, () =>
			safeFetch<{ data?: { attributes?: Record<string, unknown> }[] }>(
				`${this.baseUrl}/api/v2/logs/events/search`,
				{
					method: "POST",
					headers,
					body: JSON.stringify(body),
					redactValues: redact,
					concurrencyKey: this.descriptor.id,
					maxConcurrent: 2,
					retry: true,
				}
			)
		);
		const rows: NormalizedLog[] = (response?.data || []).map((d) => {
			const attrs = (d.attributes || {}) as Record<string, unknown>;
			return {
				timestamp: String(attrs.timestamp || ""),
				body: String(attrs.message || ""),
				severityText: attrs.status ? String(attrs.status) : undefined,
				serviceName: attrs.service ? String(attrs.service) : undefined,
				logAttributes: (attrs.attributes as Record<string, string>) || {},
				resourceAttributes: {},
			};
		});
		return { fields: [], rows, meta: { latencyMs: Date.now() - start } };
	}

	async listMetricSeries(query: OpenLITQuery) {
		const start = Date.now();
		const { headers, redact } = await this.authHeaders();
		const metric = query.filters?.find(
			(f) => f.target === "spanName" || f.key === "metric"
		)?.value;
		const metricName = Array.isArray(metric) ? metric[0] : metric;
		const url = new URL(`${this.baseUrl}/api/v1/query`);
		url.searchParams.set("from", String(Math.floor(query.timeRange.start.getTime() / 1000)));
		url.searchParams.set("to", String(Math.floor(query.timeRange.end.getTime() / 1000)));
		url.searchParams.set("query", String(metricName || "system.cpu.user{*}"));
		const key = cacheKey(this.descriptor.id, ["metrics", url.toString()]);
		const response = await cachedQuery(key, SPANS_CACHE_TTL_MS, () =>
			safeFetch<{ series?: { metric?: string; pointlist?: [number, number][] }[] }>(
				url.toString(),
				{
					headers,
					redactValues: redact,
					concurrencyKey: this.descriptor.id,
					maxConcurrent: 2,
					retry: true,
				}
			)
		);
		const rows = (response?.series || []).flatMap((s) =>
			(s.pointlist || []).map(([ts, value]) => ({
				metricName: s.metric || String(metricName || ""),
				timestamp: new Date(ts).toISOString(),
				value,
				attributes: {},
				resourceAttributes: {},
			}))
		);
		return { fields: [], rows, meta: { latencyMs: Date.now() - start } };
	}

	async metricTimeSeries(query: OpenLITQuery) {
		return this.listMetricSeries(query);
	}

	async discoverServices(window: QueryTimeRange): Promise<DiscoveredService[]> {
		const frame = await this.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: true,
			groupBy: ["service"],
			aggregations: [{ fn: "count", as: "count" }],
		});
		return frame.rows.map((r) => {
			const row = r as Record<string, unknown>;
			return {
				serviceName: String(row.service || ""),
				environment: "",
				clusterId: "",
			};
		});
	}

	async aggregateByService(window: QueryTimeRange): Promise<ServiceRollup[]> {
		const frame = await this.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: true,
			groupBy: ["service"],
			aggregations: [{ fn: "count", as: "count" }],
		});
		return frame.rows.map((r) => {
			const row = r as Record<string, unknown>;
			return {
				serviceName: String(row.service || ""),
				environment: "",
				clusterId: "",
				requestCount: Number(row.count) || 0,
				models: [],
				providers: [],
			};
		});
	}

	async sampleTracesForGraph(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]> {
		const listing = await this.searchSpans({
			...query,
			limit: Math.min((maxTraces || 100) * 20, 1000),
		});
		return listing.map((e) => this.normalizeDDSpan(e));
	}
}

export const datadogAdapterFactory = {
	type: "datadog",
	create: (descriptor: import("../types").TelemetrySourceDescriptor) =>
		new DatadogAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "datadog",
		displayName: "Datadog",
		declaredSignals: ["traces", "logs", "metrics"],
		capabilities: {
			traceTree: true,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: {
			crossSignal: true,
			keys: ["traceId", "spanId", "service"],
		},
	}),
};
