const CONNECTOR_DESCRIPTIONS: Record<string, string> = {
	clickhouse: "ClickHouse telemetry and platform data store.",
	datadog: "Traces, logs, and metrics from Datadog.",
	tempo: "Distributed traces from Grafana Tempo.",
	loki: "Logs from Grafana Loki.",
	mimir: "Prometheus-compatible metrics from Grafana Mimir.",
	prometheus: "Metrics from a Prometheus-compatible endpoint.",
	newrelic: "Traces, logs, and metrics from New Relic.",
	jaeger: "Distributed traces from a Jaeger endpoint.",
	victorialogs: "Logs from VictoriaLogs.",
	victoriametrics: "Prometheus-compatible metrics from VictoriaMetrics.",
};

export function connectorDescription(type: string, displayName?: string): string {
	return CONNECTOR_DESCRIPTIONS[type.toLowerCase()] ||
		`${displayName || type} telemetry connector for OpenLIT.`;
}
