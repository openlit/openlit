/**
 * Minimal PostHog props for connector create + signal routing changes.
 * No secrets, endpoints, or credential fields — only product-intent metadata.
 */

export type SignalRoutingChangeKind = "bound" | "switched" | "cleared";

export const BUILTIN_ROUTING_VALUE = "builtin";

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

export function connectorCreateEventProps(input: {
	type: string;
	environment?: string;
}) {
	return {
		connector_type: input.type,
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
	return {
		signal: input.signal,
		environment: (input.environment || "production").toLowerCase(),
		change: kind,
		previous_source_id: input.previousSourceId || null,
		next_source_id: input.nextSourceId || null,
		previous_connector_type: input.previousConnectorType || null,
		next_connector_type: input.nextConnectorType || null,
	};
}
