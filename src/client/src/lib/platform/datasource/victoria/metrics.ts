/**
 * VictoriaMetrics adapter factory.
 *
 * VictoriaMetrics speaks the Prometheus HTTP API, so the runtime adapter is
 * `PrometheusAdapter` with type `victoriametrics`.
 */

import type {
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "../types";
import { PrometheusAdapter } from "../grafana/prometheus";

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
			rawQuery: false,
		},
		correlation: { crossSignal: false, keys: ["service"] },
	}),
};
