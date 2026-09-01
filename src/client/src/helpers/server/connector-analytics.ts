import { SERVER_EVENTS } from "@/constants/events";
import {
	BUILTIN_ROUTING_VALUE,
	connectorCreateEventProps,
	signalRoutingChangedEventProps,
} from "@/helpers/client/connector-analytics";
import PostHogServer from "@/lib/posthog";

export function fireConnectorCreateTelemetry(input: {
	success: boolean;
	type: string;
	environment?: string;
	startTimestamp: number;
}) {
	PostHogServer.fireEvent({
		event: input.success
			? SERVER_EVENTS.CONNECTOR_CREATE_SUCCESS
			: SERVER_EVENTS.CONNECTOR_CREATE_FAILURE,
		startTimestamp: input.startTimestamp,
		properties: connectorCreateEventProps({
			type: input.type,
			environment: input.environment,
		}),
	});
}

export function fireSignalRoutingChangedTelemetry(input: {
	signal: string;
	environment?: string;
	previousSourceId?: string | null;
	nextSourceId: string;
	previousConnectorType?: string | null;
	nextConnectorType?: string | null;
	startTimestamp: number;
}) {
	PostHogServer.fireEvent({
		event: SERVER_EVENTS.SIGNAL_ROUTING_CHANGED,
		startTimestamp: input.startTimestamp,
		properties: signalRoutingChangedEventProps({
			signal: input.signal,
			environment: input.environment,
			previousSourceId: input.previousSourceId,
			nextSourceId: input.nextSourceId,
			previousConnectorType: input.previousConnectorType,
			nextConnectorType: input.nextConnectorType,
		}),
	});
}

export function clearedRoutingSourceId() {
	return BUILTIN_ROUTING_VALUE;
}
