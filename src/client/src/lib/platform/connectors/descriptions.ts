const CONNECTOR_DESCRIPTIONS: Record<string, string> = {
	clickhouse: "ClickHouse telemetry and platform data store.",
	tempo: "Distributed traces from Grafana Tempo.",
	loki: "Logs from Grafana Loki.",
	prometheus: "Metrics from Prometheus or a compatible query API.",
	mimir: "Metrics from Grafana Mimir's Prometheus-compatible query API.",
	victoriametrics: "Metrics from a VictoriaMetrics Prometheus-compatible query API.",
	victorialogs: "Logs from VictoriaLogs using LogsQL.",
	victoriatraces: "Distributed traces from VictoriaTraces via the Jaeger Query API.",
	jaeger: "Distributed traces from a Jaeger endpoint.",
	claude: "Agent memory from Claude memory stores.",
	mem0: "Long-term agent memory from Mem0.",
	zep: "Session and graph memory from Zep.",
};

export function connectorDescription(type: string, displayName?: string): string {
	return CONNECTOR_DESCRIPTIONS[type.toLowerCase()] ||
		`${displayName || type} telemetry connector for OpenLIT.`;
}
