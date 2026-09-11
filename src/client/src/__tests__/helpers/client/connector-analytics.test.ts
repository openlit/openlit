jest.mock("@/lib/platform/connectors/datasource/registry", () => ({
	getSourceTypeDescriptor: jest.fn(() => undefined),
}));

jest.mock("@/lib/platform/connectors/memory/registry", () => ({
	getMemoryTypeDescriptor: jest.fn(() => undefined),
}));

import { getSourceTypeDescriptor } from "@/lib/platform/connectors/datasource/registry";
import { getMemoryTypeDescriptor } from "@/lib/platform/connectors/memory/registry";
import {
	BUILTIN_ROUTING_VALUE,
	classifySignalRoutingChange,
	connectorCreateEventProps,
	resolveConnectorDisplayName,
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
			connector_name: "Grafana Tempo",
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
			previous_connector_name: "Grafana Tempo",
			next_connector_name: "Jaeger",
		});
	});

	it("returns null for a blank or missing connector type", () => {
		expect(resolveConnectorDisplayName(null)).toBeNull();
		expect(resolveConnectorDisplayName(undefined)).toBeNull();
		expect(resolveConnectorDisplayName("   ")).toBeNull();
	});

	it("prefers a datasource registry display name over the static map", () => {
		(getSourceTypeDescriptor as jest.Mock).mockReturnValueOnce({
			displayName: "Custom Datasource",
		});
		expect(resolveConnectorDisplayName("clickhouse")).toBe(
			"Custom Datasource"
		);
	});

	it("falls back to a memory registry display name when no datasource matches", () => {
		(getMemoryTypeDescriptor as jest.Mock).mockReturnValueOnce({
			displayName: "Custom Memory",
		});
		expect(resolveConnectorDisplayName("mem0")).toBe("Custom Memory");
	});

	it("title-cases an unknown connector slug not present in the static map", () => {
		expect(resolveConnectorDisplayName("weaviate")).toBe("Weaviate");
	});

	it("defaults connector type to 'unknown' and environment to 'production' when omitted", () => {
		expect(connectorCreateEventProps({ type: "" })).toEqual({
			connector_type: "unknown",
			connector_name: "Unknown",
			environment: "production",
		});
	});

	it("defaults optional signal routing fields when omitted", () => {
		expect(
			signalRoutingChangedEventProps({
				signal: "logs",
				nextSourceId: "",
			})
		).toEqual({
			signal: "logs",
			environment: "production",
			change: "cleared",
			previous_source_id: null,
			next_source_id: null,
			previous_connector_type: null,
			next_connector_type: null,
			previous_connector_name: null,
			next_connector_name: null,
		});
	});
});
