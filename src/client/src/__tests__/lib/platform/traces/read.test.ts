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

import {
	getTraceHierarchy,
	getTraceRecordByTraceId,
	getTraceSpanRecord,
	listTraceRecords,
} from "@/lib/platform/traces/read";

const builtin = {
	type: "clickhouse",
	id: "builtin:db-1",
	isBuiltIn: true,
	settings: {},
	signals: ["traces", "logs", "metrics"],
	name: "CH",
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
	it("delegates to ClickHouse getRequests for the built-in source", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		mockGetAdapter.mockResolvedValue({});
		mockGetRequests.mockResolvedValue({ records: [{ SpanId: "s1" }], total: 1 });

		const res = await listTraceRecords(params as never);
		expect(mockGetRequests).toHaveBeenCalledWith(params);
		expect(res).toEqual({ records: [{ SpanId: "s1" }], total: 1 });
		expect(mockGetAdapter).toHaveBeenCalledWith({ signal: "traces" });
	});

	it("lists via the external adapter and denormalizes rows", async () => {
		mockResolveDescriptor.mockResolvedValue(tempo);
		const listSpans = jest.fn().mockResolvedValue({
			fields: [],
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
					spanAttributes: { "gen_ai.request.model": "gpt-4o" },
					resourceAttributes: { "service.name": "api" },
				},
			],
		});
		mockGetAdapter.mockResolvedValue({ listSpans });

		const res = await listTraceRecords(params as never);
		expect(listSpans).toHaveBeenCalled();
		expect(res.err).toBeNull();
		expect(res.records?.[0]).toMatchObject({
			TraceId: "t1",
			SpanId: "s1",
			SpanName: "chat",
			ServiceName: "api",
		});
		expect(mockGetRequests).not.toHaveBeenCalled();
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

	it("delegates hierarchy to ClickHouse for the built-in source", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		mockGetAdapter.mockResolvedValue({});
		mockGetHeirarchyViaSpanId.mockResolvedValue({
			err: null,
			record: { SpanId: "s1" },
		});

		const res = await getTraceHierarchy("s1");
		expect(mockGetHeirarchyViaSpanId).toHaveBeenCalledWith("s1");
		expect(res.record).toMatchObject({ SpanId: "s1" });
	});
});
