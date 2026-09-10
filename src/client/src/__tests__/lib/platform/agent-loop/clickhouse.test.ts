const mockDataCollector = jest.fn();

jest.mock("@/lib/platform/common", () => ({
	dataCollector: (...a: unknown[]) => mockDataCollector(...a),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));

import {
	fetchLoopHitsByTraceIds,
	fetchLoopHitsByGroupIds,
} from "@/lib/platform/agent-loop/clickhouse";

beforeEach(() => {
	jest.clearAllMocks();
});

describe("fetchLoopHitsByTraceIds", () => {
	it("returns an empty map without querying when there are no trace ids", async () => {
		const result = await fetchLoopHitsByTraceIds("1 = 1", []);
		expect(result).toEqual(new Map());
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("returns an empty map without querying when every id is blank/whitespace", async () => {
		const result = await fetchLoopHitsByTraceIds("1 = 1", ["  ", ""]);
		expect(result).toEqual(new Map());
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("returns an empty map without querying when baseWhere is empty", async () => {
		const result = await fetchLoopHitsByTraceIds("", ["t1"]);
		expect(result).toEqual(new Map());
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("returns an empty map when dataCollector reports an error", async () => {
		mockDataCollector.mockResolvedValue({ err: "boom", data: [] });

		const result = await fetchLoopHitsByTraceIds("1 = 1", ["t1"]);

		expect(result).toEqual(new Map());
		expect(mockDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({ query: expect.stringContaining("otel_traces") }),
			"query",
			undefined
		);
	});

	it("builds a Map keyed by TraceId, skipping blank ids and deduping repeats", async () => {
		mockDataCollector.mockResolvedValue({
			err: null,
			data: [
				{ TraceId: "t1", toolName: "search", count: 4, wastedTokens: 10, wastedCost: 0.1 },
				{ TraceId: "  ", toolName: "search", count: 5, wastedTokens: 1, wastedCost: 0.01 },
				{ TraceId: "t1", toolName: "search", count: 8, wastedTokens: 30, wastedCost: 0.3 },
				{ TraceId: "t2", toolName: "bash", count: 1, wastedTokens: 0, wastedCost: 0 },
			],
		});

		const result = await fetchLoopHitsByTraceIds("1 = 1", ["t1", "t2"], "db-1");

		expect(result.size).toBe(1);
		expect(result.get("t1")).toEqual({
			toolName: "search",
			count: 8,
			wastedTokens: 30,
			wastedCost: 0.3,
		});
		expect(result.has("t2")).toBe(false);
		expect(mockDataCollector).toHaveBeenCalledWith(expect.anything(), "query", "db-1");
	});

	it("dedupes and trims the requested trace ids before building the query", async () => {
		mockDataCollector.mockResolvedValue({ err: null, data: [] });

		await fetchLoopHitsByTraceIds("1 = 1", [" t1 ", "t1", "t2"]);

		const { query } = mockDataCollector.mock.calls[0][0];
		expect(query).toContain("'t1'");
		expect(query).toContain("'t2'");
		expect(query.match(/'t1'/g)?.length).toBe(1);
	});
});

describe("fetchLoopHitsByGroupIds", () => {
	it("returns an empty map without querying when there are no group ids", async () => {
		const result = await fetchLoopHitsByGroupIds("1 = 1", []);
		expect(result).toEqual(new Map());
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("returns an empty map without querying when baseWhere is empty", async () => {
		const result = await fetchLoopHitsByGroupIds("", ["g1"]);
		expect(result).toEqual(new Map());
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("returns an empty map when dataCollector reports an error", async () => {
		mockDataCollector.mockResolvedValue({ err: "boom", data: [] });

		const result = await fetchLoopHitsByGroupIds("1 = 1", ["g1"]);

		expect(result).toEqual(new Map());
	});

	it("builds a Map keyed by groupId, skipping blank ids and deduping repeats", async () => {
		mockDataCollector.mockResolvedValue({
			err: null,
			data: [
				{ groupId: "g1", toolName: "search", count: 4, wastedTokens: 10, wastedCost: 0.1 },
				{ groupId: "", toolName: "search", count: 5, wastedTokens: 1, wastedCost: 0.01 },
				{ groupId: "g1", toolName: "search", count: 9, wastedTokens: 40, wastedCost: 0.4 },
			],
		});

		const result = await fetchLoopHitsByGroupIds("1 = 1", ["g1"], "db-2");

		expect(result.size).toBe(1);
		expect(result.get("g1")).toEqual({
			toolName: "search",
			count: 9,
			wastedTokens: 40,
			wastedCost: 0.4,
		});
		expect(mockDataCollector).toHaveBeenCalledWith(expect.anything(), "query", "db-2");
	});

	it("skips rows whose fields do not satisfy asAgentLoopHit (below threshold)", async () => {
		mockDataCollector.mockResolvedValue({
			err: null,
			data: [{ groupId: "g1", toolName: "search", count: 1, wastedTokens: 0, wastedCost: 0 }],
		});

		const result = await fetchLoopHitsByGroupIds("1 = 1", ["g1"]);
		expect(result.size).toBe(0);
	});

	it("tolerates a successful result with no data array", async () => {
		mockDataCollector.mockResolvedValue({ err: null, data: undefined });

		const result = await fetchLoopHitsByGroupIds("1 = 1", ["g1"]);
		expect(result).toEqual(new Map());
	});
});
