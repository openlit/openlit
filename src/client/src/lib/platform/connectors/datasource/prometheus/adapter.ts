import { PrometheusAdapter as OpenPlaitPrometheusAdapter } from "@openplait/adapter-prometheus";
import { OpenPlaitHttpAdapter } from "../grafana/openplait-http";
import type { DataFrame, HealthCheckResult, NormalizedMetricPoint, OpenLITQuery, QueryTimeRange, Signal, SourceCapabilities, SourceTypeDescriptor, TelemetrySourceDescriptor } from "../types";
import { openPlaitFramesToRows } from "@/lib/platform/openplait/frames";
import { computeIntervalMs, clampStepMs, intervalMsToLabel, rateIntervalMs } from "../downsample";
import { httpVendorFields } from "../config-fields";
import getMessage from "@/constants/messages";

const LABELS: Record<string, string> = {
	"service.name": "service_name",
	serviceName: "service_name",
	"metric.name": "__name__",
	metricName: "__name__",
	job: "job",
	instance: "instance",
};

function escape(value: string): string {
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/[\r\n\0]/g, " ")}"`;
}

/** Escape PromQL regex metacharacters inside `=~` / `!~` matchers. */
function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelName(key: string): string {
	const mapped = LABELS[key] || key;
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(mapped)
		? mapped
		: mapped.replace(/[^A-Za-z0-9_]/g, "_");
}

function filterValues(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : [value];
	return raw
		.filter((item) => item !== undefined && item !== null && String(item) !== "")
		.map(String);
}

/** Build a PromQL label matcher, using `=~` when multiple values are selected. */
function labelMatcher(
	name: string,
	values: string[],
	op: "eq" | "neq" | "in" | "notIn" | "contains" | string | undefined
): string {
	if (values.length === 0) return "";
	if (op === "contains") {
		return `${name}=~${escape(`.*${escapeRegex(values[0])}.*`)}`;
	}
	const negative = op === "neq" || op === "notIn";
	if (values.length === 1 && op !== "in" && op !== "notIn") {
		return `${name}${negative ? "!=" : "="}${escape(values[0])}`;
	}
	return `${name}${negative ? "!~" : "=~"}${escape(
		values.map(escapeRegex).join("|")
	)}`;
}

export function prometheusSelector(query: OpenLITQuery): string {
	const matchers: string[] = [];
	for (const filter of query.filters || []) {
		if (filter.target === "spanName") {
			const matcher = labelMatcher("__name__", filterValues(filter.value), filter.op);
			if (matcher) matchers.push(matcher);
			continue;
		}
		if (filter.target !== "attribute" || !filter.key) continue;
		const matcher = labelMatcher(
			labelName(filter.key),
			filterValues(filter.value),
			filter.op
		);
		if (matcher) matchers.push(matcher);
	}
	if (!matchers.some((item) => item.startsWith("__name__"))) {
		matchers.unshift('__name__=~".+"');
	}
	return `{${matchers.join(",")}}`;
}

function selector(query: OpenLITQuery): string {
	return prometheusSelector(query);
}

export class PrometheusAdapter extends OpenPlaitHttpAdapter {
	readonly type = "prometheus";
	constructor(descriptor: TelemetrySourceDescriptor) { super(descriptor); }
	private async adapter(): Promise<OpenPlaitPrometheusAdapter> { const connection = await this.openPlaitConnection(); return new OpenPlaitPrometheusAdapter({ url: this.baseUrl, httpHeaders: connection.headers, allowNativeQueries: true, maxResultRows: this.positiveSetting("maxResultRows") || 100_000, maxSeries: this.positiveSetting("maxSeries") || 10_000, maxTimeRangeMs: this.positiveSetting("maxTimeRangeMs"), maxLookbackMs: this.positiveSetting("maxLookbackMs"), defaultStep: String(this.descriptor.settings.defaultStep || "30s") }, { fetch: connection.fetch }); }
	capabilities(): SourceCapabilities { return { signals: ["metrics"], traceTree: false, spanEvents: false, serverAggregation: true, spanMutation: false, distinctValues: true, crossTraceSession: false, maxLookbackMs: this.positiveSetting("maxLookbackMs"), maxTimeRangeMs: this.positiveSetting("maxTimeRangeMs"), rawQuery: false }; }
	async healthCheck(): Promise<HealthCheckResult> { const started = Date.now(); try { await (await this.adapter()).labelNames({ timeoutMs: 10_000 }); return { ok: true, latencyMs: Date.now() - started }; } catch (error) { return { ok: false, latencyMs: Date.now() - started, message: String((error as Error)?.message || error) }; } }
	private range(query: OpenLITQuery) { return { from: query.timeRange.start.toISOString(), to: query.timeRange.end.toISOString() }; }
	private stepLabel(query: OpenLITQuery): string {
		const rangeMs = Math.max(0, query.timeRange.end.getTime() - query.timeRange.start.getTime());
		return intervalMsToLabel(clampStepMs(rangeMs, computeIntervalMs(query)));
	}
	private async query(query: OpenLITQuery, operation: string, statement: string): Promise<DataFrame<NormalizedMetricPoint>> { const step = this.stepLabel(query); const result = await this.executeNative(await this.adapter(), { operation, kind: "PrometheusDatasource", language: "promql", statement, extension: "io.openplait.prometheus", extensionValue: { timeRange: this.range(query), step } }); const rows = openPlaitFramesToRows(result.frames).map((row) => { const labels = (row.labels || {}) as Record<string, string>; return { metricName: labels.__name__ || operation, serviceName: labels.service_name || labels.service, timestamp: String(row.timestamp), value: Number(row.value), attributes: labels, resourceAttributes: labels } satisfies NormalizedMetricPoint; }); return { fields: [{ name: "timestamp", type: "time" }, { name: "value", type: "number" }, { name: "metricName", type: "string" }, { name: "attributes", type: "map" }], rows, meta: { latencyMs: result.metadata?.executionTimeMs, freshness: "live" } }; }
	async listMetricSeries(query: OpenLITQuery) { return this.query(query, "metric-list", selector(query)); }
	async metricTimeSeries(query: OpenLITQuery) { let statement = selector(query); const aggregation = query.aggregations?.[0]; const groups = (query.groupBy || []).map(labelName); if (aggregation?.fn && ["sum", "avg", "min", "max", "count"].includes(aggregation.fn)) statement = `${aggregation.fn}${groups.length ? ` by (${groups.join(",")})` : ""} (${statement})`; if (aggregation?.fn === "count" && aggregation.field === "rate") { const rateRange = intervalMsToLabel(rateIntervalMs(computeIntervalMs(query))); statement = `sum${groups.length ? ` by (${groups.join(",")})` : ""} (rate(${selector(query)}[${rateRange}]))`; } return this.query(query, "metric-series", statement); }
	async metricNames(window: QueryTimeRange): Promise<string[]> {
		return this.discoverLabelValues("__name__", window);
	}
	async attributeKeys(signal: Signal, window: QueryTimeRange): Promise<string[]> {
		if (signal !== "metrics") return [];
		return this.discoverLabels(window);
	}
	async distinctValues(key: string, query: OpenLITQuery): Promise<string[]> {
		return this.discoverLabelValues(labelName(key), query.timeRange);
	}

	/** Prometheus label APIs accept unix-second start/end; pass the UI window. */
	private async discoverLabels(window: QueryTimeRange): Promise<string[]> {
		const connection = await this.openPlaitConnection();
		const url = new URL("api/v1/labels", `${this.baseUrl}/`);
		url.searchParams.set("start", String(Math.floor(window.start.getTime() / 1000)));
		url.searchParams.set("end", String(Math.ceil(window.end.getTime() / 1000)));
		const response = await connection.fetch(url.toString(), { headers: connection.headers });
		if (!response.ok) return [];
		const body = (await response.json()) as { data?: unknown };
		return Array.isArray(body.data)
			? body.data.filter((item): item is string => typeof item === "string")
			: [];
	}

	private async discoverLabelValues(label: string, window: QueryTimeRange): Promise<string[]> {
		const connection = await this.openPlaitConnection();
		const url = new URL(
			`api/v1/label/${encodeURIComponent(label)}/values`,
			`${this.baseUrl}/`
		);
		url.searchParams.set("start", String(Math.floor(window.start.getTime() / 1000)));
		url.searchParams.set("end", String(Math.ceil(window.end.getTime() / 1000)));
		const response = await connection.fetch(url.toString(), { headers: connection.headers });
		if (!response.ok) return [];
		const body = (await response.json()) as { data?: unknown };
		return Array.isArray(body.data)
			? body.data.filter((item): item is string => typeof item === "string")
			: [];
	}
}

export const prometheusAdapterFactory = { type: "prometheus", create: (descriptor: TelemetrySourceDescriptor) => new PrometheusAdapter(descriptor), describe: (): SourceTypeDescriptor => ({ type: "prometheus", displayName: "Prometheus", description: "Metrics from a Prometheus-compatible query API.", declaredSignals: ["metrics"], capabilities: { traceTree: false, spanEvents: false, serverAggregation: true, spanMutation: false, distinctValues: true, crossTraceSession: false, rawQuery: false }, correlation: { crossSignal: false, keys: ["service"] }, configFields: [...httpVendorFields({ placeholder: "http://localhost:9090", tenant: true }), { key: "defaultStep", label: "Default query step", kind: "text", group: "settings", placeholder: "30s", defaultValue: "30s" }, { key: "maxTimeRangeMs", label: "Maximum query range (ms)", kind: "text", group: "settings" }], authStyle: "http", authHelp: getMessage().DATA_SOURCE_AUTH_HELP_HTTP }) };
