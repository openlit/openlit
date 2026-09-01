jest.mock("@/lib/posthog", () => ({
	__esModule: true,
	default: { fireEvent: jest.fn() },
}));

import PostHogServer from "@/lib/posthog";
import { SERVER_EVENTS } from "@/constants/events";
import {
	fireConnectorCreateTelemetry,
	fireSignalRoutingChangedTelemetry,
} from "@/helpers/server/connector-analytics";

describe("server connector analytics", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("fires connector create success with safe props", () => {
		fireConnectorCreateTelemetry({
			success: true,
			type: "tempo",
			environment: "Staging",
			startTimestamp: 1_000,
		});

		expect(PostHogServer.fireEvent).toHaveBeenCalledWith({
			event: SERVER_EVENTS.CONNECTOR_CREATE_SUCCESS,
			startTimestamp: 1_000,
			properties: {
				connector_type: "tempo",
				connector_name: "Grafana Tempo",
				environment: "staging",
			},
		});
	});

	it("fires signal routing changes", () => {
		fireSignalRoutingChangedTelemetry({
			signal: "traces",
			environment: "production",
			previousSourceId: "src-a",
			nextSourceId: "src-b",
			previousConnectorType: "tempo",
			nextConnectorType: "jaeger",
			startTimestamp: 2_000,
		});

		expect(PostHogServer.fireEvent).toHaveBeenCalledWith({
			event: SERVER_EVENTS.SIGNAL_ROUTING_CHANGED,
			startTimestamp: 2_000,
			properties: expect.objectContaining({
				signal: "traces",
				change: "switched",
				next_source_id: "src-b",
				previous_connector_name: "Grafana Tempo",
				next_connector_name: "Jaeger",
			}),
		});
	});
});
