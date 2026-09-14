const mockDataCollector = jest.fn();
const mockLogError = jest.fn();

jest.mock("@/lib/platform/common", () => ({
	intelligenceDataCollector: (...args: unknown[]) => mockDataCollector(...args),
}));

jest.mock("@/lib/platform/agents/logger", () => ({
	agentsLogger: { error: (...args: unknown[]) => mockLogError(...args) },
}));

import {
	materializeTelemetryRollups,
	readLlmRollup,
	readSignalBucketRollup,
	readSpanHotCache,
	writeSpanHotCache,
	SPAN_HOT_CACHE_MAX_ROWS,
} from "@/lib/platform/telemetry/rollups";
import type { OpenLITQuery } from "@/lib/platform/connectors/datasource/types";

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

	it("falls back to an unscoped ('') service pass when no service can be discovered or sampled", async () => {
		const unnamedSpan = { ...rootSpan, serviceName: "", resourceAttributes: {} };
		const sampleTracesForGraph = jest.fn().mockResolvedValue([unnamedSpan]);
		const adapter = { sampleCacheKey: "rollup-unscoped", sampleTracesForGraph };

		const result = await materializeTelemetryRollups({
			adapter: adapter as never,
			sourceId: "tempo-1",
		});

		expect(result.buckets).toBeGreaterThan(0);
		const bucketCall = mockDataCollector.mock.calls.find((c) =>
			(c[0].query as string).includes("INSERT INTO openlit_signal_buckets")
		);
		expect(bucketCall?.[0].query).toContain("'tempo-1',\n\t\t\t\t\t\t'',");
	});

	it("logs and continues when the signal-bucket insert fails", async () => {
		mockDataCollector.mockImplementation((query: { query: string }) => {
			if (query.query.includes("INSERT INTO openlit_signal_buckets")) {
				return Promise.reject(new Error("bucket insert failed"));
			}
			return Promise.resolve({ data: [], err: null });
		});
		const sampleTracesForGraph = jest.fn().mockResolvedValue([rootSpan]);
		const adapter = { sampleCacheKey: "rollup-bucket-fail", sampleTracesForGraph };

		const result = await materializeTelemetryRollups({
			adapter: adapter as never,
			sourceId: "tempo-1",
		});

		expect(result.buckets).toBe(0);
		expect(result.llmRows).toBeGreaterThan(0);
		expect(mockLogError).toHaveBeenCalledWith(
			"telemetry_rollup_buckets_failed",
			expect.any(Object)
		);
	});

	it("logs and continues (per dimension) when an LLM rollup insert fails", async () => {
		mockDataCollector.mockImplementation((query: { query: string }) => {
			if (query.query.includes("INSERT INTO openlit_llm_rollups")) {
				return Promise.reject(new Error("llm insert failed"));
			}
			return Promise.resolve({ data: [], err: null });
		});
		const sampleTracesForGraph = jest.fn().mockResolvedValue([rootSpan]);
		const adapter = { sampleCacheKey: "rollup-llm-fail", sampleTracesForGraph };

		const result = await materializeTelemetryRollups({
			adapter: adapter as never,
			sourceId: "tempo-1",
		});

		expect(result.llmRows).toBe(0);
		expect(result.buckets).toBeGreaterThan(0);
		expect(mockLogError).toHaveBeenCalledWith(
			"telemetry_rollup_llm_failed",
			expect.objectContaining({ dimension: "model" })
		);
	});

	it("scopes buckets/dimensions per service when multiple services are sampled", async () => {
		const checkoutSpan = rootSpan;
		const billingSpan = {
			...rootSpan,
			traceId: "trace-2",
			spanId: "span-2",
			serviceName: "billing",
			resourceAttributes: { ...rootSpan.resourceAttributes, "service.name": "billing" },
		};
		const sampleTracesForGraph = jest.fn().mockResolvedValue([checkoutSpan, billingSpan]);
		const adapter = { sampleCacheKey: "rollup-multi-service", sampleTracesForGraph };

		const result = await materializeTelemetryRollups({
			adapter: adapter as never,
			sourceId: "tempo-1",
		});

		expect(result.buckets).toBeGreaterThan(0);
		expect(result.llmRows).toBeGreaterThan(0);
		const bucketCalls = mockDataCollector.mock.calls.filter((c) =>
			(c[0].query as string).includes("INSERT INTO openlit_signal_buckets")
		);
		const services = bucketCalls.map((c) => (c[0].query as string).match(/'tempo-1',\n\t*'([^']*)'/)?.[1]);
		expect(services).toEqual(expect.arrayContaining(["checkout", "billing"]));
	});

	it("logs and continues when the hot-cache write fails", async () => {
		mockDataCollector.mockImplementation((query: { query: string }) => {
			if (query.query.includes("INSERT INTO openlit_external_span_cache")) {
				return Promise.reject(new Error("hot cache write failed"));
			}
			return Promise.resolve({ data: [], err: null });
		});
		const sampleTracesForGraph = jest.fn().mockResolvedValue([rootSpan]);
		const adapter = { sampleCacheKey: "rollup-hotcache-fail", sampleTracesForGraph };

		const result = await materializeTelemetryRollups({
			adapter: adapter as never,
			sourceId: "tempo-1",
		});

		expect(result.hotCacheRows).toBe(0);
		expect(mockLogError).toHaveBeenCalledWith(
			"telemetry_hot_cache_failed",
			expect.any(Object)
		);
	});
});

function baseQuery(overrides?: Partial<OpenLITQuery>): OpenLITQuery {
	return {
		signal: "traces",
		timeRange: {
			start: new Date("2026-01-01T00:00:00.000Z"),
			end: new Date("2026-01-02T00:00:00.000Z"),
		},
		...overrides,
	};
}

describe("readSignalBucketRollup", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns null when the collector reports an error", async () => {
		mockDataCollector.mockResolvedValue({ data: null, err: "boom" });
		const result = await readSignalBucketRollup(baseQuery());
		expect(result).toBeNull();
	});

	it("returns null when data is not an array", async () => {
		mockDataCollector.mockResolvedValue({ data: { not: "an array" }, err: null });
		const result = await readSignalBucketRollup(baseQuery());
		expect(result).toBeNull();
	});

	it("returns null when data is empty", async () => {
		mockDataCollector.mockResolvedValue({ data: [], err: null });
		const result = await readSignalBucketRollup(baseQuery());
		expect(result).toBeNull();
	});

	it("returns null when no row has a finite updated_at (newest stays 0)", async () => {
		mockDataCollector.mockResolvedValue({
			data: [{ bucket: "b1", updated_at: "not-a-date" }],
			err: null,
		});
		const result = await readSignalBucketRollup(baseQuery());
		expect(result).toBeNull();
	});

	it("returns null when the freshest row is stale", async () => {
		mockDataCollector.mockResolvedValue({
			data: [{ bucket: "b1", updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }],
			err: null,
		});
		const result = await readSignalBucketRollup(baseQuery());
		expect(result).toBeNull();
	});

	it("returns a degraded frame with fresh rows, custom aggregation alias, and array/scalar filters", async () => {
		mockDataCollector.mockResolvedValue({
			data: [
				{ bucket: "b1", count: 3, updated_at: new Date().toISOString() },
				{ bucket: "b2", count: 1, updated_at: "garbage-timestamp" },
			],
			err: null,
		});
		const result = await readSignalBucketRollup(
			baseQuery({
				aggregations: [{ fn: "count", as: "requests" }],
				filters: [
					{ target: "attribute", scope: "resource", key: "service.name", op: "eq", value: ["svc-a", "svc-b"] },
					{ target: "attribute", scope: "resource", key: "deployment.environment", op: "eq", value: "production" },
					{ target: "attribute", scope: "resource", key: "deployment.environment", op: "eq", value: "" },
					{ target: "attribute", scope: "resource", key: "deployment.environment", op: "eq", value: undefined as never },
					{ target: "duration", scope: "span", op: "gt", value: 1 } as never,
				],
			}),
			{ sourceId: "tempo-1", dbConfigId: "db-9" }
		);
		expect(result).toMatchObject({ meta: { degraded: ["rollup"], freshness: "accelerated" } });
		expect(result?.rows).toHaveLength(2);
		expect(result?.rows.every((row) => !("updated_at" in (row as object)))).toBe(true);
	});

	it("returns null when the collector throws", async () => {
		mockDataCollector.mockRejectedValue(new Error("connection reset"));
		const result = await readSignalBucketRollup(baseQuery());
		expect(result).toBeNull();
	});

	it("defaults sourceId to an empty string when opts is omitted", async () => {
		mockDataCollector.mockResolvedValue({ data: [], err: null });
		await readSignalBucketRollup(baseQuery());
		const sql = mockDataCollector.mock.calls[0][0].query as string;
		expect(sql).toContain("source_id = ''");
	});
});

describe("readLlmRollup", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("defaults the dimension to the query's first groupBy entry, then to 'model'", async () => {
		mockDataCollector.mockResolvedValue({ data: [], err: null });
		await readLlmRollup(baseQuery({ groupBy: ["provider"] }));
		let sql = mockDataCollector.mock.calls[0][0].query as string;
		expect(sql).toContain("dimension = 'provider'");

		mockDataCollector.mockClear();
		await readLlmRollup(baseQuery());
		sql = mockDataCollector.mock.calls[0][0].query as string;
		expect(sql).toContain("dimension = 'model'");
	});

	it("uses the explicit opts.dimension over the query groupBy", async () => {
		mockDataCollector.mockResolvedValue({ data: [], err: null });
		await readLlmRollup(baseQuery({ groupBy: ["provider"] }), { dimension: "category" });
		const sql = mockDataCollector.mock.calls[0][0].query as string;
		expect(sql).toContain("dimension = 'category'");
	});

	it("defaults the limit to 100 when the query omits it", async () => {
		mockDataCollector.mockResolvedValue({ data: [], err: null });
		await readLlmRollup(baseQuery());
		const sql = mockDataCollector.mock.calls[0][0].query as string;
		expect(sql).toContain("LIMIT 100");
	});

	it("returns null when the collector reports an error", async () => {
		mockDataCollector.mockResolvedValue({ data: null, err: "boom" });
		expect(await readLlmRollup(baseQuery())).toBeNull();
	});

	it("returns null when data is empty", async () => {
		mockDataCollector.mockResolvedValue({ data: [], err: null });
		expect(await readLlmRollup(baseQuery())).toBeNull();
	});

	it("returns null when the freshest row is stale", async () => {
		mockDataCollector.mockResolvedValue({
			data: [{ group_value: "gpt-4o", updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }],
			err: null,
		});
		expect(await readLlmRollup(baseQuery())).toBeNull();
	});

	it("returns a degraded frame with fresh rows", async () => {
		mockDataCollector.mockResolvedValue({
			data: [{ group_value: "gpt-4o", count: 2, updated_at: new Date().toISOString() }],
			err: null,
		});
		const result = await readLlmRollup(baseQuery());
		expect(result).toMatchObject({ meta: { degraded: ["rollup"], freshness: "accelerated" } });
	});

	it("returns null when the collector throws", async () => {
		mockDataCollector.mockRejectedValue(new Error("boom"));
		expect(await readLlmRollup(baseQuery())).toBeNull();
	});
});

describe("readSpanHotCache", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns null when the collector reports an error", async () => {
		mockDataCollector.mockResolvedValue({ data: null, err: "boom" });
		const result = await readSpanHotCache(baseQuery(), { sourceId: "tempo-1" });
		expect(result).toBeNull();
	});

	it("returns null when data is empty", async () => {
		mockDataCollector.mockResolvedValue({ data: [], err: null });
		const result = await readSpanHotCache(baseQuery(), { sourceId: "tempo-1" });
		expect(result).toBeNull();
	});

	it("returns null when the freshest row is stale", async () => {
		mockDataCollector.mockResolvedValue({
			data: [{ trace_id: "t1", updated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }],
			err: null,
		});
		const result = await readSpanHotCache(baseQuery(), { sourceId: "tempo-1" });
		expect(result).toBeNull();
	});

	it("caps the limit at SPAN_HOT_CACHE_MAX_ROWS even when opts.maxRows requests more", async () => {
		mockDataCollector.mockResolvedValue({ data: [], err: null });
		await readSpanHotCache(baseQuery(), {
			sourceId: "tempo-1",
			maxRows: SPAN_HOT_CACHE_MAX_ROWS + 500,
		});
		const sql = mockDataCollector.mock.calls[0][0].query as string;
		expect(sql).toContain(`LIMIT ${SPAN_HOT_CACHE_MAX_ROWS + 1}`);
	});

	it("falls back to the query limit, then to 100, when opts.maxRows is omitted", async () => {
		mockDataCollector.mockResolvedValue({ data: [], err: null });
		await readSpanHotCache(baseQuery({ limit: 42 }), { sourceId: "tempo-1" });
		const sql = mockDataCollector.mock.calls[0][0].query as string;
		expect(sql).toContain("LIMIT 43");
	});

	it("returns fresh spans, parses attribute JSON, and reports truncation when the extra probe row exists", async () => {
		const now = new Date().toISOString();
		mockDataCollector.mockResolvedValue({
			data: [
				{
					trace_id: "t1",
					span_id: "s1",
					parent_span_id: "",
					name: "chat",
					service_name: "checkout",
					timestamp: now,
					duration_ns: 100,
					status_code: "OK",
					status_message: "",
					span_kind: "",
					span_attributes: '{"a":"b"}',
					resource_attributes: { c: "d" },
					cost: 0,
					updated_at: now,
				},
				{
					trace_id: "t2",
					span_id: "s2",
					updated_at: now,
				},
			],
			err: null,
		});
		const result = await readSpanHotCache(baseQuery({ limit: 1 }), { sourceId: "tempo-1" });
		expect(result?.truncated).toBe(true);
		expect(result?.spans).toHaveLength(1);
		expect(result?.spans[0].spanAttributes).toEqual({ a: "b" });
		expect(result?.spans[0].resourceAttributes).toEqual({ c: "d" });
	});

	it("parses malformed span_attributes JSON as an empty object", async () => {
		const now = new Date().toISOString();
		mockDataCollector.mockResolvedValue({
			data: [
				{
					trace_id: "t1",
					span_id: "s1",
					span_attributes: "{not-json",
					resource_attributes: "",
					updated_at: now,
				},
			],
			err: null,
		});
		const result = await readSpanHotCache(baseQuery({ limit: 10 }), { sourceId: "tempo-1" });
		expect(result?.spans[0].spanAttributes).toEqual({});
		expect(result?.spans[0].resourceAttributes).toEqual({});
		expect(result?.truncated).toBe(false);
	});

	it("defaults every field on a bare row and drops null attribute values", async () => {
		const now = new Date().toISOString();
		mockDataCollector.mockResolvedValue({
			data: [
				{
					updated_at: now,
					span_attributes: { a: null },
					resource_attributes: '{"b":null}',
				},
			],
			err: null,
		});
		const result = await readSpanHotCache(baseQuery({ limit: 10 }), { sourceId: "tempo-1" });
		const span = result?.spans[0];
		expect(span).toMatchObject({
			traceId: "",
			spanId: "",
			parentSpanId: "",
			name: "",
			serviceName: "",
			timestamp: "",
			durationNs: 0,
			statusCode: "",
			statusMessage: undefined,
			spanKind: undefined,
			cost: undefined,
		});
		expect(span?.spanAttributes).toEqual({ a: "" });
		expect(span?.resourceAttributes).toEqual({ b: "" });
	});

	it("returns null when the collector throws", async () => {
		mockDataCollector.mockRejectedValue(new Error("boom"));
		const result = await readSpanHotCache(baseQuery(), { sourceId: "tempo-1" });
		expect(result).toBeNull();
	});
});

describe("writeSpanHotCache", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockDataCollector.mockResolvedValue({ data: null, err: null });
	});

	it("returns 0 and skips the insert when there are no spans", async () => {
		const result = await writeSpanHotCache({ sourceId: "tempo-1", spans: [] });
		expect(result).toBe(0);
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("defaults spanAttributes/resourceAttributes to {} in the insert JSON when they are missing", async () => {
		const bareSpan = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "chat",
			serviceName: "checkout",
			timestamp: "",
			durationNs: 0,
			statusCode: "OK",
		};
		const result = await writeSpanHotCache({
			sourceId: "tempo-1",
			spans: [bareSpan as never],
		});
		expect(result).toBe(1);
		const sql = mockDataCollector.mock.calls[0][0].query as string;
		expect(sql).toContain("'{}'");
	});

	it("caps spans at SPAN_HOT_CACHE_MAX_ROWS and falls back to resource/span environment or blank", async () => {
		const spanWithResourceEnv = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "chat",
			serviceName: "checkout",
			timestamp: "",
			durationNs: 0,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: { "deployment.environment": "prod" },
		};
		const spanWithSpanAttrEnv = {
			...spanWithResourceEnv,
			spanId: "s2",
			resourceAttributes: {},
			spanAttributes: { "deployment.environment": "staging" },
		};
		const spanWithNoEnv = {
			...spanWithResourceEnv,
			spanId: "s3",
			resourceAttributes: {},
			spanAttributes: {},
		};
		const result = await writeSpanHotCache({
			sourceId: "tempo-1",
			dbConfigId: "db-1",
			spans: [spanWithResourceEnv, spanWithSpanAttrEnv, spanWithNoEnv] as never,
		});
		expect(result).toBe(3);
		const sql = mockDataCollector.mock.calls[0][0].query as string;
		expect(sql).toContain("'prod'");
		expect(sql).toContain("'staging'");
		expect(mockDataCollector.mock.calls[0][2]).toBe("db-1");
	});
});
