import {
	TRACE_AI_COST_EMPTY_DETAIL,
	TRACE_AI_COST_EMPTY_SUMMARY,
	TRACE_AI_IMPROVEMENTS_EMPTY_DETAIL,
	TRACE_AI_IMPROVEMENTS_EMPTY_SUMMARY,
	TRACE_AI_PATH_ANALYSIS_EMPTY_DETAIL,
	TRACE_AI_PATH_ANALYSIS_EMPTY_SUMMARY,
	TRACE_AI_STRENGTHS_EMPTY_DETAIL,
	TRACE_AI_STRENGTHS_EMPTY_SUMMARY,
	TRACE_AI_TOKEN_EFFICIENCY_EMPTY_DETAIL,
	TRACE_AI_TOKEN_EFFICIENCY_EMPTY_SUMMARY,
	TRACE_AI_WRONG_TURNS_EMPTY_DETAIL,
	TRACE_AI_WRONG_TURNS_EMPTY_SUMMARY,
} from "@/constants/messages/en";

type TraceAnalysisSpanSource = {
	spanId: string;
	spanName: string;
	role?: string;
	serviceName?: string;
	resource?: Record<string, string | number>;
	statusCode?: string;
	statusMessage?: string;
	durationMs: number;
	error?: string;
	model?: string;
	provider?: string;
	cost?: number;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
	reasoningTokens?: number;
	systemPrompt?: string;
	prompt?: string;
	response?: string;
	reasoning?: string;
	toolName?: string;
	toolCallId?: string;
	toolArgs?: string;
	toolResult?: string;
	dbQuery?: string;
	httpUrl?: string;
	eventSummary?: Array<{
		name?: string;
		attributes: Record<string, string | number>;
	}>;
	children: TraceAnalysisSpanSource[];
};

type TraceAnalysisMetricSource = {
	spanCount: number;
	maxDepth: number;
	errorCount: number;
	llmCallCount: number;
	toolCallCount: number;
	retrievalCallCount: number;
	modelsUsed: string[];
	toolsUsed: string[];
	totalCostUsd?: number;
	costPerCall?: number;
	avgCostPerLlm?: number;
	mostExpensiveSpanId?: string;
	mostExpensiveCostUsd?: number;
	totalInputTokens?: number;
	totalOutputTokens?: number;
	totalTokens?: number;
	totalCacheReadTokens?: number;
	totalCacheCreationTokens?: number;
	totalReasoningTokens?: number;
	cacheHitRate?: number;
	largestContextSpanId?: string;
	largestContextTokens?: number;
	duplicateToolInputs?: Array<{ key: string; count: number; spanIds: string[] }>;
	duplicateRetrievalInputs?: Array<{ key: string; count: number; spanIds: string[] }>;
	repeatedSpanNames?: Array<{ name: string; count: number; spanIds: string[] }>;
	potentialRetrySequences?: Array<{ reason: string; spanIds: string[] }>;
	slowestSpanId?: string;
	slowestDurationMs?: number;
	totalDurationMs?: number;
	databaseCallCount?: number;
	httpCallCount?: number;
};

type TraceAnalysisSpanField = Exclude<keyof TraceAnalysisSpanSource, "children">;
type TraceAnalysisMetricField = keyof TraceAnalysisMetricSource;

type DimensionDefinitionSource = {
	key: string;
	uiLabel: string;
	streamLabel: string;
	guidance: string;
	emptyStateCopy: { summary: string; detail: string };
	spanFields: readonly TraceAnalysisSpanField[];
	metricFields: readonly TraceAnalysisMetricField[];
};

function defineDimension<const T extends DimensionDefinitionSource>(definition: T) {
	return Object.freeze({
		...definition,
		emptyStateCopy: Object.freeze(definition.emptyStateCopy),
		spanFields: Object.freeze(definition.spanFields),
		metricFields: Object.freeze(definition.metricFields),
	});
}

export const TRACE_ANALYSIS_DIMENSION_DEFINITIONS = Object.freeze([
	defineDimension({
		key: "strengths",
		uiLabel: "Strengths",
		streamLabel: "Strengths",
		guidance:
			"Find concrete things that worked well: efficient prompts, good model choice, useful tool use, clean path, low cost, fast execution, useful context handling. Do not put problems here.",
		emptyStateCopy: {
			summary: TRACE_AI_STRENGTHS_EMPTY_SUMMARY,
			detail: TRACE_AI_STRENGTHS_EMPTY_DETAIL,
		},
		spanFields: [
			"model",
			"provider",
			"cost",
			"totalTokens",
			"toolName",
			"prompt",
			"response",
		],
		metricFields: [
			"totalCostUsd",
			"totalTokens",
			"totalDurationMs",
			"slowestSpanId",
			"mostExpensiveSpanId",
			"largestContextSpanId",
		],
	}),
	defineDimension({
		key: "improvements",
		uiLabel: "Improvements",
		streamLabel: "Improvements",
		guidance:
			"Find concrete general improvements that do not belong in cost, token_efficiency, wrong_turns, or path_analysis. Avoid generic advice; cite spans.",
		emptyStateCopy: {
			summary: TRACE_AI_IMPROVEMENTS_EMPTY_SUMMARY,
			detail: TRACE_AI_IMPROVEMENTS_EMPTY_DETAIL,
		},
		spanFields: [
			"model",
			"provider",
			"cost",
			"totalTokens",
			"prompt",
			"response",
			"toolName",
			"toolArgs",
			"toolResult",
			"dbQuery",
			"httpUrl",
			"resource",
		],
		metricFields: [
			"totalCostUsd",
			"totalTokens",
			"totalDurationMs",
			"slowestSpanId",
			"mostExpensiveSpanId",
			"largestContextSpanId",
		],
	}),
	defineDimension({
		key: "wrong_turns",
		uiLabel: "Wrong turns",
		streamLabel: "Wrong turns",
		guidance:
			"Find retries, rework, off-task branches, tool failures followed by repeated work, user-blocked steps, self-correction, or decisions that created unnecessary work.",
		emptyStateCopy: {
			summary: TRACE_AI_WRONG_TURNS_EMPTY_SUMMARY,
			detail: TRACE_AI_WRONG_TURNS_EMPTY_DETAIL,
		},
		spanFields: [
			"toolName",
			"toolArgs",
			"toolResult",
			"prompt",
			"response",
			"reasoning",
			"eventSummary",
		],
		metricFields: [
			"potentialRetrySequences",
			"repeatedSpanNames",
			"slowestSpanId",
			"slowestDurationMs",
		],
	}),
	defineDimension({
		key: "cost",
		uiLabel: "Cost",
		streamLabel: "Cost",
		guidance:
			"Analyze absolute spend, cost concentration, model choice, expensive spans, cost per call, and whether cheaper routing would have been appropriate. Do not discuss token waste unless it directly explains spend.",
		emptyStateCopy: {
			summary: TRACE_AI_COST_EMPTY_SUMMARY,
			detail: TRACE_AI_COST_EMPTY_DETAIL,
		},
		spanFields: [
			"model",
			"provider",
			"cost",
			"promptTokens",
			"completionTokens",
			"totalTokens",
		],
		metricFields: [
			"totalCostUsd",
			"costPerCall",
			"avgCostPerLlm",
			"mostExpensiveSpanId",
			"mostExpensiveCostUsd",
			"totalTokens",
		],
	}),
	defineDimension({
		key: "token_efficiency",
		uiLabel: "Token efficiency",
		streamLabel: "Token efficiency",
		guidance:
			"Analyze input/output/cache/reasoning token waste, repeated context, repeated prompts, oversized tool results, duplicate retrieval/tool inputs, and largest context spans. This is about waste, not absolute spend.",
		emptyStateCopy: {
			summary: TRACE_AI_TOKEN_EFFICIENCY_EMPTY_SUMMARY,
			detail: TRACE_AI_TOKEN_EFFICIENCY_EMPTY_DETAIL,
		},
		spanFields: [
			"model",
			"promptTokens",
			"completionTokens",
			"totalTokens",
			"cacheReadTokens",
			"cacheCreationTokens",
			"reasoningTokens",
			"systemPrompt",
			"prompt",
			"response",
			"toolArgs",
			"toolResult",
		],
		metricFields: [
			"totalInputTokens",
			"totalOutputTokens",
			"totalTokens",
			"totalCacheReadTokens",
			"totalCacheCreationTokens",
			"totalReasoningTokens",
			"cacheHitRate",
			"largestContextSpanId",
			"largestContextTokens",
			"duplicateToolInputs",
			"duplicateRetrievalInputs",
			"repeatedSpanNames",
		],
	}),
	defineDimension({
		key: "path_analysis",
		uiLabel: "Path",
		streamLabel: "Path analysis",
		guidance:
			"Analyze routing and execution path: whether the trace picked the right tools, avoided loops, used the right branches, and kept orchestration efficient.",
		emptyStateCopy: {
			summary: TRACE_AI_PATH_ANALYSIS_EMPTY_SUMMARY,
			detail: TRACE_AI_PATH_ANALYSIS_EMPTY_DETAIL,
		},
		spanFields: [
			"serviceName",
			"toolName",
			"toolCallId",
			"toolArgs",
			"dbQuery",
			"httpUrl",
			"resource",
		],
		metricFields: [
			"totalDurationMs",
			"maxDepth",
			"repeatedSpanNames",
			"potentialRetrySequences",
			"databaseCallCount",
			"httpCallCount",
		],
	}),
] as const);

export type TraceAnalysisDimensionKey =
	(typeof TRACE_ANALYSIS_DIMENSION_DEFINITIONS)[number]["key"];

export type TraceAnalysisDimensionDefinition =
	(typeof TRACE_ANALYSIS_DIMENSION_DEFINITIONS)[number];

export const TRACE_ANALYSIS_DIMENSION_REGISTRY = Object.freeze(
	Object.fromEntries(
		TRACE_ANALYSIS_DIMENSION_DEFINITIONS.map((definition) => [
			definition.key,
			definition,
		])
	)
) as Readonly<
	Record<TraceAnalysisDimensionKey, TraceAnalysisDimensionDefinition>
>;

export function getTraceAnalysisDimensionDefinition(
	dimension: string
): TraceAnalysisDimensionDefinition {
	return (
		TRACE_ANALYSIS_DIMENSION_REGISTRY[
			dimension as TraceAnalysisDimensionKey
		] ?? TRACE_ANALYSIS_DIMENSION_DEFINITIONS[0]
	);
}

function selectFields(
	source: object,
	fields: readonly string[]
): Record<string, unknown> {
	const values = source as Record<string, unknown>;
	return Object.fromEntries(fields.map((field) => [field, values[field]]));
}

export function selectTraceAnalysisSpan(
	span: TraceAnalysisSpanSource,
	dimension: TraceAnalysisDimensionKey
): Record<string, unknown> {
	const definition = TRACE_ANALYSIS_DIMENSION_REGISTRY[dimension];
	const base = {
		spanId: span.spanId,
		spanName: span.spanName,
		role: span.role,
		statusCode: span.statusCode,
		statusMessage: span.statusMessage,
		durationMs: span.durationMs,
		error: span.error,
		children: span.children.map((child) =>
			selectTraceAnalysisSpan(child, dimension)
		),
	};

	return {
		...base,
		...selectFields(span, definition.spanFields),
	};
}

export function selectTraceAnalysisMetrics(
	metrics: TraceAnalysisMetricSource,
	dimension: TraceAnalysisDimensionKey
): Record<string, unknown> {
	const definition = TRACE_ANALYSIS_DIMENSION_REGISTRY[dimension];
	const common = {
		spanCount: metrics.spanCount,
		maxDepth: metrics.maxDepth,
		errorCount: metrics.errorCount,
		llmCallCount: metrics.llmCallCount,
		toolCallCount: metrics.toolCallCount,
		retrievalCallCount: metrics.retrievalCallCount,
		modelsUsed: metrics.modelsUsed,
		toolsUsed: metrics.toolsUsed,
	};

	return {
		...common,
		...selectFields(metrics, definition.metricFields),
	};
}
