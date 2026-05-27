jest.mock("ai", () => ({ streamText: jest.fn() }));
import { TextDecoder, TextEncoder } from "util";
import { ReadableStream } from "stream/web";

class TestResponse {
	constructor(private stream: ReadableStream<Uint8Array>) {}

	async text() {
		const reader = this.stream.getReader();
		const decoder = new TextDecoder();
		let text = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		return text;
	}
}

Object.assign(global, {
	ReadableStream,
	Response: TestResponse,
	TextDecoder,
	TextEncoder,
});

jest.mock("@/lib/platform/chat/stream", () => ({ getModelInstance: jest.fn() }));
jest.mock("@/lib/platform/chat/config", () => ({ getChatConfigWithApiKey: jest.fn() }));
jest.mock("@/lib/platform/request", () => ({ getHeirarchyViaSpanId: jest.fn() }));
jest.mock("@/lib/platform/common", () => ({ dataCollector: jest.fn() }));
jest.mock("@/lib/platform/evaluation/rule-engine-context", () => ({
	getContextFromRuleEngineForTrace: jest.fn(),
}));
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
import { getChatConfigWithApiKey } from "@/lib/platform/chat/config";
import {
	getTraceAnalysisRuns,
	getTraceImprovement,
	saveTraceAnalysisRun,
	streamTraceImprovementAnalysis,
	TraceAnalysisRun,
} from "@/lib/platform/chat/improvement";
import { getModelInstance } from "@/lib/platform/chat/stream";
import { getHeirarchyViaSpanId } from "@/lib/platform/request";
import { streamText } from "ai";
import { emptyTraceAnalysis } from "@/types/trace-analysis";
import { getContextFromRuleEngineForTrace } from "@/lib/platform/evaluation/rule-engine-context";

beforeEach(() => {
	jest.clearAllMocks();
	(dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
	(getChatConfigWithApiKey as jest.Mock).mockResolvedValue({
		data: { provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" },
	});
	(getModelInstance as jest.Mock).mockReturnValue("model-instance");
	(getContextFromRuleEngineForTrace as jest.Mock).mockResolvedValue({
		matchingRuleIds: ["rule-1"],
		contextEntityIds: ["ctx-1"],
		contextContents: ["Prefer short tool outputs and cite spans."],
	});
});

const hierarchy = {
	TraceId: "trace-1",
	SpanId: "root-span",
	ParentSpanId: "",
	SpanName: "agent.root",
	ServiceName: "agent-service",
	Duration: 2_000_000,
	StatusCode: "STATUS_CODE_OK",
	ResourceAttributes: {
		"service.name": "agent-service",
		"deployment.environment": "test",
	},
	SpanAttributes: {
		"gen_ai.request.model": "gpt-4o-mini",
		"gen_ai.system": "openai",
		"gen_ai.usage.input_tokens": 20,
		"gen_ai.usage.output_tokens": 10,
		"gen_ai.usage.total_tokens": 30,
		"gen_ai.usage.cost": 0.001,
		"gen_ai.input.messages": JSON.stringify([{ role: "user", content: "Summarize this trace" }]),
		"gen_ai.output.messages": JSON.stringify([{ role: "assistant", content: "Trace summarized" }]),
	},
	Events: [
		{
			Name: "gen_ai.prompt",
			Attributes: { "gen_ai.prompt": "event prompt text" },
		},
	],
	children: [
		{
			TraceId: "trace-1",
			SpanId: "tool-span",
			ParentSpanId: "root-span",
			SpanName: "tool.search",
			ServiceName: "agent-service",
			Duration: 1_500_000,
			StatusCode: "STATUS_CODE_ERROR",
			StatusMessage: "Search failed once",
			ResourceAttributes: { "service.name": "agent-service" },
			SpanAttributes: {
				"gen_ai.tool.name": "search",
				"gen_ai.tool.call.arguments": JSON.stringify({ query: "billing issue" }),
				"gen_ai.tool.result": "temporary failure",
				"error.message": "temporary search failure",
			},
			Events: [],
			children: [],
		},
		{
			TraceId: "trace-1",
			SpanId: "llm-span",
			ParentSpanId: "root-span",
			SpanName: "llm.completion",
			ServiceName: "agent-service",
			Duration: 3_000_000,
			StatusCode: "STATUS_CODE_OK",
			ResourceAttributes: { "service.name": "agent-service" },
			SpanAttributes: {
				"gen_ai.request.model": "gpt-4o-mini",
				"gen_ai.system": "openai",
				"gen_ai.usage.input_tokens": 100,
				"gen_ai.usage.output_tokens": 40,
				"gen_ai.usage.total_tokens": 140,
				"gen_ai.usage.cache_read_input_tokens": 25,
				"gen_ai.usage.cost": 0.004,
				"gen_ai.content.prompt": "Use the search result and answer.",
				"gen_ai.content.completion": "Here is the answer.",
			},
			Events: [],
			children: [],
		},
	],
};

async function readNdjson(response: Response) {
	const text = await response.text();
	return text
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

function mockDimensionStreams() {
	(streamText as jest.Mock).mockImplementation(({ system, onFinish }) => {
		const dimension = String(system).match(/Dimension: ([^\n]+)/)?.[1] || "improvements";
		onFinish({ usage: { inputTokens: 10, outputTokens: 2 } });
		return {
			fullStream: (async function* () {
				yield {
					type: "text-delta",
					delta: JSON.stringify({
						summary: `${dimension} checked`,
						findings: dimension === "strengths"
							? [
									{
										severity: "info",
										summary: "Prompt and response stayed compact",
										detail: "The root LLM call used a small prompt and produced a short answer.",
										span_refs: ["root-span"],
									},
								]
							: [],
					}),
				};
			})(),
		};
	});
}

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

// ─── getTraceImprovement ─────────────────────────────────────────────────────

describe("getTraceImprovement", () => {
	it("returns hierarchy errors before querying saved runs", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			err: "Span not found",
			record: {},
		});

		const result = await getTraceImprovement("missing-span", "db-1");

		expect(result).toEqual({ err: "Span not found" });
		expect(dataCollector).not.toHaveBeenCalled();
	});

	it("loads trace-scope runs using the root span id", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: hierarchy,
			err: null,
		});
		(dataCollector as jest.Mock).mockResolvedValue({
			data: [{ id: "run-1", rootSpanId: "root-span", runNumber: 1 }],
			err: null,
		});

		const result = await getTraceImprovement("llm-span", "db-1");

		expect(result.data).toEqual({
			rootSpanId: "root-span",
			runs: [{ id: "run-1", rootSpanId: "root-span", runNumber: 1 }],
		});
		expect((dataCollector as jest.Mock).mock.calls[0][0].query).toContain(
			"root_span_id = 'root-span'"
		);
		expect((dataCollector as jest.Mock).mock.calls[0][0].query).toContain(
			"analysis_type = 'trace_analysis'"
		);
	});

	it("loads span-scope runs using the selected span id", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: hierarchy,
			err: null,
		});
		(dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });

		const result = await getTraceImprovement("llm-span", "db-1", "span");

		expect(result.data).toEqual({ rootSpanId: "llm-span", runs: [] });
		expect((dataCollector as jest.Mock).mock.calls[0][0].query).toContain(
			"root_span_id = 'llm-span'"
		);
		expect((dataCollector as jest.Mock).mock.calls[0][0].query).toContain(
			"analysis_type = 'span_analysis'"
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

// ─── streamTraceImprovementAnalysis ──────────────────────────────────────────

describe("streamTraceImprovementAnalysis", () => {
	it("returns a configuration error before loading hierarchy", async () => {
		(getChatConfigWithApiKey as jest.Mock).mockResolvedValue({
			err: "Chat not configured",
		});

		const result = await streamTraceImprovementAnalysis("root-span", "db-1");

		expect(result).toEqual({ err: "Chat not configured" });
		expect(getHeirarchyViaSpanId).not.toHaveBeenCalled();
	});

	it("returns a hierarchy error before streaming model output", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			err: "Trace hierarchy not found",
			record: {},
		});

		const result = await streamTraceImprovementAnalysis("root-span", "db-1");

		expect(result).toEqual({ err: "Trace hierarchy not found" });
		expect(streamText).not.toHaveBeenCalled();
	});

		it("streams six dimension analyses with grader passes, saves the run, and emits done data", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: hierarchy,
			err: null,
		});
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [], err: null })
			.mockResolvedValueOnce({ err: null });
		mockDimensionStreams();

		const result = await streamTraceImprovementAnalysis("llm-span", "db-1");
		expect(result.err).toBeUndefined();

		const events = await readNdjson(result.response!);
		const dimensionEvents = events.filter((event) => event.type === "dimension");
		const doneEvent = events.find((event) => event.type === "done");
		const insertValues = (dataCollector as jest.Mock).mock.calls[1][0].values[0];

			expect(streamText).toHaveBeenCalledTimes(12);
			expect(getModelInstance).toHaveBeenCalledWith("openai", "sk-test", "gpt-4o-mini");
		expect(dimensionEvents.map((event) => event.dimension)).toEqual([
			"strengths",
			"improvements",
			"wrong_turns",
			"cost",
			"token_efficiency",
			"path_analysis",
		]);
		expect(dimensionEvents[0].findings[0]).toEqual(
			expect.objectContaining({
				severity: "info",
				summary: "Prompt and response stayed compact",
				span_refs: ["root-span"],
			})
		);
		expect(insertValues.root_span_id).toBe("root-span");
		expect(insertValues.selected_span_id).toBe("llm-span");
		expect(insertValues.analysis_type).toBe("trace_analysis");
			expect(insertValues.prompt_tokens).toBe(120);
			expect(insertValues.completion_tokens).toBe(24);
		expect(JSON.parse(insertValues.analysis_json).totals).toEqual({
			span_count: 3,
			total_tokens: 170,
			total_cost_usd: 0.005,
			duration_ms: 6.5,
		});
		expect(doneEvent.data.runs).toHaveLength(1);
	});

	it("streams parse errors as dimension findings and still saves the run", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: hierarchy,
			err: null,
		});
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [], err: null })
			.mockResolvedValueOnce({ err: null });
		(streamText as jest.Mock).mockImplementation(({ onFinish }) => {
			onFinish({ usage: { inputTokens: 1, outputTokens: 1 } });
			return {
				fullStream: (async function* () {
					yield { type: "text-delta", delta: "not json" };
				})(),
			};
		});

		const result = await streamTraceImprovementAnalysis("root-span", "db-1");
		const events = await readNdjson(result.response!);
		const firstDimension = events.find((event) => event.type === "dimension");

		expect(firstDimension.findings[0]).toEqual(
			expect.objectContaining({
				severity: "minor",
				summary: "Strengths analysis could not be parsed",
				span_refs: ["root-span"],
			})
		);
		expect(events.find((event) => event.type === "done")).toBeDefined();
	});
});
