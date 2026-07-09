const mockDataCollector = jest.fn();
const mockGetRequests = jest.fn();
const mockGetRequestViaSpanId = jest.fn();
const mockGetAttributeKeys = jest.fn();
const mockGetLogs = jest.fn();
const mockGetLogByRowId = jest.fn();
const mockGetMetrics = jest.fn();
const mockGetMetricsConfig = jest.fn();
const mockGetLogAttributeKeys = jest.fn();
const mockGetMetricAttributeKeys = jest.fn();

jest.mock("@/lib/platform/common", () => ({
	dataCollector: (...args: unknown[]) => mockDataCollector(...args),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
	OTEL_LOGS_TABLE_NAME: "otel_logs",
}));

jest.mock("@/lib/platform/request", () => ({
	getRequests: (...args: unknown[]) => mockGetRequests(...args),
	getRequestViaSpanId: (...args: unknown[]) => mockGetRequestViaSpanId(...args),
	getAttributeKeys: (...args: unknown[]) => mockGetAttributeKeys(...args),
}));

jest.mock("@/lib/platform/observability", () => ({
	getLogs: (...args: unknown[]) => mockGetLogs(...args),
	getLogByRowId: (...args: unknown[]) => mockGetLogByRowId(...args),
	getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
	getMetricsConfig: (...args: unknown[]) => mockGetMetricsConfig(...args),
	getLogAttributeKeys: (...args: unknown[]) => mockGetLogAttributeKeys(...args),
	getMetricAttributeKeys: (...args: unknown[]) =>
		mockGetMetricAttributeKeys(...args),
}));

import { ClickHouseAdapter } from "@/lib/platform/datasource/clickhouse/adapter";
import type {
	OpenLITQuery,
	TelemetrySourceDescriptor,
} from "@/lib/platform/datasource/types";

const descriptor: TelemetrySourceDescriptor = {
	type: "clickhouse",
	id: "builtin:db-1",
	isBuiltIn: true,
	settings: {},
	dbConfigId: "db-1",
	signals: ["traces", "logs", "metrics"],
	name: "CH",
};

const adapter = new ClickHouseAdapter(descriptor);

const window = {
	start: new Date("2026-07-01T00:00:00.000Z"),
	end: new Date("2026-07-02T00:00:00.000Z"),
};

const baseQuery: OpenLITQuery = {
	signal: "traces",
	timeRange: window,
};

const rawSpan = {
	TraceId: "t1",
	SpanId: "s1",
	ParentSpanId: "p1",
	SpanName: "chat",
	ServiceName: "svc",
	Timestamp: "2026-07-01T10:00:00Z",
	Duration: 1500000,
	StatusCode: "STATUS_CODE_OK",
	SpanAttributes: { "gen_ai.usage.cost": "0.25", "gen_ai.request.model": "gpt-4" },
	ResourceAttributes: { "telemetry.sdk.name": "openlit" },
	Events: [{ Name: "gen_ai.content.prompt", Attributes: { foo: "bar" } }],
};

beforeEach(() => {
	jest.clearAllMocks();
});

describe("ClickHouseAdapter", () => {
	it("advertises the full ClickHouse capability set", () => {
		expect(adapter.capabilities()).toEqual({
			signals: ["traces", "logs", "metrics"],
			traceTree: true,
			spanEvents: true,
			serverAggregation: true,
			spanMutation: true,
			distinctValues: true,
			crossTraceSession: true,
			rawQuery: true,
		});
	});

	it("healthCheck pings the configured db config", async () => {
		mockDataCollector.mockResolvedValue({ data: true });
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(true);
		expect(mockDataCollector).toHaveBeenCalledWith({}, "ping", "db-1");
	});

	it("listSpans normalizes getRequests records into NormalizedSpan", async () => {
		mockGetRequests.mockResolvedValue({ records: [rawSpan], total: 1 });
		const frame = await adapter.listSpans({ ...baseQuery, limit: 10 });
		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0]).toMatchObject({
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "p1",
			name: "chat",
			serviceName: "svc",
			durationNs: 1500000,
			cost: 0.25,
		});
		expect(frame.meta?.rowsScanned).toBe(1);
	});

	it("getSpan returns null when not found", async () => {
		mockGetRequestViaSpanId.mockResolvedValue({ record: undefined });
		expect(await adapter.getSpan("nope")).toBeNull();
	});

	it("getSpan normalizes a found record and its events", async () => {
		mockGetRequestViaSpanId.mockResolvedValue({ record: rawSpan });
		const span = await adapter.getSpan("s1");
		expect(span?.spanId).toBe("s1");
		expect(span?.events).toEqual([
			{ name: "gen_ai.content.prompt", timestamp: undefined, attributes: { foo: "bar" } },
		]);
	});

	it("getTraceSpans queries by TraceId and targets the db config", async () => {
		mockDataCollector.mockResolvedValue({ data: [rawSpan] });
		const spans = await adapter.getTraceSpans("t1");
		expect(spans).toHaveLength(1);
		const [args, type, dbId] = mockDataCollector.mock.calls[0];
		expect((args as { query: string }).query).toContain("TraceId = 't1'");
		expect(type).toBe("query");
		expect(dbId).toBe("db-1");
	});

	it("getSpansBySession unions coding-agent session + parent ids", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.getSpansBySession("sess-1");
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("SpanAttributes['coding_agent.session.id'] = 'sess-1'");
		expect(sql).toContain(
			"ResourceAttributes['coding_agent.agent.parent_id'] = 'sess-1'"
		);
	});

	it("validateAISignal counts spans matching the AI selector", async () => {
		mockDataCollector.mockResolvedValue({ data: [{ c: 42 }] });
		const result = await adapter.validateAISignal(window);
		expect(result.ok).toBe(true);
		expect(result.sampleCount).toBe(42);
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("ResourceAttributes['telemetry.sdk.name'] = 'openlit'");
	});

	it("aggregateSpans builds group-by + aggregation SQL", async () => {
		mockDataCollector.mockResolvedValue({ data: [{ g0: "gpt-4", total: 5 }] });
		await adapter.aggregateSpans({
			...baseQuery,
			groupBy: ["gen_ai.request.model"],
			aggregations: [{ fn: "sum", field: "gen_ai.usage.cost", as: "total" }],
		});
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("SpanAttributes['gen_ai.request.model'] AS g0");
		expect(sql).toContain(
			"sum(toFloat64OrZero(SpanAttributes['gen_ai.usage.cost'])) AS total"
		);
		expect(sql).toContain("GROUP BY g0");
	});

	it("spanTimeSeries buckets by interval", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.spanTimeSeries({ ...baseQuery, interval: "1h" });
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("DATE_TRUNC('hour', Timestamp) AS bucket");
	});

	it("distinctValues returns non-empty string values", async () => {
		mockDataCollector.mockResolvedValue({
			data: [{ v: "gpt-4" }, { v: "" }, { v: "claude" }],
		});
		const values = await adapter.distinctValues("gen_ai.request.model", baseQuery);
		expect(values).toEqual(["gpt-4", "claude"]);
	});

	it("attributeKeys(traces) merges span + resource keys", async () => {
		mockGetAttributeKeys.mockResolvedValue({
			spanAttributeKeys: ["a"],
			resourceAttributeKeys: ["b"],
		});
		expect(await adapter.attributeKeys("traces", window)).toEqual(["a", "b"]);
	});

	it("discoverServices maps rollup rows", async () => {
		mockDataCollector.mockResolvedValue({
			data: [
				{
					serviceName: "svc",
					environment: "prod",
					clusterId: "c1",
					sdkName: "openlit",
					firstSeen: "2026-07-01T00:00:00Z",
					lastSeen: "2026-07-01T01:00:00Z",
				},
			],
		});
		const services = await adapter.discoverServices(window);
		expect(services[0]).toMatchObject({
			serviceName: "svc",
			environment: "prod",
			clusterId: "c1",
			sdkName: "openlit",
		});
	});

	it("sampleTracesForGraph fetches spans for sampled trace ids", async () => {
		mockDataCollector
			.mockResolvedValueOnce({ data: [{ TraceId: "t1" }, { TraceId: "t2" }] })
			.mockResolvedValueOnce({ data: [rawSpan] });
		const spans = await adapter.sampleTracesForGraph(baseQuery, 50);
		expect(spans).toHaveLength(1);
		const secondSql = (mockDataCollector.mock.calls[1][0] as { query: string })
			.query;
		expect(secondSql).toContain("TraceId IN ('t1', 't2')");
	});

	it("sampleTracesForGraph returns [] when no traces match", async () => {
		mockDataCollector.mockResolvedValueOnce({ data: [] });
		expect(await adapter.sampleTracesForGraph(baseQuery, 50)).toEqual([]);
	});
});
