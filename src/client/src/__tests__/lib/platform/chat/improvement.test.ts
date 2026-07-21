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

	it("defaults null data to an empty array and filters by analysis type", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ data: null });
		const { data } = await getTraceAnalysisRuns("span-abc", undefined, "span_analysis");
		expect(data).toEqual([]);
		expect((dataCollector as jest.Mock).mock.calls[0][0].query).toContain(
			"analysis_type = 'span_analysis'"
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

	it("returns hierarchy-not-found when the record has no SpanId", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: {},
			err: null,
		});

		await expect(getTraceImprovement("missing")).resolves.toEqual({
			err: "Trace hierarchy not found",
		});
	});

	it("returns empty runs when the runs query errors", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: hierarchy,
			err: null,
		});
		(dataCollector as jest.Mock).mockResolvedValue({ err: "runs failed" });

		const result = await getTraceImprovement("root-span", "db-1");

		expect(result).toEqual({ data: { rootSpanId: "root-span", runs: [] } });
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

	it("computes worst severity and stores span analysis type", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({ err: null });
		const analysis = {
			...emptyTraceAnalysis("t1"),
			summary: "",
			improvements: [
				{
					id: "f1",
					severity: "critical" as const,
					summary: "bad",
					detail: "worse",
					span_refs: ["root-1"],
				},
			],
			cost: [
				{
					id: "f2",
					severity: "minor" as const,
					summary: "pricey",
					detail: "ok",
					span_refs: ["root-1"],
				},
			],
		};

		const { data } = await saveTraceAnalysisRun({
			...baseArgs,
			analysis,
			analysisType: "span_analysis",
		});
		const insertValues = (dataCollector as jest.Mock).mock.calls[0][0].values[0];

		expect(insertValues.worst_severity).toBe("critical");
		expect(insertValues.analysis_type).toBe("span_analysis");
		expect(insertValues.summary).toBe("");
		expect(data!.worstSeverity).toBe("critical");
		expect(data!.summary).toBe("");
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

	it("returns the default chat-not-configured message when config is empty", async () => {
		(getChatConfigWithApiKey as jest.Mock).mockResolvedValue({ data: null });

		const result = await streamTraceImprovementAnalysis("root-span");

		expect(result.err).toMatch(/Chat not configured/);
	});

	it("returns hierarchy-not-found when the record has no SpanId", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: { SpanName: "orphan" },
			err: null,
		});

		const result = await streamTraceImprovementAnalysis("root-span", "db-1");

		expect(result).toEqual({ err: "Trace hierarchy not found" });
	});

	it("streams span-scope analysis and falls back when the grader returns unparseable JSON", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: hierarchy,
			err: null,
		});
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [], err: null })
			.mockResolvedValueOnce({ err: null });

		let call = 0;
		(streamText as jest.Mock).mockImplementation(({ system, onFinish }) => {
			call += 1;
			onFinish({ usage: { inputTokens: 3, outputTokens: 1 } });
			const isGrader = String(system).includes("quality grader");
			return {
				fullStream: (async function* () {
					if (isGrader) {
						yield { type: "text-delta", text: "not-json-grader" };
						return;
					}
					yield {
						type: "text-delta",
						text: JSON.stringify({
							summary: "first pass ok",
							findings: [
								{
									severity: "bogus",
									summary: "Needs a fix",
									detail: "detail",
									span_refs: ["llm-span"],
									suggested_fix: "tighten prompt",
									suggested_fix_patches: [
										{
											field: "prompt",
											span_ref: "llm-span",
											original: "old",
											replacement: "new",
										},
										{ field: "bad", span_ref: "x" },
										null,
									],
									estimated_savings: { tokens: 5 },
								},
							],
						}),
					};
				})(),
			};
		});

		const result = await streamTraceImprovementAnalysis("llm-span", "db-1", "span");
		const events = await readNdjson(result.response!);
		const dimensionEvent = events.find((event) => event.type === "dimension");
		const doneEvent = events.find((event) => event.type === "done");
		const insertValues = (dataCollector as jest.Mock).mock.calls[1][0].values[0];

		expect(call).toBeGreaterThanOrEqual(12);
		expect(dimensionEvent.findings[0]).toEqual(
			expect.objectContaining({
				severity: "info",
				suggested_fix: "tighten prompt",
				suggested_fix_patches: [
					expect.objectContaining({
						field: "prompt",
						original: "old",
						replacement: "new",
					}),
				],
			})
		);
		expect(insertValues.analysis_type).toBe("span_analysis");
		expect(insertValues.root_span_id).toBe("llm-span");
		expect(doneEvent).toBeDefined();
	});

	it("emits a stream error when saving the analysis run fails", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: hierarchy,
			err: null,
		});
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [], err: null })
			.mockResolvedValueOnce({ err: "insert failed" });
		mockDimensionStreams();

		const result = await streamTraceImprovementAnalysis("root-span", "db-1");
		const events = await readNdjson(result.response!);

		expect(events.find((event) => event.type === "error")).toEqual({
			type: "error",
			error: "Failed to save trace analysis run",
		});
		expect(events.find((event) => event.type === "done")).toBeUndefined();
	});

	it("keeps first-pass findings when the grader throws", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: hierarchy,
			err: null,
		});
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [], err: null })
			.mockResolvedValueOnce({ err: null });

		(streamText as jest.Mock).mockImplementation(({ system, onFinish }) => {
			onFinish({ usage: {} });
			if (String(system).includes("quality grader")) {
				return {
					fullStream: (async function* () {
						throw new Error("grader boom");
					})(),
				};
			}
			return {
				fullStream: (async function* () {
					yield {
						type: "text-delta",
						delta: JSON.stringify({
							summary: "kept",
							findings: [
								{
									severity: "major",
									summary: "First pass finding",
									detail: "kept after grader failure",
									span_refs: ["root-span"],
								},
							],
						}),
					};
				})(),
			};
		});

		const result = await streamTraceImprovementAnalysis("root-span", "db-1");
		const events = await readNdjson(result.response!);
		const strengths = events.find(
			(event) => event.type === "dimension" && event.dimension === "strengths"
		);

		expect(strengths.findings[0].summary).toBe("First pass finding");
		expect(events.find((event) => event.type === "done")).toBeDefined();
	});

	it("covers alternate span roles, duration scales, and rule-context failures", async () => {
		const longPrompt = `sk-abcdefghijklmnopqrstuvwxyz ${"x".repeat(900)} Bearer abcdefghijklmnop ${"y".repeat(900)}`;
		const richHierarchy = {
			TraceId: "trace-rich",
			SpanId: "orch-root",
			ParentSpanId: "",
			SpanName: "workflow.orchestrator",
			ServiceName: "rich-service",
			Duration: 25_000,
			StatusCode: "STATUS_CODE_OK",
			ResourceAttributes: {
				"service.name": "rich-service",
				"deployment.environment": "prod",
				"gen_ai.application_name": "demo",
			},
			SpanAttributes: {},
			Events: [],
			children: [
				{
					TraceId: "trace-rich",
					SpanId: "embed-1",
					ParentSpanId: "orch-root",
					SpanName: "embeddings.create",
					Duration: 5,
					StatusCode: "STATUS_CODE_OK",
					SpanAttributes: {
						"gen_ai.content.prompt": JSON.stringify({ text: "embed me" }),
						"gen_ai.usage.input_tokens": 11,
					},
					Events: [],
					children: [],
				},
				{
					TraceId: "trace-rich",
					SpanId: "retriev-1",
					ParentSpanId: "orch-root",
					SpanName: "vector.search",
					Duration: 12,
					StatusCode: "STATUS_CODE_OK",
					SpanAttributes: {
						prompt: "find docs",
						"gen_ai.usage.input_tokens": 4,
					},
					Events: [],
					children: [],
				},
				{
					TraceId: "trace-rich",
					SpanId: "db-1",
					ParentSpanId: "orch-root",
					SpanName: "db.query",
					Duration: 8,
					StatusCode: "STATUS_CODE_OK",
					SpanAttributes: {
						"db.query.text": "SELECT 1",
						"db.system.name": "postgres",
					},
					Events: [],
					children: [],
				},
				{
					TraceId: "trace-rich",
					SpanId: "http-1",
					ParentSpanId: "orch-root",
					SpanName: "http.request",
					Duration: 9,
					StatusCode: "STATUS_CODE_OK",
					SpanAttributes: {
						"http.method": "GET",
						"http.url": "https://example.com/api",
					},
					Events: [],
					children: [],
				},
				{
					TraceId: "trace-rich",
					SpanId: "tool-a",
					ParentSpanId: "orch-root",
					SpanName: "tool.search",
					Duration: 15,
					StatusCode: "STATUS_CODE_ERROR",
					StatusMessage: "boom",
					SpanAttributes: {
						"gen_ai.tool.name": "search",
						"gen_ai.tool.call.arguments": JSON.stringify({ q: "same" }),
						"error.message": "temporary",
					},
					Events: [],
					children: [],
				},
				{
					TraceId: "trace-rich",
					SpanId: "tool-b",
					ParentSpanId: "orch-root",
					SpanName: "tool.search",
					Duration: 16,
					StatusCode: "STATUS_CODE_OK",
					SpanAttributes: {
						"gen_ai.tool.name": "search",
						"gen_ai.tool.call.arguments": JSON.stringify({ q: "same" }),
						"gen_ai.tool.result": JSON.stringify({ result: "ok" }),
					},
					Events: [],
					children: [],
				},
				{
					TraceId: "trace-rich",
					SpanId: "llm-secret",
					ParentSpanId: "orch-root",
					SpanName: "llm.completion",
					Duration: 2_500_000_000,
					StatusCode: "STATUS_CODE_OK",
					Cost: 0.02,
					SpanAttributes: {
						"gen_ai.request.model": "gpt-4o",
						"gen_ai.system": "openai",
						"gen_ai.usage.input_tokens": 200,
						"gen_ai.usage.output_tokens": 50,
						"gen_ai.usage.cache_read_input_tokens": 40,
						"gen_ai.usage.cache_creation_input_tokens": 10,
						"gen_ai.usage.reasoning_tokens": 5,
						"gen_ai.content.prompt": longPrompt,
						"gen_ai.content.completion": JSON.stringify({
							content: [{ text: "answer" }],
						}),
						"gen_ai.system_instructions": "be careful",
						"gen_ai.content.reasoning": "thinking",
					},
					Events: [
						{
							Name: "gen_ai.completion",
							Attributes: { completion: "event completion" },
						},
					],
					children: [],
				},
				{
					TraceId: "trace-rich",
					SpanId: "unknown-1",
					ParentSpanId: "orch-root",
					SpanName: "misc.work",
					Duration: Number.NaN,
					StatusCode: "STATUS_CODE_OK",
					SpanAttributes: { "not.a.role": true },
					Events: [],
					children: [],
				},
			],
		};

		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: richHierarchy,
			err: null,
		});
		(getContextFromRuleEngineForTrace as jest.Mock).mockRejectedValue(
			new Error("rule engine down")
		);
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [{ id: "prior" }], err: null })
			.mockResolvedValueOnce({ err: null });
		(streamText as jest.Mock).mockImplementation(({ onFinish }) => {
			onFinish({ usage: { inputTokens: 2, outputTokens: 1 } });
			return {
				fullStream: (async function* () {
					yield {
						type: "text-delta",
						delta: "```json\n" + JSON.stringify([
							{
								severity: "critical",
								summary: "Array finding",
								detail: "parsed from array shape",
								span_refs: ["orch-root"],
							},
						]) + "\n```",
					};
				})(),
			};
		});

		const result = await streamTraceImprovementAnalysis("orch-root", "db-1");
		const events = await readNdjson(result.response!);
		const doneEvent = events.find((event) => event.type === "done");
		const insertValues = (dataCollector as jest.Mock).mock.calls[1][0].values[0];

		expect(doneEvent.data.runs).toHaveLength(2);
		expect(insertValues.worst_severity).toBe("critical");
		expect(insertValues.run_number).toBe(2);
		expect(JSON.parse(insertValues.analysis_json).totals.span_count).toBe(9);
	});

	it("parses findings nested under a dimension key and ignores non-text stream parts", async () => {
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: hierarchy,
			err: null,
		});
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [], err: null })
			.mockResolvedValueOnce({ err: null });
		(streamText as jest.Mock).mockImplementation(({ system, onFinish }) => {
			onFinish({ usage: { inputTokens: 1, outputTokens: 1 } });
			const dimension = String(system).match(/Dimension: ([^\n]+)/)?.[1] || "improvements";
			return {
				fullStream: (async function* () {
					yield { type: "reasoning-delta", delta: "ignore me" };
					yield {
						type: "text-delta",
						delta: JSON.stringify({
							summary: "dimension key shape",
							[dimension]: [
								{
									id: "fixed-id",
									severity: "minor",
									summary: "From dimension key",
									detail: "ok",
									span_refs: ["root-span"],
									suggested_fix_patches: [
										{
											field: "response",
											span_ref: "root-span",
											original: "a",
											replacement: "b",
										},
									],
								},
							],
						}),
					};
				})(),
			};
		});

		const result = await streamTraceImprovementAnalysis("root-span", "db-1");
		const events = await readNdjson(result.response!);
		const first = events.find((event) => event.type === "dimension");

		expect(first.findings[0]).toEqual(
			expect.objectContaining({
				id: "fixed-id",
				summary: "From dimension key",
				suggested_fix_patches: [
					expect.objectContaining({ field: "response" }),
				],
			})
		);
	});

	it("covers stream error fallback and role classification via hierarchy metrics", async () => {
		const toolHeavy = {
			...hierarchy,
			children: [
				{
					...hierarchy.children[0],
					SpanName: "tool.execute",
					SpanAttributes: {
						...hierarchy.children[0].SpanAttributes,
						"gen_ai.tool.call.arguments": JSON.stringify({ q: "same" }),
					},
				},
				{
					...hierarchy.children[0],
					SpanId: "tool-span-2",
					SpanName: "tool.execute",
					SpanAttributes: {
						...hierarchy.children[0].SpanAttributes,
						"gen_ai.tool.call.arguments": JSON.stringify({ q: "same" }),
					},
				},
				hierarchy.children[1],
			],
		};

		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: toolHeavy,
			err: null,
		});
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [], err: null })
			.mockResolvedValueOnce({ err: null });
		(streamText as jest.Mock).mockImplementation(({ onFinish }) => {
			onFinish({ usage: { inputTokens: 1, outputTokens: 1 } });
			return {
				fullStream: (async function* () {
					yield {
						type: "text-delta",
						delta: JSON.stringify({
							summary: "ok",
							improvements: [
								{
									severity: "info",
									summary: "tool reuse",
									detail: "same tool",
									span_refs: ["tool-span", "tool-span-2"],
								},
							],
						}),
					};
				})(),
			};
		});

		const ok = await streamTraceImprovementAnalysis("root-span", "db-1");
		const okEvents = await readNdjson(ok.response!);
		const detailEvent = okEvents.find(
			(e) =>
				e.type === "step" &&
				typeof e.detail === "string" &&
				/LLM calls/.test(e.detail)
		);
		expect(detailEvent?.detail).toMatch(/2 tools/);
		const debugContext = okEvents.find(
			(e) => e.type === "debug" && e.stage === "context_extracted"
		);
		expect((debugContext?.payload as any).toolCallCount).toBe(2);
		expect((debugContext?.payload as any).duplicateToolInputs).toEqual(
			expect.arrayContaining([expect.objectContaining({ count: 2 })])
		);

		(streamText as jest.Mock).mockImplementation(() => {
			throw { notMessage: true };
		});
		(getHeirarchyViaSpanId as jest.Mock).mockResolvedValue({
			record: hierarchy,
			err: null,
		});
		(dataCollector as jest.Mock).mockResolvedValueOnce({ data: [], err: null });

		const result = await streamTraceImprovementAnalysis("root-span", "db-1");
		const events = await readNdjson(result.response!);
		expect(events.some((e) => e.type === "error")).toBe(true);
		const errEvent = events.find((e) => e.type === "error");
		expect(errEvent?.error).toBe("Failed to run AI improvement analysis");
	});
});
