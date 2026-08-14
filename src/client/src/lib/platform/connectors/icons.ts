/** Local SVG brand assets for connector catalog and connected-instance views. */
const CONNECTOR_ICONS: Record<string, string> = {
	clickhouse: "/images/connectors/clickhouse.svg",
	tempo: "/images/connectors/grafana.svg",
	loki: "/images/connectors/grafana.svg",
	prometheus: "/images/connectors/grafana.svg",
	jaeger: "/images/connectors/jaeger.svg",
	mem0: "/images/connectors/mem0.svg",
	zep: "/images/connectors/zep.svg",
};

export function connectorIconPath(type: string): string | undefined {
	return CONNECTOR_ICONS[type.toLowerCase()];
}
