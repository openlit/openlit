import { BaseExternalAdapter } from "@/lib/platform/connectors/datasource/base-adapter";
import {
	UnsupportedCapabilityError,
	type HealthCheckResult,
	type SourceCapabilities,
	type TelemetrySourceDescriptor,
} from "@/lib/platform/connectors/datasource/types";

class TestAdapter extends BaseExternalAdapter {
	readonly type = "test-vendor";

	capabilities(): SourceCapabilities {
		return {
			signals: ["traces"],
			traceTree: false,
			spanEvents: false,
			serverAggregation: false,
			spanMutation: false,
			distinctValues: false,
			crossTraceSession: false,
			rawQuery: false,
		};
	}

	async healthCheck(): Promise<HealthCheckResult> {
		return { ok: true };
	}
}

const descriptor: TelemetrySourceDescriptor = {
	type: "test-vendor",
	id: "conn-1",
	isBuiltIn: false,
	settings: {},
	signals: ["traces"],
	name: "Test Vendor",
};

const window = {
	start: new Date("2026-07-01T00:00:00.000Z"),
	end: new Date("2026-07-02T00:00:00.000Z"),
};

const baseQuery = {
	signal: "traces" as const,
	timeRange: window,
};

describe("BaseExternalAdapter", () => {
	let adapter: TestAdapter;

	beforeEach(() => {
		adapter = new TestAdapter(descriptor);
	});

	it("exposes the descriptor id as the sample cache key", () => {
		expect(adapter.sampleCacheKey).toBe("conn-1");
	});

	it("implements capabilities() and healthCheck() per subclass", async () => {
		expect(adapter.capabilities().signals).toEqual(["traces"]);
		expect(await adapter.healthCheck()).toEqual({ ok: true });
	});

	const unsupportedCases: Array<{
		name: string;
		invoke: () => Promise<unknown>;
	}> = [
		{
			name: "validateAISignal",
			invoke: () => adapter.validateAISignal(window),
		},
		{ name: "listSpans", invoke: () => adapter.listSpans(baseQuery) },
		{ name: "getSpan", invoke: () => adapter.getSpan("span-1") },
		{ name: "getTraceSpans", invoke: () => adapter.getTraceSpans("trace-1") },
		{
			name: "getSpansBySession",
			invoke: () => adapter.getSpansBySession("session-1"),
		},
		{ name: "aggregateSpans", invoke: () => adapter.aggregateSpans(baseQuery) },
		{ name: "spanTimeSeries", invoke: () => adapter.spanTimeSeries(baseQuery) },
		{
			name: "distinctValues",
			invoke: () => adapter.distinctValues("service.name", baseQuery),
		},
		{
			name: "attributeKeys",
			invoke: () => adapter.attributeKeys("traces", window),
		},
		{ name: "listLogs", invoke: () => adapter.listLogs(baseQuery) },
		{ name: "getLog", invoke: () => adapter.getLog("log-1") },
		{ name: "logTimeSeries", invoke: () => adapter.logTimeSeries(baseQuery) },
		{
			name: "listMetricSeries",
			invoke: () => adapter.listMetricSeries(baseQuery),
		},
		{
			name: "metricTimeSeries",
			invoke: () => adapter.metricTimeSeries(baseQuery),
		},
		{ name: "metricNames", invoke: () => adapter.metricNames(window) },
		{
			name: "discoverServices",
			invoke: () => adapter.discoverServices(window),
		},
		{
			name: "aggregateByService",
			invoke: () => adapter.aggregateByService(window),
		},
		{
			name: "sampleTracesForGraph",
			invoke: () => adapter.sampleTracesForGraph(baseQuery, 10),
		},
	];

	it.each(unsupportedCases)(
		"$name throws UnsupportedCapabilityError naming the capability and source type",
		async ({ name, invoke }) => {
			await expect(invoke()).rejects.toThrow(UnsupportedCapabilityError);
			await expect(invoke()).rejects.toMatchObject({
				capability: name,
				sourceType: "test-vendor",
				message: `Capability "${name}" is not supported by data source "test-vendor".`,
			});
		}
	);

	it("getLog accepts optional lookup options without changing default behavior", async () => {
		await expect(
			adapter.getLog("log-1", {
				aroundTimestamp: "2026-07-01T00:00:00.000Z",
				timeRange: window,
			})
		).rejects.toThrow(UnsupportedCapabilityError);
	});

	it("UnsupportedCapabilityError supports a custom message override", () => {
		const err = new UnsupportedCapabilityError("vendor-x", "rawQuery", "nope");
		expect(err.message).toBe("nope");
		expect(err.name).toBe("UnsupportedCapabilityError");
		expect(err.capability).toBe("rawQuery");
		expect(err.sourceType).toBe("vendor-x");
	});
});
