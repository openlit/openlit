import {
	OBSERVABILITY_SIGNALS,
	getSignalConfig,
} from "@/components/(playground)/observability/registry";

describe("observability signal registry", () => {
	it("uses traces as the default signal for embedded monitoring views", () => {
		expect(getSignalConfig(null).key).toBe("traces");
		expect(getSignalConfig(undefined).key).toBe("traces");
		expect(getSignalConfig("unknown").key).toBe("traces");
	});

	it("exposes a renderable traces config for agent monitoring", () => {
		const traces = getSignalConfig("traces");

		expect(traces.key).toBe("traces");
		expect(traces.listUrl).toBe("/api/metrics/request");
		expect(traces.getRowId({ spanId: "span-1" })).toBe("span-1");
		expect(traces.getDetailHref({ spanId: "span-1" }, "/agents/a?tab=monitoring")).toBe(
			"/telemetry/traces/span-1?from=%2Fagents%2Fa%3Ftab%3Dmonitoring"
		);
	});

	it("keeps every signal key unique", () => {
		const keys = OBSERVABILITY_SIGNALS.map((signal) => signal.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
