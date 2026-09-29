/**
 * Minimal PostHog props for connector create + signal routing changes.
 * No secrets, endpoints, or credential fields — only product-intent metadata.
 */

import { getSourceTypeDescriptor } from "@/lib/platform/connectors/datasource/registry";
import { getMemoryTypeDescriptor } from "@/lib/platform/connectors/memory/registry";

export type SignalRoutingChangeKind = "bound" | "switched" | "cleared";

export const BUILTIN_ROUTING_VALUE = "builtin";

const CONNECTOR_DISPLAY_NAMES: Record<string, string> = {
	clickhouse: "ClickHouse",
	tempo: "Grafana Tempo",
	loki: "Grafana Loki",
	prometheus: "Prometheus",
	jaeger: "Jaeger",
	claude: "Claude",
	mem0: "Mem0",
	zep: "Zep",
};

export function classifySignalRoutingChange(
	previousSourceId: string | null | undefined,
	nextSourceId: string
): SignalRoutingChangeKind {
	const next = String(nextSourceId || "").trim();
	const previous = previousSourceId ? String(previousSourceId).trim() : "";
	// Exact "builtin" is the UI sentinel used to DELETE a binding.
	if (!next || next === BUILTIN_ROUTING_VALUE) return "cleared";
	if (!previous) return "bound";
	return previous === next ? "bound" : "switched";
}

export function resolveConnectorDisplayName(
	type: string | null | undefined
): string | null {
	const slug = String(type || "").trim().toLowerCase();
	if (!slug) return null;
	const datasource = getSourceTypeDescriptor(slug);
	if (datasource?.displayName) return datasource.displayName;
	const memory = getMemoryTypeDescriptor(slug);
	if (memory?.displayName) return memory.displayName;
	return CONNECTOR_DISPLAY_NAMES[slug] || slug.charAt(0).toUpperCase() + slug.slice(1);
}

export function connectorCreateEventProps(input: {
	type: string;
	environment?: string;
}) {
	const connectorType = String(input.type || "").trim().toLowerCase() || "unknown";
	return {
		connector_type: connectorType,
		connector_name: resolveConnectorDisplayName(connectorType),
		environment: (input.environment || "production").toLowerCase(),
	};
}

export function signalRoutingChangedEventProps(input: {
	signal: string;
	environment?: string;
	previousSourceId?: string | null;
	nextSourceId: string;
	previousConnectorType?: string | null;
	nextConnectorType?: string | null;
}) {
	const kind = classifySignalRoutingChange(
		input.previousSourceId,
		input.nextSourceId
	);
	const previousConnectorType = input.previousConnectorType || null;
	const nextConnectorType = input.nextConnectorType || null;
	return {
		signal: input.signal,
		environment: (input.environment || "production").toLowerCase(),
		change: kind,
		previous_source_id: input.previousSourceId || null,
		next_source_id: input.nextSourceId || null,
		previous_connector_type: previousConnectorType,
		next_connector_type: nextConnectorType,
		previous_connector_name: resolveConnectorDisplayName(previousConnectorType),
		next_connector_name: resolveConnectorDisplayName(nextConnectorType),
	};
}
