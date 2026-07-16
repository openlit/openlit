import {
	TRACE_ANALYSIS_DIMENSION_DEFINITIONS,
	TRACE_ANALYSIS_DIMENSION_REGISTRY,
	getTraceAnalysisDimensionDefinition,
	selectTraceAnalysisMetrics,
	selectTraceAnalysisSpan,
} from "@/lib/platform/chat/trace-analysis-registry";
import {
	TRACE_ANALYSIS_DIMENSION_LABELS,
	TRACE_ANALYSIS_DIMENSIONS,
} from "@/types/trace-analysis";

const expectedDimensions = [
	"strengths",
	"improvements",
	"wrong_turns",
	"cost",
	"token_efficiency",
	"path_analysis",
];

const expectedUiLabels = {
	strengths: "Strengths",
	improvements: "Improvements",
	wrong_turns: "Wrong turns",
	cost: "Cost",
	token_efficiency: "Token efficiency",
	path_analysis: "Path",
};

const expectedStreamLabels = {
	strengths: "Strengths",
	improvements: "Improvements",
	wrong_turns: "Wrong turns",
	cost: "Cost",
	token_efficiency: "Token efficiency",
	path_analysis: "Path analysis",
};

describe("trace analysis dimension registry", () => {
	it("keeps the six existing dimensions in their stored and streamed order", () => {
		expect(TRACE_ANALYSIS_DIMENSION_DEFINITIONS).toHaveLength(6);
		expect(TRACE_ANALYSIS_DIMENSION_DEFINITIONS.map(({ key }) => key)).toEqual(
			expectedDimensions
		);
		expect(Object.keys(TRACE_ANALYSIS_DIMENSION_REGISTRY)).toEqual(
			expectedDimensions
		);
		expect(TRACE_ANALYSIS_DIMENSIONS).toEqual(expectedDimensions);
	});

	it("derives both legacy label maps without collapsing their path label difference", () => {
		expect(TRACE_ANALYSIS_DIMENSION_LABELS).toEqual(expectedUiLabels);
		expect(
			Object.fromEntries(
				TRACE_ANALYSIS_DIMENSION_DEFINITIONS.map(({ key, streamLabel }) => [
					key,
					streamLabel,
				])
			)
		).toEqual(expectedStreamLabels);
		expect(TRACE_ANALYSIS_DIMENSION_LABELS.path_analysis).toBe("Path");
		expect(
			TRACE_ANALYSIS_DIMENSION_REGISTRY.path_analysis.streamLabel
		).toBe("Path analysis");
	});

	it("freezes the ordered registry and each definition", () => {
		expect(Object.isFrozen(TRACE_ANALYSIS_DIMENSION_DEFINITIONS)).toBe(true);
		expect(Object.isFrozen(TRACE_ANALYSIS_DIMENSION_REGISTRY)).toBe(true);
		for (const definition of TRACE_ANALYSIS_DIMENSION_DEFINITIONS) {
			expect(Object.isFrozen(definition)).toBe(true);
			expect(Object.isFrozen(definition.spanFields)).toBe(true);
			expect(Object.isFrozen(definition.metricFields)).toBe(true);
			expect(Object.isFrozen(definition.emptyStateCopy)).toBe(true);
		}
	});

	it("falls back safely when a persisted dimension key is unknown", () => {
		expect(getTraceAnalysisDimensionDefinition("future_dimension")).toBe(
			TRACE_ANALYSIS_DIMENSION_DEFINITIONS[0]
		);
	});

	it("selects the same focused span and metric fields as the legacy branches", () => {
		const child = {
			spanId: "child-span",
			spanName: "tool.search",
			role: "tool",
			statusCode: "STATUS_CODE_OK",
			statusMessage: "ok",
			durationMs: 4,
			error: undefined,
			model: "gpt-4o-mini",
			provider: "openai",
			cost: 0.001,
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
			cacheReadTokens: 2,
			cacheCreationTokens: 1,
			reasoningTokens: 3,
			systemPrompt: "system",
			prompt: "prompt",
			response: "response",
			toolArgs: "args",
			toolResult: "result",
			children: [],
		};
		const span = {
			...child,
			spanId: "root-span",
			spanName: "agent.root",
			children: [child],
		};

		expect(selectTraceAnalysisSpan(span, "token_efficiency")).toEqual({
			spanId: "root-span",
			spanName: "agent.root",
			role: "tool",
			statusCode: "STATUS_CODE_OK",
			statusMessage: "ok",
			durationMs: 4,
			error: undefined,
			children: [
				{
					spanId: "child-span",
					spanName: "tool.search",
					role: "tool",
					statusCode: "STATUS_CODE_OK",
					statusMessage: "ok",
					durationMs: 4,
					error: undefined,
					children: [],
					model: "gpt-4o-mini",
					promptTokens: 10,
					completionTokens: 5,
					totalTokens: 15,
					cacheReadTokens: 2,
					cacheCreationTokens: 1,
					reasoningTokens: 3,
					systemPrompt: "system",
					prompt: "prompt",
					response: "response",
					toolArgs: "args",
					toolResult: "result",
				},
			],
			model: "gpt-4o-mini",
			promptTokens: 10,
			completionTokens: 5,
			totalTokens: 15,
			cacheReadTokens: 2,
			cacheCreationTokens: 1,
			reasoningTokens: 3,
			systemPrompt: "system",
			prompt: "prompt",
			response: "response",
			toolArgs: "args",
			toolResult: "result",
		});

		const metrics = {
			spanCount: 3,
			maxDepth: 2,
			errorCount: 1,
			llmCallCount: 1,
			toolCallCount: 1,
			retrievalCallCount: 1,
			modelsUsed: ["gpt-4o-mini"],
			toolsUsed: ["search"],
			totalDurationMs: 12,
			repeatedSpanNames: [{ name: "tool.search", count: 2, spanIds: ["a", "b"] }],
			potentialRetrySequences: [{ reason: "same sibling", spanIds: ["a", "b"] }],
			databaseCallCount: 0,
			httpCallCount: 1,
		};

		expect(selectTraceAnalysisMetrics(metrics, "path_analysis")).toEqual({
			spanCount: 3,
			maxDepth: 2,
			errorCount: 1,
			llmCallCount: 1,
			toolCallCount: 1,
			retrievalCallCount: 1,
			modelsUsed: ["gpt-4o-mini"],
			toolsUsed: ["search"],
			totalDurationMs: 12,
			repeatedSpanNames: [{ name: "tool.search", count: 2, spanIds: ["a", "b"] }],
			potentialRetrySequences: [{ reason: "same sibling", spanIds: ["a", "b"] }],
			databaseCallCount: 0,
			httpCallCount: 1,
		});
	});
});
