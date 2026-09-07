const mockDataCollector = jest.fn();
const mockGetRequests = jest.fn();
const mockGetRequestViaSpanId = jest.fn();
const mockGetAttributeKeys = jest.fn();
const mockGetLogs = jest.fn();
const mockGetLogByRowId = jest.fn();
const mockGetMetrics = jest.fn();
const mockGetMetricsConfig = jest.fn();
const mockGetMetricDetail = jest.fn();
const mockGetLogsConfig = jest.fn();
const mockGetLogAttributeKeys = jest.fn();
const mockGetMetricAttributeKeys = jest.fn();
const mockGetSignalSummary = jest.fn();

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
	getMetricDetail: (...args: unknown[]) => mockGetMetricDetail(...args),
	getLogsConfig: (...args: unknown[]) => mockGetLogsConfig(...args),
	getLogAttributeKeys: (...args: unknown[]) => mockGetLogAttributeKeys(...args),
	getMetricAttributeKeys: (...args: unknown[]) =>
		mockGetMetricAttributeKeys(...args),
	getSignalSummary: (...args: unknown[]) => mockGetSignalSummary(...args),
}));

import {
	ClickHouseAdapter,
	clickHouseAdapterFactory,
} from "@/lib/platform/connectors/datasource/clickhouse/adapter";
import type {
	OpenLITQuery,
	TelemetrySourceDescriptor,
} from "@/lib/platform/connectors/datasource/types";

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

	it("getTraceSpans defaults to [] when the query returns no data field", async () => {
		mockDataCollector.mockResolvedValue({});
		expect(await adapter.getTraceSpans("t1")).toEqual([]);
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

	it("getSpansBySession defaults to [] when the query returns no data field", async () => {
		mockDataCollector.mockResolvedValue({});
		expect(await adapter.getSpansBySession("sess-1")).toEqual([]);
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

	it("aggregateSpans defaults rows to [] when the query returns no data field", async () => {
		mockDataCollector.mockResolvedValue({});
		const frame = await adapter.aggregateSpans(baseQuery);
		expect(frame.rows).toEqual([]);
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

	it("rejects SQL-shaped aggregation aliases", async () => {
		await expect(
			adapter.aggregateSpans({
				...baseQuery,
				aggregations: [{ fn: "count", as: "x, (SELECT secret FROM vault)" }],
			})
		).rejects.toThrow("Invalid dashboard aggregation alias");
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("spanTimeSeries defaults rows to [] when getSignalSummary returns no buckets", async () => {
		mockGetSignalSummary.mockResolvedValue({});
		const frame = await adapter.spanTimeSeries(baseQuery);
		expect(frame.rows).toEqual([]);
	});

	it("spanTimeSeries buckets by interval", async () => {
		mockGetSignalSummary.mockResolvedValue({ buckets: [{ label: "10:00", count: 2 }] });
		const frame = await adapter.spanTimeSeries({ ...baseQuery, interval: "1h" });
		expect(mockGetSignalSummary).toHaveBeenCalledWith(
			expect.objectContaining({ databaseConfigId: "db-1" }),
			"traces"
		);
		expect(frame.rows).toEqual([{ label: "10:00", count: 2 }]);
	});

	it("distinctValues defaults to [] when the traces query returns no data field", async () => {
		mockDataCollector.mockResolvedValue({});
		expect(await adapter.distinctValues("service.name", baseQuery)).toEqual([]);
	});

	it("distinctValues returns non-empty string values", async () => {
		mockDataCollector.mockResolvedValue({
			data: [{ v: "gpt-4" }, { v: "" }, { v: "claude" }],
		});
		const values = await adapter.distinctValues("gen_ai.request.model", baseQuery);
		expect(values).toEqual(["gpt-4", "claude"]);
	});

	it("distinctValues respects resource-scoped attribute fields", async () => {
		mockDataCollector.mockResolvedValue({ data: [{ v: "production" }] });
		await adapter.distinctValues("resource:deployment.environment", baseQuery);
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("ResourceAttributes['deployment.environment'] AS v");
	});

	it("distinctValues respects span-scoped attribute fields (span: prefix)", async () => {
		mockDataCollector.mockResolvedValue({ data: [{ v: "gpt-4o" }] });
		await adapter.distinctValues("span:gen_ai.request.model", baseQuery);
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("SpanAttributes['gen_ai.request.model'] AS v");
	});

	it("distinctValues coalesces a nullish v column to '' before filtering", async () => {
		mockDataCollector.mockResolvedValue({ data: [{ v: null }, { v: undefined }, { v: "ok" }] });
		const values = await adapter.distinctValues("service.name", baseQuery);
		expect(values).toEqual(["ok"]);
	});

	it("attributeKeys(traces) merges span + resource keys", async () => {
		mockGetAttributeKeys.mockResolvedValue({
			spanAttributeKeys: ["a"],
			resourceAttributeKeys: ["b"],
		});
		expect(await adapter.attributeKeys("traces", window)).toEqual(["a", "b"]);
	});

	it("attributeKeys(traces) defaults to [] when getAttributeKeys returns neither key list", async () => {
		mockGetAttributeKeys.mockResolvedValue({});
		expect(await adapter.attributeKeys("traces", window)).toEqual([]);
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

	it("listSpans throws the legacy error when getRequests fails", async () => {
		const boom = new Error("boom");
		mockGetRequests.mockResolvedValue({ err: boom });
		await expect(adapter.listSpans(baseQuery)).rejects.toThrow("boom");
	});

	it("listSpans wraps a non-Error err value", async () => {
		mockGetRequests.mockResolvedValue({ err: "string-error" });
		await expect(adapter.listSpans(baseQuery)).rejects.toThrow("string-error");
	});

	it("listSpans defaults rowsScanned to rows.length when total is not a number", async () => {
		mockGetRequests.mockResolvedValue({ records: [rawSpan], total: undefined });
		const frame = await adapter.listSpans(baseQuery);
		expect(frame.meta?.rowsScanned).toBe(1);
	});

	it("listSpans defaults rows to [] when getRequests returns no records field", async () => {
		mockGetRequests.mockResolvedValue({});
		const frame = await adapter.listSpans(baseQuery);
		expect(frame.rows).toEqual([]);
	});

	// ---- fieldToExpr (via aggregateSpans/distinctValues groupBy & field) --

	it("aggregateSpans resolves a resource-scoped groupBy field", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.aggregateSpans({
			...baseQuery,
			groupBy: ["resource:deployment.environment"],
		});
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("ResourceAttributes['deployment.environment'] AS g0");
	});

	it("aggregateSpans resolves the duration field to seconds", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.aggregateSpans({
			...baseQuery,
			groupBy: ["duration"],
			aggregations: [{ fn: "avg", field: "duration", as: "avgDur" }],
		});
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("Duration / 1000000000 AS g0");
		expect(sql).toContain("avg(toFloat64OrZero(Duration / 1000000000)) AS avgDur");
	});

	it("aggregateSpans resolves plain allowed field names (SpanName/ServiceName/Duration)", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.aggregateSpans({
			...baseQuery,
			groupBy: ["SpanName", "ServiceName", "Duration"],
		});
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("SpanName AS g0");
		expect(sql).toContain("ServiceName AS g1");
		expect(sql).toContain("Duration AS g2");
	});

	it("aggregateSpans resolves an un-scoped deployment.environment field", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.aggregateSpans({
			...baseQuery,
			groupBy: ["deployment.environment"],
		});
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("ResourceAttributes['deployment.environment'] AS g0");
	});

	it("aggregateSpans passes through any other allow-listed field verbatim (e.g. StatusCode)", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.aggregateSpans({ ...baseQuery, groupBy: ["StatusCode"] });
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("StatusCode AS g0");
	});

	it("aggregateSpans throws for an unsupported field", async () => {
		await expect(
			adapter.aggregateSpans({ ...baseQuery, groupBy: ["NotAllowedField"] })
		).rejects.toThrow("Unsupported ClickHouse field: NotAllowedField");
	});

	it("aggregateSpans defaults to a count() aggregation when none is given", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.aggregateSpans(baseQuery);
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("count() AS agg0");
	});

	it.each([
		["avg", "avg(toFloat64OrZero("],
		["min", "min(toFloat64OrZero("],
		["max", "max(toFloat64OrZero("],
		["p50", "quantile(0.5)(toFloat64OrZero("],
		["p90", "quantile(0.9)(toFloat64OrZero("],
		["p95", "quantile(0.95)(toFloat64OrZero("],
		["p99", "quantile(0.99)(toFloat64OrZero("],
		["cardinality", "uniqExact("],
	])("aggregateSpans maps the %s aggregation function", async (fn, expected) => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.aggregateSpans({
			...baseQuery,
			aggregations: [{ fn: fn as any, field: "gen_ai.usage.cost", as: "x" }],
		});
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain(expected);
	});

	it("aggregateSpans falls back to count() for an unknown aggregation fn", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.aggregateSpans({
			...baseQuery,
			aggregations: [{ fn: "totally-unknown" as any, as: "x" }],
		});
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("count() AS x");
	});

	it("aggregateSpans omits GROUP BY and LIMIT when neither is set", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.aggregateSpans(baseQuery);
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).not.toContain("GROUP BY");
		expect(sql).not.toContain("LIMIT");
	});

	it("aggregateSpans applies LIMIT when set and omits the aiSelector when aiSelector is false", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.aggregateSpans({ ...baseQuery, limit: 25, aiSelector: false });
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("LIMIT 25");
		expect(sql).not.toContain("telemetry.sdk.name");
	});

	it("aggregateSpans throws the legacy error when the query fails", async () => {
		mockDataCollector.mockResolvedValue({ err: new Error("query failed") });
		await expect(adapter.aggregateSpans(baseQuery)).rejects.toThrow("query failed");
	});

	// ---- distinctValues (logs / metrics / unsupported field) --------------

	it("distinctValues(logs) returns services/severities from getLogsConfig and [] for unknown keys", async () => {
		mockGetLogsConfig.mockResolvedValue({
			data: [{ services: ["api"], severities: ["ERROR"] }],
		});
		const logQuery = { ...baseQuery, signal: "logs" as const };
		expect(await adapter.distinctValues("service.name", logQuery)).toEqual(["api"]);
		expect(await adapter.distinctValues("severity", logQuery)).toEqual(["ERROR"]);
		expect(await adapter.distinctValues("other", logQuery)).toEqual([]);
	});

	it("distinctValues(logs) defaults to [] when the config row is empty and throws on legacy error", async () => {
		mockGetLogsConfig.mockResolvedValue({ data: [] });
		const logQuery = { ...baseQuery, signal: "logs" as const };
		expect(await adapter.distinctValues("service.name", logQuery)).toEqual([]);
		expect(await adapter.distinctValues("severity", logQuery)).toEqual([]);

		mockGetLogsConfig.mockResolvedValue({ err: new Error("logs config failed") });
		await expect(
			adapter.distinctValues("service.name", logQuery)
		).rejects.toThrow("logs config failed");
	});

	it("distinctValues(metrics) returns services/metric names from getMetricsConfig for both metric-name aliases", async () => {
		mockGetMetricsConfig.mockResolvedValue({
			data: [{ services: ["api"], metricNames: ["gen_ai.client.token.usage"] }],
		});
		const metricQuery = { ...baseQuery, signal: "metrics" as const };
		expect(await adapter.distinctValues("service.name", metricQuery)).toEqual(["api"]);
		expect(await adapter.distinctValues("metric.name", metricQuery)).toEqual([
			"gen_ai.client.token.usage",
		]);
		expect(await adapter.distinctValues("MetricName", metricQuery)).toEqual([
			"gen_ai.client.token.usage",
		]);
		expect(await adapter.distinctValues("other", metricQuery)).toEqual([]);
	});

	it("distinctValues(metrics) defaults to [] when the config row is empty", async () => {
		mockGetMetricsConfig.mockResolvedValue({ data: [] });
		const metricQuery = { ...baseQuery, signal: "metrics" as const };
		expect(await adapter.distinctValues("service.name", metricQuery)).toEqual([]);
		expect(await adapter.distinctValues("metric.name", metricQuery)).toEqual([]);
	});

	it("distinctValues throws for an unsupported ClickHouse field on the traces path", async () => {
		await expect(
			adapter.distinctValues("NotAllowedField", baseQuery)
		).rejects.toThrow("Unsupported ClickHouse field: NotAllowedField");
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("distinctValues omits the aiSelector clause when aiSelector is false", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		await adapter.distinctValues("service.name", { ...baseQuery, aiSelector: false });
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).not.toContain("telemetry.sdk.name");
	});

	it("distinctValues throws the legacy error when the underlying query fails", async () => {
		mockDataCollector.mockResolvedValue({ err: new Error("distinct failed") });
		await expect(
			adapter.distinctValues("service.name", baseQuery)
		).rejects.toThrow("distinct failed");
	});

	// ---- attributeKeys (logs / metrics) ------------------------------------

	it("attributeKeys(logs) dedupes keys returned by getLogAttributeKeys", async () => {
		mockGetLogAttributeKeys.mockResolvedValue({
			logAttributeKeys: ["a", "b"],
			resourceAttributeKeys: ["b", "c"],
		});
		expect(await adapter.attributeKeys("logs", window)).toEqual(["a", "b", "c"]);
	});

	it("attributeKeys(metrics) dedupes keys returned by getMetricAttributeKeys", async () => {
		mockGetMetricAttributeKeys.mockResolvedValue({
			metricAttributeKeys: ["x"],
			resourceAttributeKeys: ["x", "y"],
		});
		expect(await adapter.attributeKeys("metrics", window)).toEqual(["x", "y"]);
	});

	it("attributeKeys(logs) dedupeKeys ignores non-array values in the result object", async () => {
		mockGetLogAttributeKeys.mockResolvedValue({
			logAttributeKeys: ["a", "b"],
			resourceAttributeKeys: "not-an-array",
			someScalar: 42,
		});
		expect(await adapter.attributeKeys("logs", window)).toEqual(["a", "b"]);
	});

	// ---- Logs ---------------------------------------------------------------

	it("listLogs normalizes getLogs records into NormalizedLog", async () => {
		mockGetLogs.mockResolvedValue({
			records: [
				{
					Timestamp: "2026-07-01T00:00:00Z",
					Body: "boom",
					SeverityText: "ERROR",
					ServiceName: "svc",
				},
			],
			total: 1,
		});
		const frame = await adapter.listLogs({ ...baseQuery, signal: "logs" });
		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0]).toMatchObject({ body: "boom", severityText: "ERROR" });
		expect(frame.meta?.rowsScanned).toBe(1);
	});

	it("listLogs defaults rowsScanned to rows.length and throws on legacy error", async () => {
		mockGetLogs.mockResolvedValue({ records: [], total: undefined });
		const frame = await adapter.listLogs({ ...baseQuery, signal: "logs" });
		expect(frame.meta?.rowsScanned).toBe(0);

		mockGetLogs.mockResolvedValue({ err: new Error("logs failed") });
		await expect(adapter.listLogs({ ...baseQuery, signal: "logs" })).rejects.toThrow(
			"logs failed"
		);
	});

	it("listLogs defaults rows to [] when getLogs returns no records field", async () => {
		mockGetLogs.mockResolvedValue({});
		const frame = await adapter.listLogs({ ...baseQuery, signal: "logs" });
		expect(frame.rows).toEqual([]);
	});

	it("getLog returns null when not found and normalizes when found", async () => {
		mockGetLogByRowId.mockResolvedValue({ record: undefined });
		expect(await adapter.getLog("row-1")).toBeNull();

		mockGetLogByRowId.mockResolvedValue({
			record: { Timestamp: "2026-07-01T00:00:00Z", Body: "boom" },
		});
		const log = await adapter.getLog("row-1");
		expect(log?.body).toBe("boom");
	});

	it("getLog throws the legacy error when the read fails", async () => {
		mockGetLogByRowId.mockResolvedValue({ err: new Error("log read failed") });
		await expect(adapter.getLog("row-1")).rejects.toThrow("log read failed");
	});

	it("logTimeSeries defaults rows to [] when getSignalSummary returns no buckets", async () => {
		mockGetSignalSummary.mockResolvedValue({});
		const frame = await adapter.logTimeSeries({ ...baseQuery, signal: "logs" });
		expect(frame.rows).toEqual([]);
	});

	it("logTimeSeries buckets by interval and throws the legacy error on failure", async () => {
		mockGetSignalSummary.mockResolvedValue({ buckets: [{ label: "10:00", count: 1 }] });
		const frame = await adapter.logTimeSeries({ ...baseQuery, signal: "logs" });
		expect(mockGetSignalSummary).toHaveBeenCalledWith(
			expect.objectContaining({ databaseConfigId: "db-1" }),
			"logs"
		);
		expect(frame.rows).toEqual([{ label: "10:00", count: 1 }]);

		mockGetSignalSummary.mockResolvedValue({ err: new Error("summary failed") });
		await expect(
			adapter.logTimeSeries({ ...baseQuery, signal: "logs" })
		).rejects.toThrow("summary failed");
	});

	// ---- Metrics --------------------------------------------------------------

	it("listMetricSeries normalizes rows from the `records` shape with all optional fields present", async () => {
		mockGetMetrics.mockResolvedValue({
			records: [
				{
					metricName: "gen_ai.client.token.usage",
					metricDescription: "tokens",
					metricUnit: "tokens",
					serviceName: "svc",
					lastSeen: "2026-07-01T00:00:00Z",
					latestValue: "42",
				},
			],
			total: 1,
		});
		const frame = await adapter.listMetricSeries({ ...baseQuery, signal: "metrics" });
		expect(frame.rows[0]).toMatchObject({
			metricName: "gen_ai.client.token.usage",
			description: "tokens",
			unit: "tokens",
			serviceName: "svc",
			timestamp: "2026-07-01T00:00:00Z",
			value: 42,
		});
		expect(frame.meta?.rowsScanned).toBe(1);
	});

	it("listMetricSeries falls back to the `data` shape and defaults missing optional fields", async () => {
		mockGetMetrics.mockResolvedValue({
			data: [{ metricName: "m" }],
		});
		const frame = await adapter.listMetricSeries({ ...baseQuery, signal: "metrics" });
		expect(frame.rows[0]).toMatchObject({
			metricName: "m",
			description: undefined,
			unit: undefined,
			serviceName: undefined,
			timestamp: "",
			value: 0,
		});
		expect(frame.meta?.rowsScanned).toBe(1);
	});

	it("listMetricSeries defaults metricName to '' when the row carries none", async () => {
		mockGetMetrics.mockResolvedValue({ records: [{}] });
		const frame = await adapter.listMetricSeries({ ...baseQuery, signal: "metrics" });
		expect(frame.rows[0].metricName).toBe("");
	});

	it("listMetricSeries defaults to [] when neither records nor data is present", async () => {
		mockGetMetrics.mockResolvedValue({});
		const frame = await adapter.listMetricSeries({ ...baseQuery, signal: "metrics" });
		expect(frame.rows).toEqual([]);
	});

	it("listMetricSeries throws the legacy error on failure", async () => {
		mockGetMetrics.mockResolvedValue({ err: new Error("metrics failed") });
		await expect(
			adapter.listMetricSeries({ ...baseQuery, signal: "metrics" })
		).rejects.toThrow("metrics failed");
	});

	it("metricTimeSeries fetches per-metric detail series when a spanName filter names a metric", async () => {
		mockGetMetricDetail.mockResolvedValue({
			series: [{ request_time: "2026-07-01T00:00:00Z", value: "5" }],
		});
		const frame = await adapter.metricTimeSeries({
			...baseQuery,
			signal: "metrics",
			filters: [
				{ target: "spanName", op: "eq", value: "gen_ai.client.token.usage" },
				{ target: "attribute", scope: "resource", key: "service.name", op: "eq", value: "svc" },
			],
		});
		expect(mockGetMetricDetail).toHaveBeenCalledWith(
			"gen_ai.client.token.usage",
			undefined,
			"svc",
			expect.objectContaining({ databaseConfigId: "db-1" })
		);
		expect(frame.rows[0]).toMatchObject({
			metricName: "gen_ai.client.token.usage",
			serviceName: "svc",
			timestamp: "2026-07-01T00:00:00Z",
			value: 5,
		});
	});

	it("metricTimeSeries resolves array-valued spanName/service.name filters to their first element", async () => {
		mockGetMetricDetail.mockResolvedValue({ series: [] });
		await adapter.metricTimeSeries({
			...baseQuery,
			signal: "metrics",
			filters: [
				{ target: "spanName", op: "in", value: ["metric-a", "metric-b"] },
				{
					target: "attribute",
					scope: "resource",
					key: "service.name",
					op: "in",
					value: ["svc-a", "svc-b"],
				},
			],
		});
		expect(mockGetMetricDetail).toHaveBeenCalledWith(
			"metric-a",
			undefined,
			"svc-a",
			expect.anything()
		);
	});

	it("metricTimeSeries omits serviceName when no service.name filter is present", async () => {
		mockGetMetricDetail.mockResolvedValue({ series: [] });
		await adapter.metricTimeSeries({
			...baseQuery,
			signal: "metrics",
			filters: [{ target: "spanName", op: "eq", value: "m" }],
		});
		expect(mockGetMetricDetail).toHaveBeenCalledWith("m", undefined, undefined, expect.anything());
	});

	it("metricTimeSeries ignores an attribute filter whose key is not service.name", async () => {
		mockGetMetricDetail.mockResolvedValue({ series: [] });
		await adapter.metricTimeSeries({
			...baseQuery,
			signal: "metrics",
			filters: [
				{ target: "spanName", op: "eq", value: "m" },
				{ target: "attribute", scope: "span", key: "gen_ai.system", op: "eq", value: "openai" },
			],
		});
		expect(mockGetMetricDetail).toHaveBeenCalledWith("m", undefined, undefined, expect.anything());
	});

	it("metricTimeSeries defaults rows to [] when detail carries no series field", async () => {
		mockGetMetricDetail.mockResolvedValue({});
		const frame = await adapter.metricTimeSeries({
			...baseQuery,
			signal: "metrics",
			filters: [{ target: "spanName", op: "eq", value: "m" }],
		});
		expect(frame.rows).toEqual([]);
	});

	it("metricTimeSeries defaults detail rows to '' timestamp / 0 value and throws the legacy error on failure", async () => {
		mockGetMetricDetail.mockResolvedValue({ series: [{}] });
		const frame = await adapter.metricTimeSeries({
			...baseQuery,
			signal: "metrics",
			filters: [{ target: "spanName", op: "eq", value: "m" }],
		});
		expect(frame.rows[0]).toMatchObject({ timestamp: "", value: 0 });

		mockGetMetricDetail.mockResolvedValue({ err: new Error("detail failed") });
		await expect(
			adapter.metricTimeSeries({
				...baseQuery,
				signal: "metrics",
				filters: [{ target: "spanName", op: "eq", value: "m" }],
			})
		).rejects.toThrow("detail failed");
	});

	it("metricTimeSeries falls back to getSignalSummary when no spanName filter names a metric", async () => {
		mockGetSignalSummary.mockResolvedValue({ buckets: [{ label: "x", value: 1 }] });
		const frame = await adapter.metricTimeSeries({ ...baseQuery, signal: "metrics" });
		expect(mockGetSignalSummary).toHaveBeenCalledWith(expect.anything(), "metrics");
		expect(frame.rows).toEqual([{ label: "x", value: 1 }]);
	});

	it("metricTimeSeries falls back to getSignalSummary and throws the legacy error on failure", async () => {
		mockGetSignalSummary.mockResolvedValue({ err: new Error("metrics summary failed") });
		await expect(
			adapter.metricTimeSeries({ ...baseQuery, signal: "metrics" })
		).rejects.toThrow("metrics summary failed");
	});

	it("metricNames returns the configured metric names, defaulting to [] when absent", async () => {
		mockGetMetricsConfig.mockResolvedValue({ data: [{ metricNames: ["m1", "m2"] }] });
		expect(await adapter.metricNames(window)).toEqual(["m1", "m2"]);

		mockGetMetricsConfig.mockResolvedValue({ data: [{}] });
		expect(await adapter.metricNames(window)).toEqual([]);
	});

	it("metricNames throws the legacy error on failure", async () => {
		mockGetMetricsConfig.mockResolvedValue({ err: new Error("metric names failed") });
		await expect(adapter.metricNames(window)).rejects.toThrow("metric names failed");
	});

	// ---- Discovery ------------------------------------------------------------

	it("discoverServices defaults to [] when the query returns no data field", async () => {
		mockDataCollector.mockResolvedValue({});
		expect(await adapter.discoverServices(window)).toEqual([]);
	});

	it("discoverServices passes through sdkLanguage/sdkVersion when present", async () => {
		mockDataCollector.mockResolvedValue({
			data: [
				{
					serviceName: "svc",
					sdkLanguage: "python",
					sdkVersion: "1.2.3",
				},
			],
		});
		const services = await adapter.discoverServices(window);
		expect(services[0]).toMatchObject({ sdkLanguage: "python", sdkVersion: "1.2.3" });
	});

	it("discoverServices defaults optional sdk/timestamp fields to undefined and required fields to ''", async () => {
		mockDataCollector.mockResolvedValue({ data: [{}] });
		const services = await adapter.discoverServices(window);
		expect(services[0]).toEqual({
			serviceName: "",
			environment: "",
			clusterId: "",
			sdkName: undefined,
			sdkLanguage: undefined,
			sdkVersion: undefined,
			firstSeen: undefined,
			lastSeen: undefined,
		});
	});

	it("discoverServices throws the legacy error on failure", async () => {
		mockDataCollector.mockResolvedValue({ err: new Error("discover failed") });
		await expect(adapter.discoverServices(window)).rejects.toThrow("discover failed");
	});

	it("aggregateByService defaults to [] when the query returns no data field", async () => {
		mockDataCollector.mockResolvedValue({});
		expect(await adapter.aggregateByService(window)).toEqual([]);
	});

	it("aggregateByService maps rollup rows, filtering out falsy model/provider entries", async () => {
		mockDataCollector.mockResolvedValue({
			data: [
				{
					serviceName: "svc",
					environment: "prod",
					clusterId: "c1",
					requestCount: "5",
					models: ["gpt-4", "", null],
					providers: ["openai", undefined],
				},
			],
		});
		const rollups = await adapter.aggregateByService(window);
		expect(rollups[0]).toEqual({
			serviceName: "svc",
			environment: "prod",
			clusterId: "c1",
			requestCount: 5,
			models: ["gpt-4"],
			providers: ["openai"],
		});
	});

	it("aggregateByService defaults requestCount/models/providers when rows are sparse", async () => {
		mockDataCollector.mockResolvedValue({ data: [{}] });
		const rollups = await adapter.aggregateByService(window);
		expect(rollups[0]).toMatchObject({
			serviceName: "",
			environment: "",
			clusterId: "",
			requestCount: 0,
			models: [],
			providers: [],
		});
	});

	it("aggregateByService throws the legacy error on failure", async () => {
		mockDataCollector.mockResolvedValue({ err: new Error("rollup failed") });
		await expect(adapter.aggregateByService(window)).rejects.toThrow("rollup failed");
	});

	// ---- sampleTracesForGraph edge cases ---------------------------------------

	it("sampleTracesForGraph defaults maxTraces to 100 when falsy/NaN", async () => {
		mockDataCollector
			.mockResolvedValueOnce({ data: [{ TraceId: "t1" }] })
			.mockResolvedValueOnce({ data: [] });
		await adapter.sampleTracesForGraph(baseQuery, NaN);
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).toContain("LIMIT 100");
	});

	it("sampleTracesForGraph throws the legacy error when the id lookup fails", async () => {
		mockDataCollector.mockResolvedValueOnce({ err: new Error("id lookup failed") });
		await expect(adapter.sampleTracesForGraph(baseQuery, 10)).rejects.toThrow(
			"id lookup failed"
		);
	});

	it("sampleTracesForGraph throws the legacy error when the span fetch fails", async () => {
		mockDataCollector
			.mockResolvedValueOnce({ data: [{ TraceId: "t1" }] })
			.mockResolvedValueOnce({ err: new Error("span fetch failed") });
		await expect(adapter.sampleTracesForGraph(baseQuery, 10)).rejects.toThrow(
			"span fetch failed"
		);
	});

	it("sampleTracesForGraph filters out rows with no TraceId before building the IN clause", async () => {
		mockDataCollector
			.mockResolvedValueOnce({ data: [{ TraceId: "t1" }, {}, { TraceId: "" }] })
			.mockResolvedValueOnce({ data: [] });
		await adapter.sampleTracesForGraph(baseQuery, 10);
		const secondSql = (mockDataCollector.mock.calls[1][0] as { query: string }).query;
		expect(secondSql).toContain("TraceId IN ('t1')");
	});

	it("sampleTracesForGraph treats a missing idResult.data field as no matching traces", async () => {
		mockDataCollector.mockResolvedValueOnce({});
		expect(await adapter.sampleTracesForGraph(baseQuery, 10)).toEqual([]);
	});

	it("sampleTracesForGraph defaults spans to [] when the span fetch returns no data field", async () => {
		mockDataCollector
			.mockResolvedValueOnce({ data: [{ TraceId: "t1" }] })
			.mockResolvedValueOnce({});
		expect(await adapter.sampleTracesForGraph(baseQuery, 10)).toEqual([]);
	});

	it("sampleTracesForGraph omits the aiSelector clause when aiSelector is false", async () => {
		mockDataCollector
			.mockResolvedValueOnce({ data: [{ TraceId: "t1" }] })
			.mockResolvedValueOnce({ data: [] });
		await adapter.sampleTracesForGraph({ ...baseQuery, aiSelector: false }, 10);
		const sql = (mockDataCollector.mock.calls[0][0] as { query: string }).query;
		expect(sql).not.toContain("telemetry.sdk.name");
	});

	// ---- validateAISignal / getTraceSpans / getSpansBySession legacy errors ---

	it("validateAISignal reports ok:false with the error message when the query fails (no throw)", async () => {
		mockDataCollector.mockResolvedValue({ err: new Error("validate failed") });
		const result = await adapter.validateAISignal(window);
		expect(result.ok).toBe(false);
		expect(result.message).toBe("Error: validate failed");
	});

	it("validateAISignal defaults sampleCount to 0 when no rows are returned", async () => {
		mockDataCollector.mockResolvedValue({ data: [] });
		const result = await adapter.validateAISignal(window);
		expect(result.sampleCount).toBe(0);
		expect(result.ok).toBe(false);
	});

	it("getTraceSpans throws the legacy error on failure", async () => {
		mockDataCollector.mockResolvedValue({ err: new Error("trace spans failed") });
		await expect(adapter.getTraceSpans("t1")).rejects.toThrow("trace spans failed");
	});

	it("getSpansBySession throws the legacy error on failure", async () => {
		mockDataCollector.mockResolvedValue({ err: new Error("session spans failed") });
		await expect(adapter.getSpansBySession("sess-1")).rejects.toThrow(
			"session spans failed"
		);
	});

	it("getSpan throws the legacy error on failure", async () => {
		mockGetRequestViaSpanId.mockResolvedValue({ err: new Error("get span failed") });
		await expect(adapter.getSpan("s1")).rejects.toThrow("get span failed");
	});

	it("healthCheck reports ok:false with the error message when the ping fails", async () => {
		mockDataCollector.mockResolvedValue({ err: new Error("ping failed") });
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(false);
		expect(result.message).toBe("Error: ping failed");
	});

	it("spanTimeSeries throws the legacy error on failure", async () => {
		mockGetSignalSummary.mockResolvedValue({ err: new Error("span summary failed") });
		await expect(adapter.spanTimeSeries(baseQuery)).rejects.toThrow(
			"span summary failed"
		);
	});
});

describe("clickHouseAdapterFactory", () => {
	it("creates a ClickHouseAdapter instance bound to the given descriptor", () => {
		const created = clickHouseAdapterFactory.create(descriptor);
		expect(created).toBeInstanceOf(ClickHouseAdapter);
		expect(created.type).toBe("clickhouse");
		expect((created as ClickHouseAdapter).sampleCacheKey).toBe(descriptor.id);
	});

	it("describes the static ClickHouse source type", () => {
		const desc = clickHouseAdapterFactory.describe();
		expect(desc).toMatchObject({
			type: "clickhouse",
			displayName: "ClickHouse",
			declaredSignals: ["traces", "logs", "metrics"],
			authStyle: "none",
			configFields: [],
			capabilities: {
				traceTree: true,
				spanEvents: true,
				serverAggregation: true,
				spanMutation: true,
				distinctValues: true,
				crossTraceSession: true,
				rawQuery: true,
			},
			correlation: {
				crossSignal: true,
				keys: ["traceId", "spanId", "service", "session"],
			},
		});
	});
});
