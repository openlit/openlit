import {
	BUILTIN_ROUTING_VALUE,
	classifySignalRoutingChange,
	connectorCreateEventProps,
	signalRoutingChangedEventProps,
} from "@/helpers/client/connector-analytics";

describe("connector analytics helpers", () => {
	it("classifies first bind, switch, and clear", () => {
		expect(classifySignalRoutingChange(null, "src-1")).toBe("bound");
		expect(classifySignalRoutingChange("src-1", "src-2")).toBe("switched");
		expect(classifySignalRoutingChange("src-1", BUILTIN_ROUTING_VALUE)).toBe(
			"cleared"
		);
		expect(classifySignalRoutingChange("src-1", "")).toBe("cleared");
	});

	it("treats rebinding the same source as bound (idempotent)", () => {
		expect(classifySignalRoutingChange("src-1", "src-1")).toBe("bound");
	});

	it("builds connector create props without secrets", () => {
		expect(
			connectorCreateEventProps({ type: "tempo", environment: "Staging" })
		).toEqual({
			connector_type: "tempo",
			environment: "staging",
		});
	});

	it("builds signal routing change props for PostHog", () => {
		expect(
			signalRoutingChangedEventProps({
				signal: "traces",
				environment: "production",
				previousSourceId: "src-a",
				nextSourceId: "src-b",
				previousConnectorType: "tempo",
				nextConnectorType: "jaeger",
			})
		).toEqual({
			signal: "traces",
			environment: "production",
			change: "switched",
			previous_source_id: "src-a",
			next_source_id: "src-b",
			previous_connector_type: "tempo",
			next_connector_type: "jaeger",
		});
	});
});
