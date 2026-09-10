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
	getFilterWhereCondition: () => "1 = 1",
}));

const mockGetSummaryBucket = jest.fn().mockReturnValue("hour");

jest.mock("@/lib/platform/observability", () => ({
	getSignalSummary: (...a: unknown[]) => mockGetSignalSummary(...a),
	getSummaryBucket: (...a: unknown[]) => mockGetSummaryBucket(...a),
}));

jest.mock("@/lib/telemetry-source", () => ({
	resolveTelemetrySourceDescriptor: (...a: unknown[]) =>
		mockResolveDescriptor(...a),
	getTelemetryAdapter: (...a: unknown[]) => mockGetAdapter(...a),
}));

jest.mock("@/helpers/server/trace", () => ({
	buildHierarchy: jest.fn((rows: unknown[]) =>
		rows.length ? { SpanId: (rows[0] as { SpanId: string }).SpanId, children: [] } : null
	),
}));

jest.mock("@/lib/platform/connectors/datasource/http/cache", () => ({
	cacheKey: (...parts: unknown[]) => parts.join(":"),
	cachedQuery: (_key: string, _ttl: number, loader: () => unknown) => loader(),
	__clearCache: jest.fn(),
}));

jest.mock("@/lib/platform/agent-loop/clickhouse", () => ({
	fetchLoopHitsByTraceIds: jest.fn(async () => new Map()),
	fetchLoopHitsByGroupIds: jest.fn(async () => new Map()),
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
	getTraceAttributeKeys,
	getTraceAverageDuration,
	getTraceExist,
	getTraceFilterConfig,
	getTraceGrouped,
	getTraceHierarchy,
	getTraceRecordByTraceId,
	getTraceRequestPerTime,
	getTraceSummary,
	getTraceSpanRecord,
	getTraceTotalRequests,
	listTraceRecords,
} from "@/lib/platform/traces/read";
import { AdapterError } from "@openplait/adapter-sdk";
import { UnsupportedCapabilityError } from "@/lib/platform/connectors/datasource/types";
import { fetchLoopHitsByTraceIds } from "@/lib/platform/agent-loop/clickhouse";
import { buildHierarchy } from "@/helpers/server/trace";

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

	it("filters Tempo traces by generation-health chips from a full-trace sample", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const sampleTracesForGraph = jest.fn().mockResolvedValue([
			{
				traceId: "t-http",
				spanId: "root",
				parentSpanId: "",
				name: "GET /health",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:00.000Z",
				durationNs: 1,
				statusCode: "OK",
				spanAttributes: { "http.method": "GET" },
				resourceAttributes: {},
			},
			{
				traceId: "t-swap",
				spanId: "child",
				parentSpanId: "root",
				name: "openai.chat.completions",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:01.000Z",
				durationNs: 1,
				statusCode: "OK",
				spanAttributes: {
					"gen_ai.request.model": "gpt-4o",
					"gen_ai.response.model": "gpt-4o-mini",
				},
				resourceAttributes: {},
			},
		]);
		const listSpans = jest.fn();
		mockGetAdapter.mockResolvedValue({ sampleTracesForGraph, listSpans });

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(sampleTracesForGraph).toHaveBeenCalled();
		expect(listSpans).not.toHaveBeenCalled();
		expect(res).toMatchObject({
			err: null,
			total: 1,
			freshness: "sampled",
			records: [
				expect.objectContaining({
					TraceId: "t-swap",
					SpanId: "child",
				}),
			],
		});
	});

	it("expands the sample until a later generation-health page can be filled", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const swappedSpan = (index: number) => ({
			traceId: `t-${index}`,
			spanId: `s-${index}`,
			parentSpanId: "",
			name: "openai.chat.completions",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.response.model": "gpt-4o-mini",
			},
			resourceAttributes: {},
		});
		const sampleTracesForGraph = jest
			.fn()
			.mockImplementation(async (_query: unknown, maxTraces: number) =>
				Array.from({ length: maxTraces }, (_, index) => swappedSpan(index))
			);
		mockGetAdapter.mockResolvedValue({ sampleTracesForGraph, listSpans: jest.fn() });

		const res = await listTraceRecords({
			...params,
			limit: 10,
			offset: 200,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(sampleTracesForGraph.mock.calls.map((call) => call[1])).toEqual([
			210,
		]);
		const records = (res as { records?: Array<Record<string, unknown>> }).records;
		expect(res).toMatchObject({ err: null, freshness: "sampled" });
		expect(records).toHaveLength(10);
		expect(records?.[0]).toMatchObject({ TraceId: "t-200", SpanId: "s-200" });
		expect(records?.[9]).toMatchObject({ TraceId: "t-209" });
	});

	it("filters Tempo traces by stuck-agent loops from a full-trace sample", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const loopSpan = (index: number) => ({
			traceId: "t-loop",
			spanId: `tool-${index}`,
			parentSpanId: "",
			name: "execute_tool",
			serviceName: "agent",
			timestamp: `2026-07-01T00:00:0${index}.000Z`,
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.conversation.id": "chat-1",
				"gen_ai.tool.name": "search",
				"gen_ai.tool.args": '{"q":"orders"}',
			},
			resourceAttributes: {},
		});
		const sampleTracesForGraph = jest.fn().mockResolvedValue([
			{
				traceId: "t-ok",
				spanId: "root",
				parentSpanId: "",
				name: "GET /health",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:00.000Z",
				durationNs: 1,
				statusCode: "OK",
				spanAttributes: { "http.method": "GET" },
				resourceAttributes: {},
			},
			loopSpan(0),
			loopSpan(1),
			loopSpan(2),
		]);
		const listSpans = jest.fn();
		mockGetAdapter.mockResolvedValue({ sampleTracesForGraph, listSpans });

		const res = await listTraceRecords({
			...params,
			selectedConfig: { agentLoop: true },
		} as never);

		expect(sampleTracesForGraph).toHaveBeenCalled();
		expect(listSpans).not.toHaveBeenCalled();
		expect(res).toMatchObject({
			err: null,
			total: 1,
			freshness: "sampled",
			records: [
				expect.objectContaining({
					TraceId: "t-loop",
					agentLoop: expect.objectContaining({
						toolName: "search",
						count: 3,
					}),
				}),
			],
		});
	});

	it("attaches Tempo loop badges on the unfiltered list from full traces", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const listSpans = jest.fn().mockResolvedValue({
			rows: [
				{
					traceId: "t-loop",
					spanId: "t-loop",
					parentSpanId: "",
					name: "chat",
					serviceName: "agent",
					timestamp: "2026-07-01T00:00:00.000Z",
					durationNs: 1,
					statusCode: "OK",
					spanAttributes: {},
					resourceAttributes: {},
				},
			],
		});
		const tool = (index: number) => ({
			traceId: "t-loop",
			spanId: `tool-${index}`,
			parentSpanId: "root",
			name: "execute_tool",
			serviceName: "agent",
			timestamp: `2026-07-01T00:00:0${index}.000Z`,
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.conversation.id": "chat-1",
				"gen_ai.tool.name": "search",
				"gen_ai.tool.args": '{"q":"orders"}',
			},
			resourceAttributes: {},
		});
		const getTraceSpans = jest.fn().mockResolvedValue([
			{
				traceId: "t-loop",
				spanId: "root",
				parentSpanId: "",
				name: "chat",
				serviceName: "agent",
				timestamp: "2026-07-01T00:00:00.000Z",
				durationNs: 1,
				statusCode: "OK",
				spanAttributes: { "gen_ai.request.model": "gpt-4o" },
				resourceAttributes: {},
			},
			tool(0),
			tool(1),
			tool(2),
		]);
		mockGetAdapter.mockResolvedValue({
			listSpans,
			getTraceSpans,
			countTraces: async () => ({ total: 1, truncated: false }),
		});

		const res = await listTraceRecords(params as never);

		expect(getTraceSpans).toHaveBeenCalledWith("t-loop");
		expect(res).toMatchObject({
			err: null,
			records: [
				expect.objectContaining({
					TraceId: "t-loop",
					agentLoop: expect.objectContaining({
						toolName: "search",
						count: 3,
					}),
				}),
			],
		});
	});

	it("keeps sampling when the first budget cannot fill the requested health page", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const swappedSpan = (index: number) => ({
			traceId: `t-swap-${index}`,
			spanId: `s-${index}`,
			parentSpanId: "",
			name: "openai.chat.completions",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.response.model": "gpt-4o-mini",
			},
			resourceAttributes: {},
		});
		const httpSpan = (index: number) => ({
			traceId: `t-http-${index}`,
			spanId: `h-${index}`,
			parentSpanId: "",
			name: "GET /health",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: { "http.method": "GET" },
			resourceAttributes: {},
		});
		const sampleTracesForGraph = jest
			.fn()
			.mockImplementation(async (_query: unknown, maxTraces: number) => {
				const swapped = maxTraces >= 400 ? 50 : 10;
				return [
					...Array.from({ length: swapped }, (_, index) => swappedSpan(index)),
					...Array.from({ length: maxTraces - swapped }, (_, index) =>
						httpSpan(index)
					),
				];
			});
		mockGetAdapter.mockResolvedValue({ sampleTracesForGraph, listSpans: jest.fn() });

		const res = await listTraceRecords({
			...params,
			limit: 50,
			offset: 0,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(sampleTracesForGraph.mock.calls.map((call) => call[1])).toEqual([
			200, 400,
		]);
		expect((res as { records?: unknown[] }).records).toHaveLength(50);
		expect(res).toMatchObject({ freshness: "sampled" });
	});

	it("uses the backend trace count so pagination total does not grow with offset", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		let releaseCount!: () => void;
		const countStarted = new Promise<void>((resolve) => {
			releaseCount = resolve;
		});
		const countTraces = jest.fn().mockImplementation(async () => {
			releaseCount();
			return { total: 32, truncated: false };
		});
		// listSpans blocks until countTraces has started so a serial
		// list-then-count path would deadlock this test.
		const listSpansBlocked = jest.fn().mockImplementation(async () => {
			await countStarted;
			return {
				rows: [
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
				],
			};
		});
		mockGetAdapter.mockResolvedValue({
			listSpans: listSpansBlocked,
			countTraces,
		});

		const res = await listTraceRecords({ ...params, offset: 25 } as never);

		expect(countTraces).toHaveBeenCalledTimes(1);
		expect(listSpansBlocked).toHaveBeenCalledTimes(1);
		expect(res).toMatchObject({ total: 32, freshness: "live" });
	});

	it("rethrows AdapterError so list routes can return 503", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			listSpans: jest
				.fn()
				.mockRejectedValue(new AdapterError("EXECUTION_FAILED", "tempo down")),
		});

		await expect(listTraceRecords(params as never)).rejects.toBeInstanceOf(
			AdapterError
		);
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

	it("opens the Tempo root span when list reused the trace id as spanId", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const getSpan = jest.fn();
		const getTraceSpans = jest.fn().mockResolvedValue([
			{
				traceId: "t1",
				spanId: "root-span",
				parentSpanId: "",
				name: "root",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:00.000Z",
				durationNs: 1,
				statusCode: "OK",
				spanAttributes: {},
				resourceAttributes: {},
			},
			{
				traceId: "t1",
				spanId: "child-span",
				parentSpanId: "root-span",
				name: "child",
				serviceName: "api",
				timestamp: "2026-07-01T00:00:01.000Z",
				durationNs: 1,
				statusCode: "OK",
				spanAttributes: {},
				resourceAttributes: {},
			},
		]);
		mockGetAdapter.mockResolvedValue({ getSpan, getTraceSpans });

		const res = await getTraceSpanRecord("t1", { traceId: "t1" });

		expect(getTraceSpans).toHaveBeenCalledWith("t1");
		expect(res.err).toBeNull();
		expect(res.record).toMatchObject({ SpanId: "root-span", TraceId: "t1" });
		expect(getSpan).not.toHaveBeenCalled();
	});

	it("attaches a ClickHouse cross-trace loop hit on span detail", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		(fetchLoopHitsByTraceIds as jest.Mock).mockResolvedValue(
			new Map([
				[
					"t1",
					{
						toolName: "search",
						count: 4,
						wastedTokens: 20,
						wastedCost: 0.2,
					},
				],
			])
		);
		mockGetAdapter.mockResolvedValue({
			getTraceSpans: jest.fn().mockResolvedValue([
				{
					traceId: "t1",
					spanId: "s1",
					parentSpanId: "",
					name: "execute_tool",
					serviceName: "agent",
					timestamp: "2026-07-01T00:00:00.000Z",
					durationNs: 1,
					statusCode: "OK",
					spanAttributes: {
						"gen_ai.conversation.id": "chat-1",
						"gen_ai.tool.name": "search",
						"gen_ai.tool.args": '{"q":"once"}',
					},
					resourceAttributes: {},
				},
			]),
		});

		const res = await getTraceSpanRecord("s1", { traceId: "t1" });

		expect(res.err).toBeNull();
		expect(res.record).toMatchObject({
			SpanId: "s1",
			agentLoop: { toolName: "search", count: 4 },
		});
	});

	it("loads sibling Tempo traces so a split conversation still shows the loop note", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const call = (traceId: string, spanId: string) => ({
			traceId,
			spanId,
			parentSpanId: "",
			name: "execute_tool",
			serviceName: "agent",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.conversation.id": "chat-1",
				"gen_ai.tool.name": "search",
				"gen_ai.tool.args": '{"q":"orders"}',
			},
			resourceAttributes: {},
		});
		const sampleTracesForGraph = jest
			.fn()
			.mockResolvedValue([call("t1", "s1"), call("t2", "s2"), call("t3", "s3")]);
		mockGetAdapter.mockResolvedValue({
			getTraceSpans: jest.fn().mockResolvedValue([call("t1", "s1")]),
			sampleTracesForGraph,
		});

		const res = await getTraceSpanRecord("s1", { traceId: "t1" });

		expect(sampleTracesForGraph).toHaveBeenCalled();
		expect(res.record).toMatchObject({
			agentLoop: expect.objectContaining({ toolName: "search", count: 3 }),
		});
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

	it("reports no traces on empty listSpans result", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockResolvedValue({ rows: [] }),
		});

		const res = await getTraceExist();
		expect(res.data).toEqual([{ total_requests: 0 }]);
	});

	it("uses intervalFromTimeRange when the summary bucket has no mapped interval", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetSummaryBucket.mockReturnValueOnce("unmapped-bucket");
		const traceTimeSeries = jest.fn().mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue({ traceTimeSeries });

		const res = await getTraceSummary(params as any);

		expect(res.err).toBeNull();
		expect(traceTimeSeries).toHaveBeenCalledWith(
			expect.objectContaining({ interval: "1h" })
		);
	});

	it("adds an error-status filter for the exceptions signal", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const traceTimeSeries = jest.fn().mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue({ traceTimeSeries });

		await getTraceSummary(params as any, "exceptions");

		expect(traceTimeSeries).toHaveBeenCalledWith(
			expect.objectContaining({
				filters: expect.arrayContaining([
					expect.objectContaining({ target: "status", op: "in" }),
				]),
			})
		);
	});

	it("falls back to planAndSpanTimeSeries when the adapter has no traceTimeSeries", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const spanTimeSeries = jest.fn().mockResolvedValue({
			rows: [{ label: "00:00", count: 2 }],
			meta: { freshness: "sampled", truncated: true },
		});
		mockGetAdapter.mockResolvedValue({ spanTimeSeries });

		const res = await getTraceSummary(params as any);

		expect(spanTimeSeries).toHaveBeenCalled();
		expect(res).toMatchObject({ total: 2, peak: 2, freshness: "sampled", truncated: true });
	});

	it("returns an error payload when getTraceSummary fails", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			traceTimeSeries: jest.fn().mockRejectedValue(new Error("tempo boom")),
		});

		const res = await getTraceSummary(params as any);
		expect(res).toMatchObject({ err: "tempo boom", buckets: [], total: 0, peak: 0 });
	});

	it("rethrows AdapterError from getTraceSummary", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			traceTimeSeries: jest
				.fn()
				.mockRejectedValue(new AdapterError("EXECUTION_FAILED", "tempo down")),
		});

		await expect(getTraceSummary(params as any)).rejects.toBeInstanceOf(AdapterError);
	});

	it("returns an error payload when getTraceTotalRequests fails", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			aggregateSpans: jest.fn().mockRejectedValue(new Error("count boom")),
		});

		const res = await getTraceTotalRequests(params as any);
		expect(res).toEqual({ err: "count boom", data: [] });
	});

	it("returns an error payload when getTraceRequestPerTime fails", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			spanTimeSeries: jest.fn().mockRejectedValue(new Error("series boom")),
		});

		const res = await getTraceRequestPerTime(params as any);
		expect(res).toEqual({ err: "series boom", data: [] });
	});

	it("returns an error payload when getTraceAverageDuration fails", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			aggregateSpans: jest.fn().mockRejectedValue(new Error("avg boom")),
		});

		const res = await getTraceAverageDuration(params as any);
		expect(res).toEqual({ err: "avg boom", data: [] });
	});

	it("falls back to a count-only aggregation row and defaults to 0 for total requests", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			aggregateSpans: jest
				.fn()
				.mockResolvedValueOnce({ rows: [{ count: 7 }] })
				.mockResolvedValueOnce({ rows: [{}] }),
		});

		const res = await getTraceTotalRequests(params as any);
		expect(res.data).toEqual([{ total_requests: 7, previous_total_requests: 0 }]);
	});

	it("defaults total requests to 0 when the aggregation returns no rows", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			aggregateSpans: jest.fn().mockResolvedValue({ rows: [] }),
		});

		const res = await getTraceTotalRequests(params as any);
		expect(res.data).toEqual([{ total_requests: 0, previous_total_requests: 0 }]);
	});

	it("falls back to count/label/bucket fields for the request-per-time series", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			spanTimeSeries: jest.fn().mockResolvedValue({
				rows: [{ count: 5, bucket: "2026-07-01T00:00:00.000Z" }],
			}),
		});

		const res = await getTraceRequestPerTime(params as any);
		expect(res.data).toEqual([{ total: 5, request_time: "2026-07-01T00:00:00.000Z" }]);
	});

	it("defaults request-per-time fields to 0/empty-string when nothing matches", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			spanTimeSeries: jest.fn().mockResolvedValue({ rows: [{}] }),
		});

		const res = await getTraceRequestPerTime(params as any);
		expect(res.data).toEqual([{ total: 0, request_time: "" }]);
	});

	it("defaults average duration fields to 0 when the aggregation returns no matching field", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			aggregateSpans: jest
				.fn()
				.mockResolvedValueOnce({ rows: [{}] })
				.mockResolvedValueOnce({ rows: [] }),
		});

		const res = await getTraceAverageDuration(params as any);
		expect(res.data).toEqual([{ average_duration: 0, previous_average_duration: 0 }]);
	});

	it("falls back to request_time/bucket and defaults counts to 0 in the summary series", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const traceTimeSeries = jest.fn().mockResolvedValue({
			rows: [{ request_time: "2026-07-01T00:00:00.000Z" }],
		});
		mockGetAdapter.mockResolvedValue({ traceTimeSeries });

		const res = await getTraceSummary(params as any);
		expect(res.buckets).toEqual([
			{
				label: "2026-07-01T00:00:00.000Z",
				count: 0,
				avgDuration: 0,
				cost: 0,
				tokens: 0,
			},
		]);
		expect(res.freshness).toBe("sampled");
		expect(res.truncated).toBe(false);
	});

	it("keeps the base filters unchanged for the non-exceptions traces signal", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const traceTimeSeries = jest.fn().mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue({ traceTimeSeries });

		await getTraceSummary({ ...params, selectedConfig: { models: ["gpt-4o"] } } as any, "traces");

		const [query] = traceTimeSeries.mock.calls[0];
		expect(query.filters.some((f: { target: string }) => f.target === "status")).toBe(false);
	});
});

describe("listTraceRecords total/truncation branches", () => {
	it("estimates total as records+offset+1 when truncated without a backend count", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
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
		mockGetAdapter.mockResolvedValue({ listSpans });

		const res = await listTraceRecords({ ...params, limit: 1, offset: 0 } as never);

		expect(res).toMatchObject({ total: 2, freshness: "sampled" });
	});

	it("uses frame.meta.rowsScanned as a live total when no backend count is available", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
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
			meta: { rowsScanned: 42 },
		});
		mockGetAdapter.mockResolvedValue({ listSpans });

		const res = await listTraceRecords(params as never);

		expect(res).toMatchObject({ total: 42, freshness: "live" });
	});
});

describe("treesForListedTraces", () => {
	it("keeps the original summary rows when the adapter cannot fetch full traces", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const summaryRow = {
			traceId: "t-summary",
			spanId: "t-summary",
			parentSpanId: "",
			name: "chat",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		const listSpans = jest.fn().mockResolvedValue({ rows: [summaryRow] });
		mockGetAdapter.mockResolvedValue({ listSpans });

		const res = await listTraceRecords(params as never);
		expect(res.records?.[0]).toMatchObject({ TraceId: "t-summary" });
	});

	it("falls back to the summary rows when every per-trace fetch throws", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const summaryRow = {
			traceId: "t-summary",
			spanId: "t-summary",
			parentSpanId: "",
			name: "chat",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		const listSpans = jest.fn().mockResolvedValue({ rows: [summaryRow] });
		const getTraceSpans = jest.fn().mockRejectedValue(new Error("tree fetch boom"));
		mockGetAdapter.mockResolvedValue({ listSpans, getTraceSpans });

		const res = await listTraceRecords(params as never);
		expect(getTraceSpans).toHaveBeenCalledWith("t-summary");
		expect(res.records?.[0]).toMatchObject({ TraceId: "t-summary" });
	});
});

describe("getTraceSpanRecord tree lookup", () => {
	it("attaches the loop note computed from a non-empty trace tree via getSpan", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const span = {
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
		};
		mockGetAdapter.mockResolvedValue({
			getSpan: jest.fn().mockResolvedValue(span),
			getTraceSpans: jest.fn().mockResolvedValue([span]),
		});

		const res = await getTraceSpanRecord("s1");
		expect(res.err).toBeNull();
		expect(res.record).toMatchObject({ SpanId: "s1" });
	});
});

describe("getTraceSpanRecord empty tree fallback", () => {
	it("attaches the loop note from just the span when getTraceSpans resolves empty", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const span = {
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
		};
		mockGetAdapter.mockResolvedValue({
			getSpan: jest.fn().mockResolvedValue(span),
			getTraceSpans: jest.fn().mockResolvedValue([]),
		});

		const res = await getTraceSpanRecord("s1");
		expect(res.err).toBeNull();
		expect(res.record).toMatchObject({ SpanId: "s1" });
	});
});

describe("getTraceFilterConfig span-name fallback", () => {
	it("re-derives span names from the sample when the native lookup returns none", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const span = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "chat-completion",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		mockGetAdapter.mockResolvedValue({
			capabilities: () => ({}),
			discoverServices: jest.fn().mockResolvedValue([{ serviceName: "api" }]),
			sampleTracesForGraph: jest.fn().mockResolvedValue([span]),
			distinctValues: jest.fn().mockResolvedValue([]),
		});

		const res = await getTraceFilterConfig(params as never);
		expect(res.data?.[0]).toMatchObject({ spanNames: ["chat-completion"] });
	});
});

describe("getTraceExist error branch", () => {
	it("returns an error payload when listSpans fails", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockRejectedValue(new Error("exist boom")),
		});

		const res = await getTraceExist();
		expect(res).toEqual({ err: "exist boom", data: [{ total_requests: 0 }] });
	});
});

describe("getTraceTotalRequests count fallback", () => {
	it("falls back to a bare count field when total_requests is absent", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			aggregateSpans: jest
				.fn()
				.mockResolvedValueOnce({ rows: [{ count: 9 }] })
				.mockResolvedValueOnce({ rows: [{ count: 3 }] }),
		});

		const res = await getTraceTotalRequests(params as any);
		expect(res.data).toEqual([{ total_requests: 9, previous_total_requests: 3 }]);
	});

	it("defaults both totals to 0 when the aggregate has no rows at all", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			aggregateSpans: jest.fn().mockResolvedValue({ rows: [] }),
		});

		const res = await getTraceTotalRequests(params as any);
		expect(res.data).toEqual([{ total_requests: 0, previous_total_requests: 0 }]);
	});
});

describe("attachLoopForDetail additional branches", () => {
	it("returns the row unchanged when the ClickHouse loop-hit lookup throws", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		(fetchLoopHitsByTraceIds as jest.Mock).mockRejectedValue(new Error("ch lookup boom"));
		mockGetAdapter.mockResolvedValue({
			getTraceSpans: jest.fn().mockResolvedValue([
				{
					traceId: "t1",
					spanId: "s1",
					parentSpanId: "",
					name: "execute_tool",
					serviceName: "agent",
					timestamp: "2026-07-01T00:00:00.000Z",
					durationNs: 1,
					statusCode: "OK",
					spanAttributes: {
						"gen_ai.conversation.id": "chat-1",
						"gen_ai.tool.name": "search",
						"gen_ai.tool.args": '{"q":"once"}',
					},
					resourceAttributes: {},
				},
			]),
		});

		const res = await getTraceSpanRecord("s1", { traceId: "t1" });
		expect(res.err).toBeNull();
		expect(res.record?.agentLoop).toBeUndefined();
	});

	it("returns the row unchanged when sibling-trace sampling throws", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const call = (traceId: string, spanId: string) => ({
			traceId,
			spanId,
			parentSpanId: "",
			name: "execute_tool",
			serviceName: "agent",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.conversation.id": "chat-1",
				"gen_ai.tool.name": "search",
				"gen_ai.tool.args": '{"q":"orders"}',
			},
			resourceAttributes: {},
		});
		mockGetAdapter.mockResolvedValue({
			getTraceSpans: jest.fn().mockResolvedValue([call("t1", "s1")]),
			sampleTracesForGraph: jest.fn().mockRejectedValue(new Error("sample boom")),
		});

		const res = await getTraceSpanRecord("s1", { traceId: "t1" });
		expect(res.err).toBeNull();
		expect(res.record?.agentLoop).toBeUndefined();
	});
});

describe("listedSpansForIssueSample", () => {
	it("keeps a row as-is when its trace expands to no spans", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const summaryRow = {
			traceId: "t-empty-tree",
			spanId: "t-empty-tree",
			parentSpanId: "",
			name: "GET /health",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		const listSpans = jest.fn().mockResolvedValue({ rows: [summaryRow] });
		const getTraceSpans = jest.fn().mockResolvedValue([]);
		mockGetAdapter.mockResolvedValue({ listSpans, getTraceSpans });

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(getTraceSpans).toHaveBeenCalledWith("t-empty-tree");
		expect(res.err).toBeNull();
		expect((res as { records?: unknown[] }).records).toEqual([]);
	});
});

describe("listTraceRecords combined issue filters", () => {
	it("keeps only rows that are both looping and generation-health-flagged", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const loopSwapSpan = (index: number) => ({
			traceId: "t-loop-swap",
			spanId: `tool-${index}`,
			parentSpanId: "",
			name: "execute_tool",
			serviceName: "agent",
			timestamp: `2026-07-01T00:00:0${index}.000Z`,
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.conversation.id": "chat-1",
				"gen_ai.tool.name": "search",
				"gen_ai.tool.args": '{"q":"orders"}',
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.response.model": "gpt-4o-mini",
			},
			resourceAttributes: {},
		});
		const loopOnlySpan = (index: number) => ({
			traceId: "t-loop-only",
			spanId: `tool-only-${index}`,
			parentSpanId: "",
			name: "execute_tool",
			serviceName: "agent",
			timestamp: `2026-07-01T00:00:0${index}.000Z`,
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.conversation.id": "chat-2",
				"gen_ai.tool.name": "search",
				"gen_ai.tool.args": '{"q":"invoices"}',
			},
			resourceAttributes: {},
		});
		const sampleTracesForGraph = jest.fn().mockResolvedValue([
			loopSwapSpan(0),
			loopSwapSpan(1),
			loopSwapSpan(2),
			loopOnlySpan(0),
			loopOnlySpan(1),
			loopOnlySpan(2),
		]);
		mockGetAdapter.mockResolvedValue({ sampleTracesForGraph, listSpans: jest.fn() });

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"], agentLoop: true },
		} as never);

		expect(res.err).toBeNull();
		const records = (res as { records?: Array<Record<string, unknown>> }).records;
		expect(records?.map((r) => r.TraceId)).toEqual(["t-loop-swap"]);
	});
});

describe("getTraceFilterConfig", () => {
	it("combines discovered services with an L1 sample for the remaining filters", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const span = (overrides: Record<string, unknown>) => ({
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
			...overrides,
		});
		mockGetAdapter.mockResolvedValue({
			capabilities: () => ({}),
			discoverServices: jest.fn().mockResolvedValue([
				{ serviceName: "api" },
				{ serviceName: "" },
			]),
			sampleTracesForGraph: jest.fn().mockResolvedValue([
				span({
					spanAttributes: {
						"gen_ai.request.model": "gpt-4o",
						"gen_ai.system": "openai",
						"gen_ai.operation.type": "chat",
					},
				}),
			]),
			distinctValues: jest.fn().mockResolvedValue(["chat", "embeddings"]),
			sampleCacheKey: "tempo-filter-config",
		});

		const res = await getTraceFilterConfig(params as never);

		expect(res.err).toBeNull();
		expect(res.data?.[0]).toMatchObject({
			models: ["gpt-4o"],
			providers: ["openai"],
			spanNames: ["chat", "embeddings"],
			applicationNames: ["api"],
			traceTypes: ["chat"],
		});
	});

	it("falls back to sampled span names/applications when native lookups fail or are empty", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const span = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "chat-completion",
			serviceName: "worker",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		mockGetAdapter.mockResolvedValue({
			capabilities: () => ({}),
			discoverServices: jest.fn().mockRejectedValue(new Error("no discovery")),
			sampleTracesForGraph: jest.fn().mockResolvedValue([span]),
			distinctValues: jest.fn().mockRejectedValue(new Error("unsupported")),
		});

		const res = await getTraceFilterConfig(params as never);

		expect(res.err).toBeNull();
		expect(res.data?.[0]).toMatchObject({
			spanNames: ["chat-completion"],
			applicationNames: ["worker"],
		});
	});

	it("returns the empty filter row when getTraceFilterConfig fails", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			capabilities: () => ({}),
			discoverServices: jest.fn().mockRejectedValue(new Error("no discovery")),
			sampleTracesForGraph: jest.fn().mockRejectedValue(new Error("sample boom")),
		});

		const res = await getTraceFilterConfig(params as never);
		expect(res.err).toBe("sample boom");
		expect(res.data?.[0]).toMatchObject({ models: [], providers: [] });
	});
});

describe("getTraceAttributeKeys", () => {
	it("returns discovered span attribute keys", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			attributeKeys: jest.fn().mockResolvedValue(["gen_ai.request.model"]),
		});

		const res = await getTraceAttributeKeys(params as never);
		expect(res).toEqual({
			err: null,
			spanAttributeKeys: ["gen_ai.request.model"],
			resourceAttributeKeys: [],
		});
	});

	it("returns an empty payload when attribute discovery fails", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			attributeKeys: jest.fn().mockRejectedValue(new Error("boom")),
		});

		const res = await getTraceAttributeKeys(params as never);
		expect(res).toEqual({ err: null, spanAttributeKeys: [], resourceAttributeKeys: [] });
	});
});

describe("getTraceGrouped", () => {
	it("maps a friendly groupBy key to its attribute field", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const aggregateSpans = jest.fn().mockResolvedValue({
			rows: [{ group_value: "gpt-4o", count: 3, total_cost: 1.5, total_tokens: 400, avg_duration_seconds: 0.4 }],
		});
		mockGetAdapter.mockResolvedValue({ aggregateSpans });

		const res = await getTraceGrouped(params as never, "model");

		expect(aggregateSpans).toHaveBeenCalledWith(
			expect.objectContaining({ groupBy: ["gen_ai.request.model"] })
		);
		expect(res.data).toEqual([
			{
				group_value: "gpt-4o",
				count: 3,
				total_cost: 1.5,
				total_tokens: 400,
				avg_duration_seconds: 0.4,
			},
		]);
	});

	it("passes through a scoped groupBy key that has no friendly mapping", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const aggregateSpans = jest.fn().mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue({ aggregateSpans });

		await getTraceGrouped(params as never, "custom:attribute.key");

		expect(aggregateSpans).toHaveBeenCalledWith(
			expect.objectContaining({ groupBy: ["attribute.key"] })
		);
	});

	it("passes through a plain groupBy key without a colon", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const aggregateSpans = jest.fn().mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue({ aggregateSpans });

		await getTraceGrouped(params as never, "custom_field");

		expect(aggregateSpans).toHaveBeenCalledWith(
			expect.objectContaining({ groupBy: ["custom_field"] })
		);
	});

	it("returns an error payload when getTraceGrouped fails", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			aggregateSpans: jest.fn().mockRejectedValue(new Error("group boom")),
		});

		const res = await getTraceGrouped(params as never, "model");
		expect(res).toEqual({ err: "group boom", data: [] });
	});

	it("falls back to the raw grouped field name when group_value is absent", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const aggregateSpans = jest.fn().mockResolvedValue({
			rows: [{ "gen_ai.request.model": "claude-3", count: 1 }],
		});
		mockGetAdapter.mockResolvedValue({ aggregateSpans });

		const res = await getTraceGrouped(params as never, "model");
		expect(res.data[0]).toMatchObject({ group_value: "claude-3" });
	});

	it("falls back to g0 and defaults numeric aggregates to 0 when nothing else matches", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const aggregateSpans = jest.fn().mockResolvedValue({
			rows: [{ g0: "gpt-4o" }],
		});
		mockGetAdapter.mockResolvedValue({ aggregateSpans });

		const res = await getTraceGrouped(params as never, "model");
		expect(res.data[0]).toEqual({
			group_value: "gpt-4o",
			count: 0,
			total_cost: 0,
			total_tokens: 0,
			avg_duration_seconds: 0,
		});
	});

	it("defaults the group value to an empty string when no candidate field is present", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const aggregateSpans = jest.fn().mockResolvedValue({ rows: [{}] });
		mockGetAdapter.mockResolvedValue({ aggregateSpans });

		const res = await getTraceGrouped(params as never, "model");
		expect(res.data[0].group_value).toBe("");
	});
});

describe("listTraceRecords issue-sample fallback (no sampleTracesForGraph)", () => {
	it("falls back to listSpans + per-trace expansion when the adapter cannot sample directly", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const swappedRow = {
			traceId: "t-swap",
			spanId: "root-swap",
			parentSpanId: "",
			name: "openai.chat.completions",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.response.model": "gpt-4o-mini",
			},
			resourceAttributes: {},
		};
		const listSpans = jest.fn().mockResolvedValue({ rows: [swappedRow] });
		const getTraceSpans = jest.fn().mockResolvedValue([swappedRow]);
		mockGetAdapter.mockResolvedValue({ listSpans, getTraceSpans });

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(listSpans).toHaveBeenCalled();
		expect(getTraceSpans).not.toHaveBeenCalled();
		expect(res).toMatchObject({ err: null, freshness: "sampled" });
	});

	it("expands per-trace when the initial rows do not already match the issue filter", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const summaryRow = {
			traceId: "t-summary",
			spanId: "t-summary",
			parentSpanId: "",
			name: "root",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		const swappedSpan = {
			...summaryRow,
			spanId: "child",
			name: "openai.chat.completions",
			spanAttributes: {
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.response.model": "gpt-4o-mini",
			},
		};
		const listSpans = jest.fn().mockResolvedValue({ rows: [summaryRow] });
		const getTraceSpans = jest.fn().mockResolvedValue([summaryRow, swappedSpan]);
		mockGetAdapter.mockResolvedValue({ listSpans, getTraceSpans });

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(getTraceSpans).toHaveBeenCalledWith("t-summary");
		expect(res).toMatchObject({ err: null });
		const records = (res as { records?: Array<Record<string, unknown>> }).records;
		expect(records?.some((row) => row.SpanId === "child")).toBe(true);
	});

	it("falls back to the listSpans row when a trace expands to no spans", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const swappedRow = {
			traceId: "t-empty",
			spanId: "root",
			parentSpanId: "",
			name: "openai.chat.completions",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.response.model": "gpt-4o-mini",
			},
			resourceAttributes: {},
		};
		const other = { ...swappedRow, traceId: "t-other-blank", spanAttributes: {} };
		const listSpans = jest.fn().mockResolvedValue({ rows: [swappedRow, other] });
		const getTraceSpans = jest.fn().mockResolvedValue([]);
		mockGetAdapter.mockResolvedValue({ listSpans, getTraceSpans });

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(res.err).toBeNull();
	});

	it("continues sampling via listSpans+getTraceSpans when sampleTracesForGraph is unsupported", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const swappedRow = {
			traceId: "t-swap",
			spanId: "root",
			parentSpanId: "",
			name: "openai.chat.completions",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.response.model": "gpt-4o-mini",
			},
			resourceAttributes: {},
		};
		mockGetAdapter.mockResolvedValue({
			sampleTracesForGraph: jest
				.fn()
				.mockRejectedValue(new UnsupportedCapabilityError("sampleTracesForGraph", "tempo")),
			listSpans: jest.fn().mockResolvedValue({ rows: [swappedRow] }),
		});

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(res.err).toBeNull();
	});

	it("reports an error when sampleTracesForGraph fails with a non-capability error", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			sampleTracesForGraph: jest.fn().mockRejectedValue(new Error("graph boom")),
			listSpans: jest.fn(),
		});

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(res).toEqual({ err: "graph boom" });
	});
});

describe("listTraceRecords ClickHouse cross-trace loop hits", () => {
	it("attaches loop hits by TraceId when the built-in source has matches", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		(fetchLoopHitsByTraceIds as jest.Mock).mockResolvedValue(
			new Map([["t1", { toolName: "search", count: 2 }]])
		);
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockResolvedValue({
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
			}),
		});

		const res = await listTraceRecords(params as never);
		expect(res.records?.[0]).toMatchObject({
			TraceId: "t1",
			agentLoop: { toolName: "search", count: 2 },
		});
	});

	it("returns unmodified records when the loop-hit lookup throws", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		(fetchLoopHitsByTraceIds as jest.Mock).mockRejectedValue(new Error("ch down"));
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockResolvedValue({
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
			}),
		});

		const res = await listTraceRecords(params as never);
		expect(res.records?.[0]?.agentLoop).toBeUndefined();
	});

	it("returns records unchanged when there are no TraceIds to look up", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockResolvedValue({ rows: [] }),
		});

		const res = await listTraceRecords(params as never);
		expect(res.records).toEqual([]);
		expect(fetchLoopHitsByTraceIds).not.toHaveBeenCalled();
	});
});

describe("getTraceSpanRecord additional branches", () => {
	it("reports span not found when getSpan misses without a traceId hint", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({ getSpan: jest.fn().mockResolvedValue(null) });

		const res = await getTraceSpanRecord("missing-span");
		expect(res).toEqual({
			err: "Span not found in the selected telemetry source",
			record: undefined,
		});
	});

	it("still attaches a loop note when the full-trace fetch throws", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const span = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "execute_tool",
			serviceName: "agent",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.conversation.id": "chat-1",
				"gen_ai.tool.name": "search",
				"gen_ai.tool.args": "{}",
			},
			resourceAttributes: {},
		};
		mockGetAdapter.mockResolvedValue({
			getSpan: jest.fn().mockResolvedValue(span),
			getTraceSpans: jest.fn().mockRejectedValue(new Error("tree boom")),
		});

		const res = await getTraceSpanRecord("s1");
		expect(res.err).toBeNull();
		expect(res.record).toMatchObject({ SpanId: "s1" });
	});

	it("propagates a source-level error and reports the failure", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			getSpan: jest.fn().mockRejectedValue(new Error("adapter down")),
		});

		const res = await getTraceSpanRecord("s1");
		expect(res).toEqual({ err: "adapter down", record: undefined });
	});
});

describe("getTraceRecordByTraceId error branch", () => {
	it("returns an error payload when getTraceSpans throws", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			getTraceSpans: jest.fn().mockRejectedValue(new Error("fetch boom")),
		});

		const res = await getTraceRecordByTraceId("t1");
		expect(res).toEqual({ err: "fetch boom", record: undefined });
	});
});

describe("getTraceHierarchy additional branches", () => {
	it("expands cross-trace session spans when the adapter supports it", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const rootSpan = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "root",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: { "coding_agent.session.id": "sess-1" },
		};
		const sessionSpan = { ...rootSpan, traceId: "t2", spanId: "s2" };
		mockGetAdapter.mockResolvedValue({
			capabilities: () => ({ crossTraceSession: true }),
			getSpan: jest.fn().mockResolvedValue(rootSpan),
			getTraceSpans: jest.fn().mockResolvedValue([rootSpan]),
			getSpansBySession: jest.fn().mockResolvedValue([sessionSpan]),
		});

		const res = await getTraceHierarchy("s1");
		expect(res.err).toBeNull();
	});

	it("still builds a hierarchy when session expansion throws", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const rootSpan = {
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "",
			name: "root",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: { "coding_agent.session.id": "sess-1" },
		};
		mockGetAdapter.mockResolvedValue({
			capabilities: () => ({ crossTraceSession: true }),
			getSpan: jest.fn().mockResolvedValue(rootSpan),
			getTraceSpans: jest.fn().mockResolvedValue([rootSpan]),
			getSpansBySession: jest.fn().mockRejectedValue(new Error("session boom")),
		});

		const res = await getTraceHierarchy("s1");
		expect(res.err).toBeNull();
		expect(res.record).toMatchObject({ SpanId: "s1" });
	});

	it("reports a missing span when no traceId hint is given and getSpan misses", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({ getSpan: jest.fn().mockResolvedValue(null) });

		const res = await getTraceHierarchy("missing");
		expect(res).toEqual({ err: "Span not found", record: {} });
	});

	it("reports failure to fetch trace spans when getTraceSpans returns empty", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
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
			getTraceSpans: jest.fn().mockResolvedValue([]),
		});

		const res = await getTraceHierarchy("s1");
		expect(res).toEqual({ err: "Failed to fetch trace spans", record: {} });
	});

	it("propagates a source-level error from getTraceHierarchy", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			getSpan: jest.fn().mockRejectedValue(new Error("hierarchy boom")),
		});

		const res = await getTraceHierarchy("s1");
		expect(res).toEqual({ err: "hierarchy boom", record: {} });
	});

	it("accepts opts without a traceId hint (e.g. only an environment)", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const span = {
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
		};
		mockGetAdapter.mockResolvedValue({
			capabilities: () => ({ crossTraceSession: false }),
			getSpan: jest.fn().mockResolvedValue(span),
			getTraceSpans: jest.fn().mockResolvedValue([span]),
		});

		const res = await getTraceHierarchy("s1", { environment: "production" });
		expect(res.err).toBeNull();
	});

	it("reports a hierarchy build failure when the tree builder returns nothing", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		(buildHierarchy as jest.Mock).mockReturnValueOnce(null);
		const span = {
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
		};
		mockGetAdapter.mockResolvedValue({
			capabilities: () => ({ crossTraceSession: false }),
			getSpan: jest.fn().mockResolvedValue(span),
			getTraceSpans: jest.fn().mockResolvedValue([span]),
		});

		const res = await getTraceHierarchy("s1");
		expect(res).toEqual({ err: "Error building hierarchy", record: {} });
	});
});

describe("externalTraceQuery environment filter edge cases", () => {
	it("keeps a multi-value deployment.environment filter instead of dropping it as the 'default' sentinel", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const listSpans = jest.fn().mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue({ listSpans });

		await listTraceRecords({
			...params,
			selectedConfig: { environments: ["production", "staging"] },
		} as never);

		const [query] = listSpans.mock.calls[0];
		expect(query.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: "deployment.environment", value: ["production", "staging"] }),
			])
		);
	});

	it("keeps a single non-default deployment.environment filter", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const listSpans = jest.fn().mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue({ listSpans });

		await listTraceRecords({
			...params,
			selectedConfig: { environments: ["production"] },
		} as never);

		const [query] = listSpans.mock.calls[0];
		expect(query.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: "deployment.environment", value: ["production"] }),
			])
		);
	});
});

describe("findSpanInTrace additional branches", () => {
	it("falls back to the raw (unnormalized) span id when it cannot be OTLP-normalized", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const span = {
			traceId: "t1",
			spanId: "",
			parentSpanId: "",
			name: "chat",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		mockGetAdapter.mockResolvedValue({
			getTraceSpans: jest.fn().mockResolvedValue([span]),
			capabilities: () => ({}),
		});

		const res = await getTraceSpanRecord("", { traceId: "t1" });
		expect(res.err).toBeNull();
	});

	it("returns null when the trace has no root span to fall back to", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			getTraceSpans: jest.fn().mockResolvedValue([]),
		});

		const res = await getTraceSpanRecord("t-same-id", { traceId: "t-same-id" });
		expect(res).toEqual({
			err: "Span not found in the selected trace and telemetry source",
			record: undefined,
		});
	});
});

describe("getTraceSpanRecord opts without traceId", () => {
	it("reports not found using only an environment hint (no traceId)", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({ getSpan: jest.fn().mockResolvedValue(null) });

		const res = await getTraceSpanRecord("s1", { environment: "production" });
		expect(res).toEqual({
			err: "Span not found in the selected telemetry source",
			record: undefined,
		});
	});

	it("reports the underlying error using only an environment hint (no traceId)", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			getSpan: jest.fn().mockRejectedValue(new Error("lookup boom")),
		});

		const res = await getTraceSpanRecord("s1", { environment: "production" });
		expect(res).toEqual({ err: "lookup boom", record: undefined });
	});
});

describe("getTraceRecordByTraceId empty trace", () => {
	it("returns an undefined record when the trace has no spans", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			getTraceSpans: jest.fn().mockResolvedValue([]),
		});

		const res = await getTraceRecordByTraceId("t-empty");
		expect(res).toEqual({ err: null, record: undefined });
	});
});

describe("treesForListedTraces mixed results", () => {
	it("still returns every listed (summary) row when only some trace ids resolve full trees", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		// Tempo Explore-style summary rows: SpanId reuses TraceId, no attributes,
		// which is what triggers the `isTraceSummaryRow` -> treesForListedTraces path.
		const summaryRow = (traceId: string) => ({
			traceId,
			spanId: traceId,
			parentSpanId: "",
			name: "chat",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		});
		const fullSpan = { ...summaryRow("t-full"), spanId: "child", parentSpanId: "root" };
		const listSpans = jest.fn().mockResolvedValue({
			rows: [summaryRow("t-full"), summaryRow("t-empty")],
		});
		const getTraceSpans = jest.fn().mockImplementation((traceId: string) =>
			Promise.resolve(traceId === "t-full" ? [fullSpan] : [])
		);
		mockGetAdapter.mockResolvedValue({ listSpans, getTraceSpans });

		const res = await listTraceRecords(params as never);
		// treesForListedTraces only feeds loop-hit detection (withLoopHits); the
		// emitted records still mirror the originally listed summary rows.
		expect(res.err).toBeNull();
		expect(getTraceSpans).toHaveBeenCalledWith("t-full");
		expect(getTraceSpans).toHaveBeenCalledWith("t-empty");
		expect(res.records?.map((r) => r.TraceId)).toEqual(["t-full", "t-empty"]);
	});
});

describe("listedSpansForIssueSample additional branches", () => {
	it("returns an empty array immediately when there are no listed spans", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockResolvedValue({ rows: [] }),
		});

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);
		expect(res).toMatchObject({ err: null, records: [] });
	});

	it("returns the listed rows unchanged when the adapter cannot expand full traces", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const summaryRow = {
			traceId: "t-no-expand",
			spanId: "t-no-expand",
			parentSpanId: "",
			name: "GET /health",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockResolvedValue({ rows: [summaryRow] }),
		});

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);
		expect(res.err).toBeNull();
	});

	it("deduplicates repeated trace ids in the listed rows", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const summaryRow = {
			traceId: "t-dup",
			spanId: "t-dup",
			parentSpanId: "",
			name: "GET /health",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		const listSpans = jest.fn().mockResolvedValue({ rows: [summaryRow, { ...summaryRow }] });
		const getTraceSpans = jest.fn().mockResolvedValue([]);
		mockGetAdapter.mockResolvedValue({ listSpans, getTraceSpans });

		await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);
		expect(getTraceSpans).toHaveBeenCalledTimes(1);
	});
});

describe("attachClickHouseLoopHits additional branches", () => {
	it("skips a record whose TraceId does not have a matching loop hit", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		(fetchLoopHitsByTraceIds as jest.Mock).mockResolvedValue(
			new Map([["t-has-hit", { toolName: "search", count: 2 }]])
		);
		const rowFor = (traceId: string) => ({
			traceId,
			spanId: traceId,
			parentSpanId: "",
			name: "chat",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		});
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockResolvedValue({ rows: [rowFor("t-has-hit"), rowFor("t-no-hit")] }),
		});

		const res = await listTraceRecords(params as never);
		const byTrace = new Map((res.records || []).map((r: any) => [r.TraceId, r]));
		expect((byTrace.get("t-has-hit") as any)?.agentLoop).toBeDefined();
		expect((byTrace.get("t-no-hit") as any)?.agentLoop).toBeUndefined();
	});

	it("uses an empty selectedConfig default when params omit it", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		(fetchLoopHitsByTraceIds as jest.Mock).mockResolvedValue(new Map());
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockResolvedValue({
				rows: [
					{
						traceId: "t1",
						spanId: "t1",
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
			}),
		});

		const { selectedConfig: _drop, ...rest } = params;
		const res = await listTraceRecords(rest as never);
		expect(res.err).toBeNull();
	});
});

describe("asErrorMessage additional branches", () => {
	// `rethrowIfSourceFailure` unconditionally rethrows AdapterError before
	// `asErrorMessage` ever runs, so its `err instanceof AdapterError` branch
	// (reading `err.details?.body`) is unreachable from every call site in
	// this file today; listSpans failing with an AdapterError propagates as a
	// rejection instead of a soft `{ err }` payload.
	it("rethrows an AdapterError instead of returning a soft error payload", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			listSpans: jest
				.fn()
				.mockRejectedValue(new AdapterError("EXECUTION_FAILED", "adapter died")),
			countTraces: undefined,
		});

		await expect(listTraceRecords(params as never)).rejects.toThrow("adapter died");
	});

	it("stringifies a plain string throw", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockRejectedValue("plain string failure"),
		});

		const res = await listTraceRecords(params as never);
		expect(res).toEqual({ err: "plain string failure" });
	});

	it("falls back to the generic widget-run-failed message for a non-Error, non-string throw", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockRejectedValue({ code: 42 }),
		});

		const res = await listTraceRecords(params as never);
		expect(res.err).toBeTruthy();
	});
});

describe("listTraceRecords countTraces failure branch", () => {
	it("falls back to the sampled total when countTraces rejects", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const row = {
			traceId: "t1",
			spanId: "t1",
			parentSpanId: "",
			name: "chat",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {},
			resourceAttributes: {},
		};
		mockGetAdapter.mockResolvedValue({
			listSpans: jest.fn().mockResolvedValue({ rows: [row] }),
			countTraces: jest.fn().mockRejectedValue(new Error("count boom")),
		});

		const res = await listTraceRecords(params as never);
		expect(res.err).toBeNull();
		expect(res.total).toBeGreaterThan(0);
	});
});

describe("listSampledIssueRecords param defaults", () => {
	it("defaults the page size to 25 when params omit limit", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const sampleTracesForGraph = jest.fn().mockResolvedValue([]);
		mockGetAdapter.mockResolvedValue({ sampleTracesForGraph, listSpans: jest.fn() });

		const { limit: _drop, ...rest } = params;
		const res = await listTraceRecords({
			...rest,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(res).toMatchObject({ err: null, records: [] });
	});

	it("treats a missing frame.rows as an empty sample in the listSpans fallback path", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const listSpans = jest.fn().mockResolvedValue({});
		mockGetAdapter.mockResolvedValue({ listSpans });

		const res = await listTraceRecords({
			...params,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);
		expect(res).toMatchObject({ err: null, records: [] });
	});
});

describe("sampledIssueListResult page-boundary total", () => {
	it("adds one extra to the total when the page is exactly full and more may exist", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const swappedRow = (i: number) => ({
			traceId: `t-swap-${i}`,
			spanId: `t-swap-${i}`,
			parentSpanId: "",
			name: "openai.chat.completions",
			serviceName: "api",
			timestamp: "2026-07-01T00:00:00.000Z",
			durationNs: 1,
			statusCode: "OK",
			spanAttributes: {
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.response.model": "gpt-4o-mini",
			},
			resourceAttributes: {},
		});
		// GENERATION_HEALTH_SAMPLE_TRACES (200) matching rows, all "swapped" —
		// budget never needs to grow, and truncated is true (unique >= budget).
		const rows = Array.from({ length: 200 }, (_, i) => swappedRow(i));
		const sampleTracesForGraph = jest.fn().mockResolvedValue(rows);
		mockGetAdapter.mockResolvedValue({ sampleTracesForGraph, listSpans: jest.fn() });

		const res = await listTraceRecords({
			...params,
			limit: 200,
			offset: 0,
			selectedConfig: { generationHealth: ["swapped"] },
		} as never);

		expect(res.total).toBe(201);
	});
});
