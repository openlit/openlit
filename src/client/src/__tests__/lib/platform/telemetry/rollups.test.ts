const mockDataCollector = jest.fn();
const mockLogError = jest.fn();

jest.mock("@/lib/platform/common", () => ({
	intelligenceDataCollector: (...args: unknown[]) => mockDataCollector(...args),
}));

jest.mock("@/lib/platform/agents/logger", () => ({
	agentsLogger: { error: (...args: unknown[]) => mockLogError(...args) },
}));

import { materializeTelemetryRollups } from "@/lib/platform/telemetry/rollups";

const rootSpan = {
	traceId: "trace-1",
	spanId: "span-1",
	parentSpanId: "",
	name: "chat",
	serviceName: "checkout",
	timestamp: new Date().toISOString(),
	durationNs: 1_000_000_000,
	statusCode: "STATUS_CODE_OK",
	spanAttributes: {
		"gen_ai.request.model": "gpt-4o",
		"gen_ai.system": "openai",
		"gen_ai.operation.name": "chat",
		"gen_ai.usage.cost": "0.01",
		"gen_ai.usage.total_tokens": "25",
		"deployment.environment": "production",
	},
	resourceAttributes: {
		"service.name": "checkout",
		"deployment.environment": "production",
	},
};

describe("external telemetry rollup materialization", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockDataCollector.mockResolvedValue({ data: [], err: null });
	});

	it("reuses one connector sample for buckets, dimensions, and hot cache", async () => {
		const sampleTracesForGraph = jest.fn().mockResolvedValue([rootSpan]);
		const adapter = {
			sampleCacheKey: `rollup-success-${Date.now()}`,
			sampleTracesForGraph,
			discoverServices: jest
				.fn()
				.mockResolvedValue([
					{ serviceName: "checkout", environment: "production", clusterId: "default" },
				]),
		};

		const result = await materializeTelemetryRollups({
			adapter: adapter as never,
			sourceId: "tempo-1",
			dbConfigId: "db-1",
		});

		expect(sampleTracesForGraph).toHaveBeenCalledTimes(1);
		expect(result.buckets).toBeGreaterThan(0);
		expect(result.llmRows).toBe(5);
		expect(result.hotCacheRows).toBe(1);
		expect(mockDataCollector).toHaveBeenCalledTimes(7);
	});

	it("stops the cycle after one rejected connector sample", async () => {
		const sampleTracesForGraph = jest
			.fn()
			.mockRejectedValue(new Error("Tempo returned HTTP 429"));
		const adapter = {
			sampleCacheKey: `rollup-failure-${Date.now()}`,
			sampleTracesForGraph,
		};

		await expect(
			materializeTelemetryRollups({
				adapter: adapter as never,
				sourceId: "tempo-1",
				dbConfigId: "db-1",
			})
		).resolves.toEqual({ buckets: 0, llmRows: 0, hotCacheRows: 0 });

		expect(sampleTracesForGraph).toHaveBeenCalledTimes(1);
		expect(mockDataCollector).not.toHaveBeenCalled();
		expect(mockLogError).toHaveBeenCalledWith(
			"telemetry_materialization_sample_failed",
			expect.any(Object)
		);
	});
});
