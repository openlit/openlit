/** Connector types currently exposed in the CE UI. */
export const VISIBLE_CONNECTOR_TYPES = ["clickhouse", "tempo", "loki", "prometheus", "jaeger"] as const;

export function isVisibleConnectorType(type: unknown): boolean {
	return VISIBLE_CONNECTOR_TYPES.includes(String(type) as (typeof VISIBLE_CONNECTOR_TYPES)[number]);
}
