const mockGetRequests = jest.fn();
const mockGetRequestViaSpanId = jest.fn();
const mockGetRequestViaTraceId = jest.fn();
const mockGetHeirarchyViaSpanId = jest.fn();
const mockResolveDescriptor = jest.fn();
const mockGetAdapter = jest.fn();

const mockGetRequestsConfig = jest.fn();
const mockGetGroupedRequests = jest.fn();
const mockGetAttributeKeys = jest.fn();
const mockGetSignalSummary = jest.fn();

jest.mock("@/lib/platform/request", () => ({
	getRequests: (...a: unknown[]) => mockGetRequests(...a),
	getRequestViaSpanId: (...a: unknown[]) => mockGetRequestViaSpanId(...a),
	getRequestViaTraceId: (...a: unknown[]) => mockGetRequestViaTraceId(...a),
	getHeirarchyViaSpanId: (...a: unknown[]) => mockGetHeirarchyViaSpanId(...a),
	getRequestsConfig: (...a: unknown[]) => mockGetRequestsConfig(...a),
	getGroupedRequests: (...a: unknown[]) => mockGetGroupedRequests(...a),
	getAttributeKeys: (...a: unknown[]) => mockGetAttributeKeys(...a),
	getTotalRequests: jest.fn(),
	getRequestPerTime: jest.fn(),
	getAverageRequestDuration: jest.fn(),
	getRequestExist: jest.fn(),
}));

jest.mock("@/helpers/server/platform", () => ({
	getFilterPreviousParams: (p: unknown) => p,
	dateTruncGroupingLogic: () => "hour",
}));

jest.mock("@/lib/platform/observability", () => ({
	getSignalSummary: (...a: unknown[]) => mockGetSignalSummary(...a),
	getSummaryBucket: () => "hour",
}));

jest.mock("@/lib/telemetry-source", () => ({
	resolveTelemetrySourceDescriptor: (...a: unknown[]) =>
		mockResolveDescriptor(...a),
	getTelemetryAdapter: (...a: unknown[]) => mockGetAdapter(...a),
}));

jest.mock("@/helpers/server/trace", () => ({
	buildHierarchy: (rows: unknown[]) =>
		rows.length ? { SpanId: (rows[0] as { SpanId: string }).SpanId, children: [] } : null,
}));

jest.mock("@/lib/platform/connectors/datasource/http/cache", () => ({
	cacheKey: (...parts: unknown[]) => parts.join(":"),
	cachedQuery: (_key: string, _ttl: number, loader: () => unknown) => loader(),
	__clearCache: jest.fn(),
}));

jest.mock("@/lib/platform/telemetry/rollups", () => ({
	readSignalBucketRollup: jest.fn().mockResolvedValue(null),
	readLlmRollup: jest.fn().mockResolvedValue(null),
	readSpanHotCache: jest.fn().mockResolvedValue(null),
	materializeTelemetryRollups: jest.fn(),
	SIGNAL_BUCKETS_TABLE: "openlit_signal_buckets",
	LLM_ROLLUPS_TABLE: "openlit_llm_rollups",
	SPAN_HOT_CACHE_TABLE: "openlit_external_span_cache",
	ROLLUP_FRESHNESS_MS: 300000,
}));

import {
	getTraceAverageDuration,
	getTraceExist,
	getTraceHierarchy,
	getTraceRecordByTraceId,
	getTraceRequestPerTime,
	getTraceSummary,
	getTraceSpanRecord,
	getTraceTotalRequests,
	listTraceRecords,
} from "@/lib/platform/traces/read";

const builtin = {
	type: "clickhouse",
	id: "builtin:db-1",
	isBuiltIn: true,
	settings: {},
	signals: ["traces", "logs", "metrics"],
	name: "CH",
	dbConfigId: "db-1",
};

const tempo = {
	type: "tempo",
	id: "src-tempo",
	isBuiltIn: false,
	settings: { url: "https://tempo.example.com" },
	signals: ["traces"],
	name: "Tempo",
};

const params = {
	timeLimit: {
		start: new Date("2026-07-01T00:00:00.000Z"),
		end: new Date("2026-07-01T01:00:00.000Z"),
		type: "CUSTOM",
	},
	limit: 10,
	offset: 0,
	selectedConfig: { models: ["gpt-4o"] },
};

beforeEach(() => {
	jest.clearAllMocks();
});

describe("listTraceRecords", () => {
	it("uses the same adapter contract for the built-in ClickHouse source", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		const listSpans = jest.fn().mockResolvedValue({
			rows: [
				{
					traceId: "t1",
					spanId: "s1",
					parentSpanId: "",
					name: "chat",
					serviceName: "api",
					timestamp: "2026-07-01T00:00:00.000Z",
					durationNs: 1,
					statusCode: "OK",
					spanAttributes: {},
					resourceAttributes: {},
				},
			],
		});
		mockGetAdapter.mockResolvedValue({
			type: "clickhouse",
			sampleCacheKey: "builtin-db-1",
			listSpans,
		});

		const res = await listTraceRecords(params as never);
		expect(listSpans).toHaveBeenCalled();
		expect(res).toMatchObject({
			err: null,
			records: [expect.objectContaining({ SpanId: "s1", TraceId: "t1" })],
		});
		expect(mockGetRequests).not.toHaveBeenCalled();
		expect(mockGetAdapter).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "traces",
				descriptor: expect.objectContaining({ id: "builtin:db-1" }),
			})
		);
	});

	it("lists via stratified sample (not raw listSpans) and denormalizes rows", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const listSpans = jest.fn().mockResolvedValue({ rows: [
			{
				traceId: "t1",
				spanId: "s1",
				parentSpanId: "",
				name: "chat",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:00.000Z",
				durationNs: 1_000_000,
				statusCode: "STATUS_CODE_OK",
				spanAttributes: { "gen_ai.request.model": "gpt-4o" },
				resourceAttributes: { "service.name": "api" },
			},
		] });
		mockGetAdapter.mockResolvedValue({ listSpans });

		const res = await listTraceRecords(params as never);
		expect(listSpans).toHaveBeenCalled();
		expect(res.err).toBeNull();
		expect((res as { records?: unknown[] }).records?.[0]).toMatchObject({
			TraceId: "t1",
			SpanId: "s1",
			SpanName: "chat",
			ServiceName: "api",
		});
		expect(mockGetRequests).not.toHaveBeenCalled();
	});

	it("uses the backend trace count so pagination total does not grow with offset", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const listSpans = jest.fn().mockResolvedValue({ rows: [
			{
				traceId: "t1",
				spanId: "s1",
				parentSpanId: "",
				name: "chat",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:00.000Z",
				durationNs: 1_000_000,
				statusCode: "STATUS_CODE_OK",
				spanAttributes: {},
				resourceAttributes: { "service.name": "api" },
			},
		] });
		const countTraces = jest
			.fn()
			.mockResolvedValue({ total: 32, truncated: false });
		mockGetAdapter.mockResolvedValue({ listSpans, countTraces });

		const res = await listTraceRecords({ ...params, offset: 25 } as never);

		expect(countTraces).toHaveBeenCalledTimes(1);
		expect(res).toMatchObject({ total: 32, freshness: "live" });
	});
});

describe("getTraceSpanRecord", () => {
	it("uses getSpan on external sources", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			getSpan: jest.fn().mockResolvedValue({
				traceId: "t1",
				spanId: "s1",
				parentSpanId: "",
				name: "chat",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:00.000Z",
				durationNs: 1,
				statusCode: "OK",
				spanAttributes: {},
				resourceAttributes: {},
			}),
		});

		const res = await getTraceSpanRecord("s1");
		expect(res.record).toMatchObject({ SpanId: "s1", TraceId: "t1" });
	});

	it("falls back to getTraceSpans when TraceId is provided and getSpan misses", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const getSpan = jest.fn().mockResolvedValue(null);
		const getTraceSpans = jest.fn().mockResolvedValue([
			{
				traceId: "t1",
				spanId: "s1",
				parentSpanId: "",
				name: "chat",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:00.000Z",
				durationNs: 1,
				statusCode: "OK",
				spanAttributes: {},
				resourceAttributes: {},
			},
		]);
		mockGetAdapter.mockResolvedValue({ getSpan, getTraceSpans });

		const res = await getTraceSpanRecord("s1", { traceId: "t1" });
		expect(getTraceSpans).toHaveBeenCalledWith("t1");
		expect(res.record).toMatchObject({ SpanId: "s1", TraceId: "t1" });
	});

	it("fails closed when the requested span is absent from the selected Tempo trace", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const getSpan = jest.fn();
		const getTraceSpans = jest.fn().mockResolvedValue([
			{
				traceId: "t1",
				spanId: "different-span",
				parentSpanId: "",
				name: "root",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:00.000Z",
				durationNs: 1,
				statusCode: "OK",
				spanAttributes: {},
				resourceAttributes: {},
			},
		]);
		mockGetAdapter.mockResolvedValue({ getSpan, getTraceSpans });

		const res = await getTraceSpanRecord("clickhouse-only-span", {
			traceId: "t1",
		});

		expect(res.record).toBeUndefined();
		expect(res.err).toContain("selected trace and telemetry source");
		expect(getSpan).not.toHaveBeenCalled();
		expect(mockGetRequestViaSpanId).not.toHaveBeenCalled();
	});
});

describe("getTraceRecordByTraceId", () => {
	it("returns the first span from getTraceSpans", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			getTraceSpans: jest.fn().mockResolvedValue([
				{
					traceId: "t1",
					spanId: "root",
					parentSpanId: "",
					name: "root",
					serviceName: "api",
					timestamp: "2026-07-01T00:00:00.000Z",
					durationNs: 1,
					statusCode: "OK",
					spanAttributes: {},
					resourceAttributes: {},
				},
			]),
		});

		const res = await getTraceRecordByTraceId("t1");
		expect(res.record).toMatchObject({ SpanId: "root" });
	});
});

describe("getTraceHierarchy", () => {
	it("builds a ParentSpanId tree from external getTraceSpans", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			capabilities: () => ({ crossTraceSession: false }),
			getSpan: jest.fn().mockResolvedValue({
				traceId: "t1",
				spanId: "s1",
				parentSpanId: "",
				name: "root",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:00.000Z",
				durationNs: 1,
				statusCode: "OK",
				spanAttributes: {},
				resourceAttributes: {},
			}),
			getTraceSpans: jest.fn().mockResolvedValue([
				{
					traceId: "t1",
					spanId: "s1",
					parentSpanId: "",
					name: "root",
					serviceName: "api",
					timestamp: "2026-07-01T00:00:00.000Z",
					durationNs: 1,
					statusCode: "OK",
					spanAttributes: {},
					resourceAttributes: {},
				},
			]),
		});

		const res = await getTraceHierarchy("s1");
		expect(res.err).toBeNull();
		expect(res.record).toMatchObject({ SpanId: "s1" });
		expect(mockGetHeirarchyViaSpanId).not.toHaveBeenCalled();
	});

	it("builds ClickHouse hierarchy through the same adapter contract", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		const span = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "root",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		mockGetAdapter.mockResolvedValue({
			capabilities: () => ({ crossTraceSession: false }),
			getSpan: jest.fn().mockResolvedValue(span),
			getTraceSpans: jest.fn().mockResolvedValue([span]),
		});

		const res = await getTraceHierarchy("s1");
		expect(mockGetHeirarchyViaSpanId).not.toHaveBeenCalled();
		expect(res.record).toMatchObject({ SpanId: "s1" });
	});

	it("does not build a hierarchy for a span absent from the selected Tempo trace", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const getSpan = jest.fn();
		mockGetAdapter.mockResolvedValue({
			getSpan,
			getTraceSpans: jest.fn().mockResolvedValue([]),
		});

		const res = await getTraceHierarchy("clickhouse-only-span", {
			traceId: "tempo-trace",
		});

		expect(res.record).toEqual({});
		expect(res.err).toContain("selected trace and telemetry source");
		expect(getSpan).not.toHaveBeenCalled();
		expect(mockGetHeirarchyViaSpanId).not.toHaveBeenCalled();
	});
});

describe("dashboard graph facades", () => {
	it("uses a backend trace-summary series for the external trace volume", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const traceTimeSeries = jest.fn().mockResolvedValue({
			rows: [
				{ label: "00:00", count: 12 },
				{ label: "01:00", count: 8 },
			],
			meta: { freshness: "live", truncated: false },
		});
		const spanTimeSeries = jest.fn();
		mockGetAdapter.mockResolvedValue({ traceTimeSeries, spanTimeSeries });

		const res = await getTraceSummary(params as any);

		expect(traceTimeSeries).toHaveBeenCalledTimes(1);
		expect(spanTimeSeries).not.toHaveBeenCalled();
		expect(res).toMatchObject({
			total: 20,
			peak: 12,
			freshness: "live",
			truncated: false,
		});
	});

	it("aggregates total requests via the external adapter", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			aggregateSpans: jest
				.fn()
				.mockResolvedValueOnce({ rows: [{ total_requests: 12 }] })
				.mockResolvedValueOnce({ rows: [{ total_requests: 4 }] }),
		});

		const res = await getTraceTotalRequests(params as any);
		expect(res.err).toBeNull();
		expect(res.data).toEqual([
			{ total_requests: 12, previous_total_requests: 4 },
		]);
	});

	it("builds request-per-time series via spanTimeSeries", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			spanTimeSeries: jest.fn().mockResolvedValue({
				rows: [{ total: 3, request_time: "2026/07/01 00:00" }],
			}),
		});

		const res = await getTraceRequestPerTime(params as any);
		expect(res.data).toEqual([{ total: 3, request_time: "2026/07/01 00:00" }]);
	});

	it("aggregates average duration via the external adapter", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			aggregateSpans: jest
				.fn()
				.mockResolvedValueOnce({ rows: [{ average_duration: 1.5 }] })
				.mockResolvedValueOnce({ rows: [{ average_duration: 0.5 }] }),
		});

		const res = await getTraceAverageDuration(params as any);
		expect(res.data).toEqual([
			{ average_duration: 1.5, previous_average_duration: 0.5 },
		]);
	});

	it("probes existence via listSpans(limit=1)", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockResolvedValue({ rows: [{ spanId: "s1" }] }),
		});

		const res = await getTraceExist();
		expect(res.data).toEqual([{ total_requests: 1 }]);
	});
});
