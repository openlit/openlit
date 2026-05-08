jest.mock("ai", () => ({ streamText: jest.fn() }));
jest.mock("@/lib/platform/chat/stream", () => ({ getModelInstance: jest.fn() }));
jest.mock("@/lib/platform/chat/config", () => ({ getChatConfigWithApiKey: jest.fn() }));
jest.mock("@/lib/platform/chat/conversation", () => ({
	getImprovementConversationByHierarchySpanIds: jest.fn(),
}));
jest.mock("@/lib/platform/request", () => ({ getHeirarchyViaSpanId: jest.fn() }));
jest.mock("@/lib/platform/common", () => ({ dataCollector: jest.fn() }));
jest.mock("@/lib/platform/chat/table-details", () => ({
	OPENLIT_CHAT_CONVERSATION_TABLE: "openlit_chat_conversation",
	OPENLIT_CHAT_MESSAGE_TABLE: "openlit_chat_message",
	OPENLIT_TRACE_ANALYSIS_TABLE: "openlit_trace_analysis",
}));
jest.mock("@/utils/sanitizer", () => ({
	__esModule: true,
	default: { sanitizeValue: jest.fn((v: string) => v) },
}));

import { dataCollector } from "@/lib/platform/common";
import {
	getTraceAnalysisRuns,
	saveTraceAnalysisRun,
	TraceAnalysisRun,
} from "@/lib/platform/chat/improvement";
import { emptyTraceAnalysis } from "@/types/trace-analysis";

beforeEach(() => {
	jest.clearAllMocks();
	(dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
});

// ─── getTraceAnalysisRuns ─────────────────────────────────────────────────────

describe("getTraceAnalysisRuns", () => {
	it("queries the dedicated table by root_span_id", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ data: [] });
		await getTraceAnalysisRuns("span-abc");
		const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
		expect(query).toContain("openlit_trace_analysis");
		expect(query).toContain("root_span_id = 'span-abc'");
		expect(query).toContain("ORDER BY run_number ASC");
	});

	it("returns empty array when table has no matching rows", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ data: [] });
		const { data } = await getTraceAnalysisRuns("span-xyz");
		expect(data).toEqual([]);
	});

	it("returns mapped runs when rows exist", async () => {
		const row = {
			id: "run-id-1",
			rootSpanId: "span-abc",
			selectedSpanId: "span-abc",
			runNumber: 1,
			analysisJson: '{"trace_id":"t1"}',
			summary: "ok",
			modelProvider: "openai",
			modelName: "gpt-4o",
			promptTokens: 100,
			completionTokens: 50,
			cost: 0.001,
			createdAt: "2025-01-01T00:00:00.000Z",
		};
		(dataCollector as jest.Mock).mockResolvedValue({ data: [row] });
		const { data } = await getTraceAnalysisRuns("span-abc");
		expect(data).toHaveLength(1);
		expect(data![0].id).toBe("run-id-1");
		expect(data![0].runNumber).toBe(1);
	});

	it("forwards database errors", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ err: "db error" });
		const { err } = await getTraceAnalysisRuns("span-abc");
		expect(err).toBe("db error");
	});

	it("passes databaseConfigId to dataCollector", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ data: [] });
		await getTraceAnalysisRuns("span-abc", "db-config-1");
		expect(dataCollector).toHaveBeenCalledWith(
			expect.any(Object),
			"query",
			"db-config-1"
		);
	});
});

// ─── saveTraceAnalysisRun ────────────────────────────────────────────────────

describe("saveTraceAnalysisRun", () => {
	const baseArgs = {
		rootSpanId: "root-1",
		selectedSpanId: "sel-1",
		runNumber: 1,
		analysis: emptyTraceAnalysis("trace-1"),
		modelProvider: "anthropic",
		modelName: "claude-3-5-sonnet",
		promptTokens: 200,
		completionTokens: 100,
		cost: 0.005,
	};

	it("inserts into openlit_trace_analysis table", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ err: null });
		await saveTraceAnalysisRun(baseArgs);
		const call = (dataCollector as jest.Mock).mock.calls[0];
		expect(call[0].table).toBe("openlit_trace_analysis");
		expect(call[1]).toBe("insert");
	});

	it("returns a run with a generated id and createdAt", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ err: null });
		const { data } = await saveTraceAnalysisRun(baseArgs);
		expect(data).toBeDefined();
		expect(data!.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		);
		expect(data!.createdAt).toBeTruthy();
	});

	it("stores the id passed into the insert values", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ err: null });
		const { data } = await saveTraceAnalysisRun(baseArgs);
		const insertValues = (dataCollector as jest.Mock).mock.calls[0][0].values[0];
		expect(insertValues.id).toBe(data!.id);
	});

	it("returns correct run fields echoed back", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ err: null });
		const { data } = await saveTraceAnalysisRun(baseArgs);
		expect(data!.rootSpanId).toBe("root-1");
		expect(data!.runNumber).toBe(1);
		expect(data!.promptTokens).toBe(200);
		expect(data!.cost).toBe(0.005);
	});

	it("returns error when insert fails", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ err: "insert failed" });
		const { err, data } = await saveTraceAnalysisRun(baseArgs);
		expect(err).toBe("insert failed");
		expect(data).toBeUndefined();
	});

	it("serialises analysis as JSON in analysis_json field", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ err: null });
		const analysis = { ...emptyTraceAnalysis("t1"), summary: "great trace" };
		await saveTraceAnalysisRun({ ...baseArgs, analysis });
		const insertValues = (dataCollector as jest.Mock).mock.calls[0][0].values[0];
		const parsed = JSON.parse(insertValues.analysis_json);
		expect(parsed.summary).toBe("great trace");
	});

	it("increments run_number correctly for second run", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ err: null });
		const { data } = await saveTraceAnalysisRun({ ...baseArgs, runNumber: 2 });
		const insertValues = (dataCollector as jest.Mock).mock.calls[0][0].values[0];
		expect(insertValues.run_number).toBe(2);
		expect(data!.runNumber).toBe(2);
	});
});
