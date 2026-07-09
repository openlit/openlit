/**
 * Grafana / LGTM umbrella adapter.
 *
 * Fans traces out to Tempo, logs to Loki, and metrics to Mimir/Prometheus,
 * based on the source settings:
 *   { tempo: {url}, loki: {url}, metrics: {url} }
 * Capability is the union of whichever sub-sources are configured. Each
 * sub-source may carry its own credentials in the shared vault secret JSON
 * (e.g. { "tempo": {"token": "..."}, "loki": {...} }); absent that, the
 * top-level secret applies.
 */

import { BaseExternalAdapter } from "../base-adapter";
import type {
	AISignalValidation,
	DataFrame,
	HealthCheckResult,
	NormalizedLog,
	NormalizedMetricPoint,
	NormalizedSpan,
	OpenLITQuery,
	QueryTimeRange,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { TempoAdapter } from "./tempo";
import { LokiAdapter } from "./loki";
import { PrometheusAdapter } from "./prometheus";

function subDescriptor(
	parent: TelemetrySourceDescriptor,
	key: string,
	sub: Record<string, unknown> | undefined
): TelemetrySourceDescriptor | undefined {
	if (!sub || !sub.url) return undefined;
	return {
		...parent,
		id: `${parent.id}:${key}`,
		type: key,
		settings: sub,
	};
}

export class GrafanaAdapter extends BaseExternalAdapter {
	readonly type = "grafana";
	private readonly tempo?: TempoAdapter;
	private readonly loki?: LokiAdapter;
	private readonly metrics?: PrometheusAdapter;

	constructor(descriptor: TelemetrySourceDescriptor) {
		super(descriptor);
		const s = descriptor.settings;
		const tempoD = subDescriptor(descriptor, "tempo", s.tempo as Record<string, unknown>);
		const lokiD = subDescriptor(descriptor, "loki", s.loki as Record<string, unknown>);
		const metricsD = subDescriptor(
			descriptor,
			"prometheus",
			s.metrics as Record<string, unknown>
		);
		if (tempoD) this.tempo = new TempoAdapter(tempoD);
		if (lokiD) this.loki = new LokiAdapter(lokiD);
		if (metricsD) this.metrics = new PrometheusAdapter(metricsD, "prometheus");
	}

	capabilities(): SourceCapabilities {
		const signals: SourceCapabilities["signals"] = [];
		if (this.tempo) signals.push("traces");
		if (this.loki) signals.push("logs");
		if (this.metrics) signals.push("metrics");
		return {
			signals,
			traceTree: !!this.tempo,
			spanEvents: !!this.tempo,
			serverAggregation: !!this.metrics,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const subs = [this.tempo, this.loki, this.metrics].filter(Boolean);
		if (subs.length === 0) return { ok: false, message: "No sub-sources configured" };
		const results = await Promise.all(subs.map((s) => s!.healthCheck()));
		const failed = results.find((r) => !r.ok);
		return failed || { ok: true };
	}

	async validateAISignal(window: QueryTimeRange): Promise<AISignalValidation> {
		if (!this.tempo) {
			return {
				ok: false,
				sampleCount: 0,
				missingAttributes: [],
				message: "Traces (Tempo) not configured for this Grafana source",
			};
		}
		return this.tempo.validateAISignal(window);
	}

	private get traces(): TempoAdapter {
		if (!this.tempo) this.unsupported("traces");
		return this.tempo;
	}
	private get logsSource(): LokiAdapter {
		if (!this.loki) this.unsupported("logs");
		return this.loki;
	}
	private get metricsSource(): PrometheusAdapter {
		if (!this.metrics) this.unsupported("metrics");
		return this.metrics;
	}

	async listSpans(q: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		return this.traces.listSpans(q);
	}
	async getSpan(spanId: string): Promise<NormalizedSpan | null> {
		return this.traces.getSpan(spanId);
	}
	async getTraceSpans(traceId: string): Promise<NormalizedSpan[]> {
		return this.traces.getTraceSpans(traceId);
	}
	async sampleTracesForGraph(
		q: OpenLITQuery,
		max: number
	): Promise<NormalizedSpan[]> {
		return this.traces.sampleTracesForGraph(q, max);
	}
	async listLogs(q: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		return this.logsSource.listLogs(q);
	}
	async listMetricSeries(
		q: OpenLITQuery
	): Promise<DataFrame<NormalizedMetricPoint>> {
		return this.metricsSource.listMetricSeries(q);
	}
	async metricTimeSeries(
		q: OpenLITQuery
	): Promise<DataFrame<NormalizedMetricPoint>> {
		return this.metricsSource.metricTimeSeries(q);
	}
	async metricNames(window: QueryTimeRange): Promise<string[]> {
		return this.metricsSource.metricNames(window);
	}
}

export const grafanaAdapterFactory = {
	type: "grafana",
	create: (descriptor: TelemetrySourceDescriptor) => new GrafanaAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "grafana",
		displayName: "Grafana stack (Tempo + Loki + Mimir)",
		declaredSignals: ["traces", "logs", "metrics"],
		capabilities: {
			traceTree: true,
			spanEvents: true,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: { crossSignal: true, keys: ["traceId", "spanId", "service"] },
		// Internal stack template: expands into atomic tempo + loki + mimir rows
		// with per-signal bindings rather than being picked directly.
		internal: true,
	}),
};
