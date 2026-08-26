const CONNECTOR_DESCRIPTIONS: Record<string, string> = {
	clickhouse: "ClickHouse telemetry and platform data store.",
	tempo: "Distributed traces from Grafana Tempo.",
	loki: "Logs from Grafana Loki.",
	prometheus: "Metrics from Prometheus or a compatible query API.",
	jaeger: "Distributed traces from a Jaeger endpoint.",
};

export function connectorDescription(type: string, displayName?: string): string {
	return CONNECTOR_DESCRIPTIONS[type.toLowerCase()] ||
		`${displayName || type} telemetry connector for OpenLIT.`;
}
