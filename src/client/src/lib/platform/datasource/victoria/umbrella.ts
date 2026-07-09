/**
 * Victoria stack umbrella adapter.
 *
 * VictoriaMetrics speaks the Prometheus HTTP API, so metrics reuse the
 * `PrometheusAdapter`; logs go to VictoriaLogs (LogsQL). Configured via
 *   { metrics: {url}, logs: {url} }
 * Capability is the union of whichever sub-sources are present. Victoria has
 * no traces product here, so trace surfaces are unsupported (gated by
 * capabilities()).
 */

import { BaseExternalAdapter } from "../base-adapter";
import type {
	DataFrame,
	HealthCheckResult,
	NormalizedLog,
	NormalizedMetricPoint,
	OpenLITQuery,
	QueryTimeRange,
	SourceCapabilities,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { PrometheusAdapter } from "../grafana/prometheus";
import { VictoriaLogsAdapter } from "./logs";

function subDescriptor(
	parent: TelemetrySourceDescriptor,
	key: string,
	sub: Record<string, unknown> | undefined
): TelemetrySourceDescriptor | undefined {
	if (!sub || !sub.url) return undefined;
	return { ...parent, id: `${parent.id}:${key}`, type: key, settings: sub };
}

export class VictoriaAdapter extends BaseExternalAdapter {
	readonly type = "victoria";
	private readonly metrics?: PrometheusAdapter;
	private readonly logs?: VictoriaLogsAdapter;

	constructor(descriptor: TelemetrySourceDescriptor) {
		super(descriptor);
		const metricsD = subDescriptor(
			descriptor,
			"victoriametrics",
			descriptor.settings.metrics as Record<string, unknown>
		);
		const logsD = subDescriptor(
			descriptor,
			"victorialogs",
			descriptor.settings.logs as Record<string, unknown>
		);
		if (metricsD) this.metrics = new PrometheusAdapter(metricsD, "victoriametrics");
		if (logsD) this.logs = new VictoriaLogsAdapter(logsD);
	}

	capabilities(): SourceCapabilities {
		const signals: SourceCapabilities["signals"] = [];
		if (this.metrics) signals.push("metrics");
		if (this.logs) signals.push("logs");
		return {
			signals,
			traceTree: false,
			spanEvents: false,
			serverAggregation: !!this.metrics,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		const subs = [this.metrics, this.logs].filter(Boolean);
		if (subs.length === 0) return { ok: false, message: "No sub-sources configured" };
		const results = await Promise.all(subs.map((s) => s!.healthCheck()));
		return results.find((r) => !r.ok) || { ok: true };
	}

	private get metricsSource(): PrometheusAdapter {
		if (!this.metrics) this.unsupported("metrics");
		return this.metrics;
	}
	private get logsSource(): VictoriaLogsAdapter {
		if (!this.logs) this.unsupported("logs");
		return this.logs;
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
	async listLogs(q: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		return this.logsSource.listLogs(q);
	}
}

export const victoriaAdapterFactory = {
	type: "victoria",
	create: (descriptor: TelemetrySourceDescriptor) => new VictoriaAdapter(descriptor),
	describe: (): SourceTypeDescriptor => ({
		type: "victoria",
		displayName: "Victoria stack (logs + metrics)",
		declaredSignals: ["logs", "metrics"],
		capabilities: {
			traceTree: false,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: { crossSignal: false, keys: ["service"] },
		// Internal stack template: expands into atomic victorialogs + victoriametrics
		// rows with per-signal bindings rather than being picked directly.
		internal: true,
	}),
};

export const victoriaMetricsAdapterFactory = {
	type: "victoriametrics",
	create: (descriptor: TelemetrySourceDescriptor) =>
		new PrometheusAdapter(descriptor, "victoriametrics"),
	describe: (): SourceTypeDescriptor => ({
		type: "victoriametrics",
		displayName: "VictoriaMetrics",
		declaredSignals: ["metrics"],
		capabilities: {
			traceTree: false,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: true,
		},
		correlation: { crossSignal: false, keys: ["service"] },
	}),
};
