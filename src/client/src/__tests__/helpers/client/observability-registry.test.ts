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
		expect(traces.listUrl).toBe("/api/telemetry/trace?view=traces");
		expect(traces.summaryUrl).toBe("/api/telemetry/summary/traces?view=traces");
		expect(traces.getRowId({ spanId: "span-1" })).toBe("span-1");
		expect(traces.getDetailHref({ spanId: "span-1" }, "/agents/a?tab=monitoring")).toBe(
			"/telemetry/traces/span-1?from=%2Fagents%2Fa%3Ftab%3Dmonitoring"
		);
	});

	it("groups the traces tab through the same endpoint as the spans tab", () => {
		const traces = getSignalConfig("traces");

		expect(traces.supportGrouping).toBe(true);
		expect(traces.groupedUrl).toBe(getSignalConfig("spans").groupedUrl);
	});

	it("shows a trace's total tokens when its root span reports none", () => {
		const { normalize } = getSignalConfig("traces");
		const root = { SpanId: "root-1", SpanAttributes: {}, SpanCount: "4", TraceTokens: "14350" };

		expect(normalize!(root)).toMatchObject({ totalTokens: 14350, spanCount: 4 });
	});

	it("keeps the root span's own tokens over the trace total", () => {
		const { normalize } = getSignalConfig("traces");
		const root = {
			SpanId: "root-1",
			SpanAttributes: { "gen_ai.usage.total_tokens": "300" },
			TraceTokens: "600",
		};

		expect(normalize!(root).totalTokens).toBe(300);
	});

	it("leaves tokens empty when no span in the trace reports any", () => {
		const { normalize } = getSignalConfig("traces");
		const root = { SpanId: "root-1", SpanAttributes: {}, TraceTokens: "0" };

		expect(normalize!(root).totalTokens).not.toBe(0);
	});

	it("keeps the existing span list as a separate signal", () => {
		const spans = getSignalConfig("spans");

		expect(spans.key).toBe("spans");
		expect(spans.listUrl).toBe("/api/telemetry/trace");
		expect(spans.supportGrouping).toBe(true);
	});

	it("keeps every signal key unique", () => {
		const keys = OBSERVABILITY_SIGNALS.map((signal) => signal.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
