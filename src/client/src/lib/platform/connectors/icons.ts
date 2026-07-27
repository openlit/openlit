/** Local SVG brand assets for connector catalog and connected-instance views. */
const CONNECTOR_ICONS: Record<string, string> = {
	clickhouse: "/images/connectors/clickhouse.svg",
	datadog: "/images/connectors/datadog.svg",
	grafana: "/images/connectors/grafana.svg",
	tempo: "/images/connectors/grafana.svg",
	loki: "/images/connectors/grafana.svg",
	mimir: "/images/connectors/grafana.svg",
	prometheus: "/images/connectors/prometheus.svg",
	newrelic: "/images/connectors/newrelic.svg",
	jaeger: "/images/connectors/jaeger.svg",
	victoriametrics: "/images/connectors/victoriametrics.svg",
	victorialogs: "/images/connectors/victoriametrics.svg",
	victoria: "/images/connectors/victoriametrics.svg",
};

export function connectorIconPath(type: string): string | undefined {
	return CONNECTOR_ICONS[type.toLowerCase()];
}
