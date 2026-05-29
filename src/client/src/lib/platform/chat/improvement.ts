import { streamText } from "ai";
import { createHash, randomUUID } from "crypto";
import { getChatConfigWithApiKey } from "./config";
import { OPENLIT_TRACE_ANALYSIS_TABLE } from "./table-details";
import { dataCollector } from "../common";
import { getModelInstance } from "./stream";
import { getHeirarchyViaSpanId } from "../request";
import { TraceHeirarchySpan, TraceRow } from "@/types/trace";
import {
	TRACE_ANALYSIS_DIMENSIONS,
	TraceAnalysis,
	TraceAnalysisDimension,
	TraceAnalysisFinding,
	emptyTraceAnalysis,
} from "@/types/trace-analysis";
import Sanitizer from "@/utils/sanitizer";

type ImprovementSpanSummary = {
	traceId?: string;
	spanId: string;
	spanName: string;
	role?: SpanAnalysisRole;
	serviceName?: string;
	resource?: Record<string, string | number>;
	attributeKeys?: string[];
	resourceKeys?: string[];
	statusCode?: string;
	statusMessage?: string;
	durationMs: number;
	cost?: number;
	model?: string;
	provider?: string;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
	reasoningTokens?: number;
	prompt?: string;
	systemPrompt?: string;
	response?: string;
	reasoning?: string;
	toolName?: string;
	toolCallId?: string;
	toolArgs?: string;
	toolResult?: string;
	dbQuery?: string;
	httpUrl?: string;
	eventSummary?: Array<{ name?: string; attributes: Record<string, string | number> }>;
	error?: string;
	children: ImprovementSpanSummary[];
};

type TraceRuleContext = {
	contextContents: string[];
	matchingRuleIds: string[];
	contextEntityIds: string[];
};

type SpanAnalysisRole = "llm" | "tool" | "retrieval" | "embedding" | "database" | "http" | "orchestrator" | "unknown";
type TraceAnalysisScope = "trace" | "span";
type TraceAnalysisStorageType = "trace_analysis" | "span_analysis";

type TraceAnalysisMetrics = {
	spanCount: number;
	maxDepth: number;
	llmCallCount: number;
	toolCallCount: number;
	retrievalCallCount: number;
	embeddingCallCount: number;
	databaseCallCount: number;
	httpCallCount: number;
	errorCount: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
	totalCacheReadTokens: number;
	totalCacheCreationTokens: number;
	totalReasoningTokens: number;
	totalCostUsd: number;
	totalDurationMs: number;
	avgInputTokensPerLlm: number;
	avgOutputTokensPerLlm: number;
	avgCostPerLlm: number;
	cacheHitRate: number;
	costPerCall: number;
	modelsUsed: string[];
	providersUsed: string[];
	toolsUsed: string[];
	largestContextSpanId?: string;
	largestContextTokens: number;
	slowestSpanId?: string;
	slowestDurationMs: number;
	mostExpensiveSpanId?: string;
	mostExpensiveCostUsd: number;
	repeatedSpanNames: Array<{ name: string; count: number; spanIds: string[] }>;
	duplicateToolInputs: Array<{ key: string; count: number; spanIds: string[] }>;
	duplicateRetrievalInputs: Array<{ key: string; count: number; spanIds: string[] }>;
	potentialRetrySequences: Array<{ reason: string; spanIds: string[] }>;
};

const TRACE_ANALYSIS_SCHEMA = `type FixPatch = {
  field: 'prompt' | 'response' | 'system'; // which span attribute contains the text to edit
  span_ref: string;     // must be a span ID from span_refs
  original: string;     // exact verbatim substring from that field (max 250 chars)
  replacement: string;  // corrected text to substitute in (max 250 chars)
};

type Finding = {
  id: string;
  severity: 'info' | 'minor' | 'major' | 'critical';
  summary: string; // one line, <= 140 chars
  detail: string; // 1-4 sentences; start with a short gist before supporting context
  span_refs: string[];
  suggested_fix?: string;
  suggested_fix_patches?: FixPatch[]; // only when fix is a concrete text substitution in a prompt/response/system field
  estimated_savings?: { tokens?: number; usd?: number };
};

type TraceAnalysis = {
  trace_id: string;
  summary: string;
  strengths: Finding[];
  improvements: Finding[];
  wrong_turns: Finding[];
  cost: Finding[];
  token_efficiency: Finding[];
  path_analysis: Finding[];
  totals: {
    span_count: number;
    total_tokens: number;
    total_cost_usd: number;
    duration_ms: number;
  };
};`;

const DIMENSION_GUIDANCE: Record<TraceAnalysisDimension, string> = {
	strengths:
		"Find concrete things that worked well: efficient prompts, good model choice, useful tool use, clean path, low cost, fast execution, useful context handling. Do not put problems here.",
	improvements:
		"Find concrete general improvements that do not belong in cost, token_efficiency, wrong_turns, or path_analysis. Avoid generic advice; cite spans.",
	wrong_turns:
		"Find retries, rework, off-task branches, tool failures followed by repeated work, user-blocked steps, self-correction, or decisions that created unnecessary work.",
	cost:
		"Analyze absolute spend, cost concentration, model choice, expensive spans, cost per call, and whether cheaper routing would have been appropriate. Do not discuss token waste unless it directly explains spend.",
	token_efficiency:
		"Analyze input/output/cache/reasoning token waste, repeated context, repeated prompts, oversized tool results, duplicate retrieval/tool inputs, and largest context spans. This is about waste, not absolute spend.",
	path_analysis:
		"Analyze routing and execution path: whether the trace picked the right tools, avoided loops, used the right branches, and kept orchestration efficient.",
};

const DIMENSION_LABELS: Record<TraceAnalysisDimension, string> = {
	strengths: "Strengths",
	improvements: "Improvements",
	wrong_turns: "Wrong turns",
	cost: "Cost",
	token_efficiency: "Token efficiency",
	path_analysis: "Path analysis",
};

function computeWorstSeverity(analysis: TraceAnalysis): string {
	for (const severity of ["critical", "major", "minor", "info"] as const) {
		for (const dimension of TRACE_ANALYSIS_DIMENSIONS) {
			if (analysis[dimension].some((f) => f.severity === severity)) {
				return severity;
			}
		}
	}
	return "";
}

export interface TraceAnalysisRun {
	id: string;
	rootSpanId: string;
	selectedSpanId: string;
	analysisType?: TraceAnalysisStorageType;
	runNumber: number;
	analysisJson: string;
	summary: string;
	modelProvider: string;
	modelName: string;
	promptTokens: number;
	completionTokens: number;
	cost: number;
	worstSeverity: string;
	createdAt: string;
}

export async function getTraceAnalysisRuns(
	rootSpanId: string,
	databaseConfigId?: string,
	analysisType: TraceAnalysisStorageType = "trace_analysis"
): Promise<{ data?: TraceAnalysisRun[]; err?: unknown }> {
	const safeRootSpanId = Sanitizer.sanitizeValue(rootSpanId);
	const safeAnalysisType = Sanitizer.sanitizeValue(analysisType);
	const query = `
		SELECT
			id,
			root_span_id AS rootSpanId,
			selected_span_id AS selectedSpanId,
			analysis_type AS analysisType,
			run_number AS runNumber,
			analysis_json AS analysisJson,
			summary,
			model_provider AS modelProvider,
			model_name AS modelName,
			prompt_tokens AS promptTokens,
			completion_tokens AS completionTokens,
			cost,
			worst_severity AS worstSeverity,
			created_at AS createdAt
		FROM ${OPENLIT_TRACE_ANALYSIS_TABLE}
		WHERE root_span_id = '${safeRootSpanId}'
			AND analysis_type = '${safeAnalysisType}'
		ORDER BY run_number ASC
	`;
	const { data, err } = await dataCollector({ query }, "query", databaseConfigId);
	if (err) return { err };
	return { data: (data as TraceAnalysisRun[]) || [] };
}

export async function saveTraceAnalysisRun(
	{
		rootSpanId,
		selectedSpanId,
		runNumber,
		analysis,
		modelProvider,
		modelName,
		promptTokens,
		completionTokens,
		cost,
		analysisType = "trace_analysis",
	}: {
		rootSpanId: string;
		selectedSpanId: string;
		analysisType?: TraceAnalysisStorageType;
		runNumber: number;
		analysis: TraceAnalysis;
		modelProvider: string;
		modelName: string;
		promptTokens: number;
		completionTokens: number;
		cost: number;
	},
	databaseConfigId?: string
): Promise<{ data?: TraceAnalysisRun; err?: unknown }> {
	const id = randomUUID();
	const now = new Date().toISOString();
	const analysisJson = JSON.stringify(analysis);
	const worstSeverity = computeWorstSeverity(analysis);

	const { err } = await dataCollector(
		{
			table: OPENLIT_TRACE_ANALYSIS_TABLE,
			values: [
				{
					id,
					root_span_id: Sanitizer.sanitizeValue(rootSpanId),
					selected_span_id: Sanitizer.sanitizeValue(selectedSpanId),
					analysis_type: Sanitizer.sanitizeValue(analysisType),
					run_number: runNumber,
					analysis_json: analysisJson,
					summary: Sanitizer.sanitizeValue(analysis.summary || ""),
					model_provider: Sanitizer.sanitizeValue(modelProvider),
					model_name: Sanitizer.sanitizeValue(modelName),
					prompt_tokens: promptTokens,
					completion_tokens: completionTokens,
					cost,
					worst_severity: worstSeverity,
				},
			],
		},
		"insert",
		databaseConfigId
	);

	if (err) return { err };

	return {
		data: {
			id,
			rootSpanId,
			selectedSpanId,
			analysisType,
			runNumber,
			analysisJson,
			summary: analysis.summary || "",
			modelProvider,
			modelName,
			promptTokens,
			completionTokens,
			cost,
			worstSeverity,
			createdAt: now,
		},
	};
}

function readNumber(attrs: Record<string, string | number>, key: string) {
	const value = Number(attrs[key]);
	return Number.isFinite(value) ? value : undefined;
}

function readFirstNumber(attrs: Record<string, string | number>, keys: string[]) {
	for (const key of keys) {
		const value = readNumber(attrs, key);
		if (typeof value === "number") return value;
	}
	return undefined;
}

function readString(attrs: Record<string, string | number>, keys: string[]) {
	for (const key of keys) {
		const value = attrs[key];
		if (typeof value === "string" && value.trim()) return value;
		if (typeof value === "number") return String(value);
	}
	return undefined;
}

function readAnyString(sources: Array<Record<string, string | number> | undefined>, keys: string[]) {
	for (const source of sources) {
		if (!source) continue;
		const value = readString(source, keys);
		if (value) return value;
	}
	return undefined;
}

function readAnyNumber(sources: Array<Record<string, string | number> | undefined>, keys: string[]) {
	for (const source of sources) {
		if (!source) continue;
		const value = readFirstNumber(source, keys);
		if (typeof value === "number") return value;
	}
	return undefined;
}

function parseMaybeJson(value?: string): any {
	if (!value) return undefined;
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}

function stringifyContent(value: unknown): string | undefined {
	if (value === null || value === undefined) return undefined;
	if (typeof value === "string") return value.trim() || undefined;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		const parts = value
			.map((item) => stringifyContent(item))
			.filter(Boolean) as string[];
		return parts.length ? parts.join("\n") : undefined;
	}
	if (typeof value === "object") {
		const obj = value as Record<string, any>;
		for (const key of ["text", "content", "message", "input", "output", "result", "response", "completion", "query"]) {
			const nested = stringifyContent(obj[key]);
			if (nested) return nested;
		}
		if (Array.isArray(obj.parts)) return stringifyContent(obj.parts);
		if (Array.isArray(obj.content)) return stringifyContent(obj.content);
		if (Array.isArray(obj.messages)) return stringifyContent(obj.messages);
		return JSON.stringify(obj);
	}
	return undefined;
}

function extractMessagesText(raw?: string) {
	const parsed = parseMaybeJson(raw);
	return stringifyContent(parsed) || raw;
}

function eventAttributes(span: TraceHeirarchySpan) {
	return (span.Events || [])
		.map((event) => ({
			name: event.Name,
			attributes: (event.Attributes || {}) as Record<string, string | number>,
		}))
		.filter((event) => event.name || Object.keys(event.attributes).length > 0);
}

function readFromEvents(span: TraceHeirarchySpan, keys: string[]) {
	for (const event of span.Events || []) {
		const attrs = (event.Attributes || {}) as Record<string, string | number>;
		const value = readString(attrs, keys);
		if (value) return value;
	}
	return undefined;
}

function compactInterestingAttributes(attrs: Record<string, string | number> | undefined) {
	if (!attrs) return {};
	const important = [
		"service.name",
		"deployment.environment",
		"gen_ai.application_name",
		"gen_ai.environment",
		"gen_ai.operation.name",
		"gen_ai.system",
		"gen_ai.request.model",
		"gen_ai.response.model",
		"gen_ai.request.temperature",
		"gen_ai.request.max_tokens",
		"gen_ai.request.tool_choice",
		"gen_ai.response.finish_reasons",
		"db.system",
		"db.system.name",
		"db.operation",
		"db.operation.name",
		"http.method",
		"http.url",
		"url.full",
		"claude_code.version",
		"claude_code.type",
	];
	return Object.fromEntries(
		important
			.filter((key) => attrs[key] !== undefined && attrs[key] !== "")
			.map((key) => [key, attrs[key]])
	);
}

function spanDurationMs(span: TraceHeirarchySpan) {
	const value = Number(span.Duration);
	if (!Number.isFinite(value)) return 0;
	// OTel Duration is often nanoseconds. Some query paths may already return ms or seconds.
	if (value > 1_000_000) return value / 1e6;
	if (value > 10_000) return value / 1e3;
	return value;
}

function truncateMiddle(value: string | undefined, edge = 400) {
	if (!value) return undefined;
	if (value.length <= edge * 2) return value;
	return `${value.slice(0, edge)}\n[...]\n${value.slice(-edge)}`;
}

function stableFindingId(finding: Partial<TraceAnalysisFinding>, dimension: string) {
	const input = `${(finding.span_refs || []).join(",")}:${dimension}:${finding.summary || ""}`;
	return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function normalizeMetricKey(value?: string, maxLength = 160) {
	return (value || "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
}

function redactForLogs(value: string) {
	return value
		.replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]")
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [REDACTED]")
		.replace(/(api[_-]?key|token|password|secret)["'\s:=]+[^"',\s}]+/gi, "$1=[REDACTED]");
}

function previewValue(value?: string, maxLength = 160) {
	if (!value) return undefined;
	const normalized = normalizeMetricKey(value, maxLength);
	const redacted = redactForLogs(normalized);
	return value.length > maxLength ? `${redacted}...` : redacted;
}

function logTraceAnalysis(stage: string, payload: Record<string, unknown>) {
	const line = `[trace-analysis] ${stage} ${JSON.stringify({
		time: new Date().toISOString(),
		...payload,
	})}`;
	try {
		console.log(line);
	} catch {
		console.log(`[trace-analysis] ${stage}`, payload);
	}
}

function logTraceAnalysisError(stage: string, error: unknown, extra: Record<string, unknown> = {}) {
	const payload = {
		time: new Date().toISOString(),
		...extra,
		error: error instanceof Error ? error.message : error,
	};
	console.error(`[trace-analysis] ${stage}`, payload);
}

function classifySpanRole(span: TraceHeirarchySpan): SpanAnalysisRole {
	const attrs = span.SpanAttributes || {};
	const name = (span.SpanName || "").toLowerCase();
	const hasModel = Boolean(readString(attrs, [
		"gen_ai.request.model",
		"gen_ai.response.model",
		"llm.request.model",
		"claude_code.model",
		"model",
	]));

	if (name.includes("embed")) return "embedding";
	if (name.includes("retriev") || name.includes("search") || name.includes("vector")) return "retrieval";
	if (readString(attrs, ["gen_ai.tool.name", "gen_ai.tool.call.name", "tool.name", "tool_name", "claude_code.tool.name"]) || name.includes("tool")) return "tool";
	if (readString(attrs, ["db.query.text", "db.system.name", "db.operation.name"]) || name.includes("db.")) return "database";
	if (readString(attrs, ["http.method", "http.url", "url.full"]) || name.includes("http")) return "http";
	if (hasModel || readString(attrs, ["gen_ai.system", "llm.system"])) return "llm";
	if ((span.children || []).length > 0) return "orchestrator";
	return "unknown";
}

function summarizeSpan(span: TraceHeirarchySpan): ImprovementSpanSummary {
	const attrs = span.SpanAttributes || {};
	const resourceAttrs = span.ResourceAttributes || {};
	const eventAttrs = eventAttributes(span);
	const role = classifySpanRole(span);
	const prompt = readAnyString([attrs], [
		"gen_ai.input.messages",
		"gen_ai.content.prompt",
		"gen_ai.request.input",
		"gen_ai.prompt",
		"input",
		"prompt",
		"claude_code.prompt",
		"claude_code.input",
		"db.query.text",
	]) || readFromEvents(span, [
		"gen_ai.prompt",
		"gen_ai.input",
		"gen_ai.input.messages",
		"prompt",
		"input",
	]);
	const response = readAnyString([attrs], [
		"gen_ai.output.messages",
		"gen_ai.content.completion",
		"gen_ai.response.output",
		"gen_ai.completion",
		"gen_ai.response.text",
		"output",
		"response",
		"result",
		"completion",
		"claude_code.response",
		"claude_code.output",
	]) || readFromEvents(span, [
		"gen_ai.completion",
		"gen_ai.output",
		"gen_ai.output.messages",
		"completion",
		"response",
		"output",
	]);
	const toolArgs = readAnyString([attrs], [
		"gen_ai.tool.call.arguments",
		"gen_ai.tool.args",
		"gen_ai.tool.arguments",
		"gen_ai.tool.input",
		"gen_ai.tool.call.input",
		"tool.args",
		"tool.arguments",
		"tool.input",
		"claude_code.tool.args",
		"claude_code.tool.input",
	]) || readFromEvents(span, ["tool.args", "tool.arguments", "tool.input", "gen_ai.tool.call.arguments"]);
	const toolResult = readAnyString([attrs], [
		"gen_ai.tool.result",
		"gen_ai.tool.output",
		"tool.result",
		"tool.output",
		"claude_code.tool.result",
		"claude_code.tool.output",
	]) || readFromEvents(span, ["tool.result", "tool.output", "gen_ai.tool.result"]);
	const dbQuery = readAnyString([attrs], [
		"db.query.text",
		"db.statement",
		"db.query",
		"db.statement.text",
	]);

	return {
		traceId: (span as any).TraceId,
		spanId: span.SpanId,
		spanName: span.SpanName,
		role,
		serviceName: span.ServiceName || readString(resourceAttrs, ["service.name"]),
		resource: compactInterestingAttributes(resourceAttrs),
		attributeKeys: Object.keys(attrs).slice(0, 80),
		resourceKeys: Object.keys(resourceAttrs).slice(0, 80),
		statusCode: span.StatusCode,
		statusMessage: span.StatusMessage,
		durationMs: spanDurationMs(span),
		cost: span.Cost || readAnyNumber([attrs], [
			"gen_ai.usage.cost",
			"cost",
			"llm.usage.cost",
			"claude_code.cost",
		]),
		model: readAnyString([attrs], [
			"gen_ai.request.model",
			"gen_ai.response.model",
			"llm.request.model",
			"llm.response.model",
			"model",
			"claude_code.model",
		]),
		provider: readAnyString([attrs], ["gen_ai.system", "llm.system", "provider", "claude_code.provider"]),
		promptTokens:
			readAnyNumber([attrs], [
				"gen_ai.usage.input_tokens",
				"gen_ai.usage.prompt_tokens",
				"gen_ai.client.token.usage.input",
				"llm.usage.prompt_tokens",
				"input_tokens",
				"prompt_tokens",
				"claude_code.usage.input_tokens",
			]),
		completionTokens:
			readAnyNumber([attrs], [
				"gen_ai.usage.output_tokens",
				"gen_ai.usage.completion_tokens",
				"gen_ai.client.token.usage.output",
				"llm.usage.completion_tokens",
				"output_tokens",
				"completion_tokens",
				"claude_code.usage.output_tokens",
			]),
		totalTokens: readAnyNumber([attrs], [
			"gen_ai.usage.total_tokens",
			"gen_ai.client.token.usage",
			"llm.usage.total_tokens",
			"total_tokens",
			"claude_code.usage.total_tokens",
		]),
		cacheReadTokens: readAnyNumber([attrs], [
			"gen_ai.usage.cache_read_input_tokens",
			"gen_ai.usage.cache_read_tokens",
			"gen_ai.usage.cache_read.input_tokens",
			"llm.usage.cache_read_input_tokens",
			"cache_read_input_tokens",
			"claude_code.usage.cache_read_input_tokens",
		]),
		cacheCreationTokens: readAnyNumber([attrs], [
			"gen_ai.usage.cache_creation_input_tokens",
			"gen_ai.usage.cache_creation_tokens",
			"gen_ai.usage.cache_creation.input_tokens",
			"llm.usage.cache_creation_input_tokens",
			"cache_creation_input_tokens",
			"claude_code.usage.cache_creation_input_tokens",
		]),
		reasoningTokens: readAnyNumber([attrs], [
			"gen_ai.usage.reasoning_tokens",
			"gen_ai.usage.completion_tokens_details.reasoning_tokens",
			"llm.usage.reasoning_tokens",
			"reasoning_tokens",
			"claude_code.usage.reasoning_tokens",
		]),
		prompt: truncateMiddle(extractMessagesText(prompt)),
		systemPrompt: truncateMiddle(readAnyString([attrs], [
			"gen_ai.system_instructions",
			"gen_ai.system.prompt",
			"llm.system.prompt",
			"system",
			"system_prompt",
		])),
		response: truncateMiddle(extractMessagesText(response)),
		reasoning: truncateMiddle(readAnyString([attrs], [
			"gen_ai.content.reasoning",
			"reasoning",
			"content.reasoning",
		])),
		toolName: readAnyString([attrs], [
			"gen_ai.tool.name",
			"gen_ai.tool.call.name",
			"tool.name",
			"tool_name",
			"claude_code.tool.name",
		]) || (span.SpanName?.includes("tool") ? span.SpanName : undefined),
		toolCallId: readAnyString([attrs], ["gen_ai.tool.call.id", "tool.call.id", "tool_call_id"]),
		toolArgs: truncateMiddle(extractMessagesText(toolArgs), 400),
		toolResult: truncateMiddle(extractMessagesText(toolResult), 400),
		dbQuery: truncateMiddle(dbQuery, 400),
		httpUrl: readAnyString([attrs], ["url.full", "http.url", "http.target"]),
		eventSummary: eventAttrs.slice(0, 8).map((event) => ({
			name: event.name,
			attributes: compactInterestingAttributes(event.attributes),
		})),
		error: readAnyString([attrs], [
			"exception.message",
			"error.message",
			"gen_ai.error.message",
		]) || readFromEvents(span, ["exception.message", "error.message"]) || span.StatusMessage || (span.StatusCode === "STATUS_CODE_ERROR" ? span.StatusCode : undefined),
		children: (span.children || []).map(summarizeSpan),
	};
}

function collectSpanIds(span: TraceHeirarchySpan): string[] {
	return [
		span.SpanId,
		...(span.children || []).flatMap((child) => collectSpanIds(child)),
	].filter(Boolean);
}

function findSpanInHierarchy(
	span: TraceHeirarchySpan,
	targetSpanId: string
): TraceHeirarchySpan | undefined {
	if (span.SpanId === targetSpanId) return span;
	for (const child of span.children || []) {
		const match = findSpanInHierarchy(child, targetSpanId);
		if (match) return match;
	}
	return undefined;
}

function analysisTypeForScope(scope: TraceAnalysisScope): TraceAnalysisStorageType {
	return scope === "span" ? "span_analysis" : "trace_analysis";
}

function getAnalysisTarget(
	hierarchyRecord: TraceHeirarchySpan,
	spanId: string,
	scope: TraceAnalysisScope
) {
	const target = scope === "span"
		? findSpanInHierarchy(hierarchyRecord, spanId) || hierarchyRecord
		: hierarchyRecord;

	return {
		analysisRoot: target,
		rootSpanId: scope === "span" ? target.SpanId : hierarchyRecord.SpanId,
	};
}

function hierarchySpanToTraceRow(span: TraceHeirarchySpan): TraceRow {
	return {
		Timestamp: span.Timestamp as any,
		TraceId: span.TraceId || "",
		SpanId: span.SpanId,
		ParentSpanId: span.ParentSpanId || "",
		TraceState: "",
		SpanName: span.SpanName,
		SpanKind: span.SpanKind || "SPAN_KIND_INTERNAL",
		ServiceName: span.ServiceName || "",
		ResourceAttributes: (span.ResourceAttributes || {}) as Record<string, string>,
		ScopeName: span.ScopeName || "",
		ScopeVersion: span.ScopeVersion || "",
		SpanAttributes: span.SpanAttributes || {},
		Duration: String(span.Duration || ""),
		StatusCode: span.StatusCode || "",
		StatusMessage: span.StatusMessage || "",
		Events: (span.Events || []) as any,
		Links: (span.Links || []) as any,
	};
}

async function getRuleContextForTraceHierarchy(
	root: TraceHeirarchySpan,
	selectedSpanId: string,
	databaseConfigId?: string
): Promise<TraceRuleContext> {
	const spans = flattenHierarchy(root);
	const selected = spans.find((span) => span.SpanId === selectedSpanId) || root;
	const contextById = new Map<string, string>();
	const ruleIds = new Set<string>();

	for (const span of [selected, root]) {
		try {
			const { getContextFromRuleEngineForTrace } = await import("../evaluation/rule-engine-context");
			const result = await getContextFromRuleEngineForTrace(
				hierarchySpanToTraceRow(span),
				databaseConfigId
			);
			for (const id of result.matchingRuleIds || []) ruleIds.add(id);
			(result.contextContents || []).forEach((content, index) => {
				const entityId = result.contextEntityIds?.[index];
				const key = createHash("sha1").update(content).digest("hex").slice(0, 12);
				contextById.set(entityId || key, content);
			});
		} catch (error) {
			logTraceAnalysisError("rule_context_failed", error, { spanId: span.SpanId });
		}
	}

	return {
		contextContents: Array.from(contextById.values()).filter(Boolean).slice(0, 8),
		matchingRuleIds: Array.from(ruleIds),
		contextEntityIds: Array.from(contextById.keys()),
	};
}

function flattenHierarchy(span: TraceHeirarchySpan): TraceHeirarchySpan[] {
	return [span, ...(span.children || []).flatMap(flattenHierarchy)];
}

function flattenSummary(summary: ImprovementSpanSummary): ImprovementSpanSummary[] {
	return [summary, ...summary.children.flatMap(flattenSummary)];
}

function topRepeatedEntries(map: Map<string, string[]>, limit = 5) {
	return Array.from(map.entries())
		.filter(([, spanIds]) => spanIds.length > 1)
		.sort((a, b) => b[1].length - a[1].length)
		.slice(0, limit)
		.map(([key, spanIds]) => ({ key, count: spanIds.length, spanIds }));
}

function siblingRetrySequences(span: ImprovementSpanSummary): Array<{ reason: string; spanIds: string[] }> {
	const sequences: Array<{ reason: string; spanIds: string[] }> = [];
	const siblings = span.children || [];
	for (let index = 1; index < siblings.length; index++) {
		const previous = siblings[index - 1];
		const current = siblings[index];
		if (!previous || !current) continue;
		const sameName = previous.spanName && previous.spanName === current.spanName;
		const sameTool = previous.toolName && previous.toolName === current.toolName;
		const previousErrored = previous.statusCode === "STATUS_CODE_ERROR" || Boolean(previous.error);
		if ((sameName || sameTool) && previousErrored) {
			sequences.push({
				reason: previousErrored ? "same operation repeated after an errored span" : "same operation repeated by adjacent sibling spans",
				spanIds: [previous.spanId, current.spanId],
			});
		}
	}
	return [
		...sequences,
		...siblings.flatMap(siblingRetrySequences),
	];
}

function extractTraceMetrics(summary: ImprovementSpanSummary): TraceAnalysisMetrics {
	const spans = flattenSummary(summary);
	const models = new Set<string>();
	const providers = new Set<string>();
	const tools = new Set<string>();
	const repeatedNames = new Map<string, string[]>();
	const toolInputs = new Map<string, string[]>();
	const retrievalInputs = new Map<string, string[]>();

	let maxDepth = 0;
	let llmCallCount = 0;
	let toolCallCount = 0;
	let retrievalCallCount = 0;
	let embeddingCallCount = 0;
	let databaseCallCount = 0;
	let httpCallCount = 0;
	let errorCount = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let totalTokens = 0;
	let totalCacheReadTokens = 0;
	let totalCacheCreationTokens = 0;
	let totalReasoningTokens = 0;
	let totalCostUsd = 0;
	let totalDurationMs = 0;
	let largestContextSpanId: string | undefined;
	let largestContextTokens = 0;
	let slowestSpanId: string | undefined;
	let slowestDurationMs = 0;
	let mostExpensiveSpanId: string | undefined;
	let mostExpensiveCostUsd = 0;

	function visit(span: ImprovementSpanSummary, depth: number) {
		maxDepth = Math.max(maxDepth, depth);
		if (span.role === "llm") llmCallCount++;
		if (span.role === "tool") toolCallCount++;
		if (span.role === "retrieval") retrievalCallCount++;
		if (span.role === "embedding") embeddingCallCount++;
		if (span.role === "database") databaseCallCount++;
		if (span.role === "http") httpCallCount++;
		if (span.statusCode === "STATUS_CODE_ERROR" || Boolean(span.error)) errorCount++;

		const input = span.promptTokens || 0;
		const output = span.completionTokens || 0;
		const total = span.totalTokens || input + output;
		const cacheRead = span.cacheReadTokens || 0;
		const cacheCreation = span.cacheCreationTokens || 0;
		const reasoning = span.reasoningTokens || 0;
		const cost = span.cost || 0;
		const duration = span.durationMs || 0;

		totalInputTokens += input;
		totalOutputTokens += output;
		totalTokens += total;
		totalCacheReadTokens += cacheRead;
		totalCacheCreationTokens += cacheCreation;
		totalReasoningTokens += reasoning;
		totalCostUsd += cost;
		totalDurationMs += duration;

		if (span.model) models.add(span.model);
		if (span.provider) providers.add(span.provider);
		if (span.toolName) tools.add(span.toolName);

		if (input > largestContextTokens) {
			largestContextTokens = input;
			largestContextSpanId = span.spanId;
		}
		if (duration > slowestDurationMs) {
			slowestDurationMs = duration;
			slowestSpanId = span.spanId;
		}
		if (cost > mostExpensiveCostUsd) {
			mostExpensiveCostUsd = cost;
			mostExpensiveSpanId = span.spanId;
		}

		const nameKey = normalizeMetricKey(span.spanName, 120);
		if (nameKey) repeatedNames.set(nameKey, [...(repeatedNames.get(nameKey) || []), span.spanId]);

		const toolKey = normalizeMetricKey(span.toolArgs || span.prompt, 180);
		if (span.role === "tool" && toolKey) {
			toolInputs.set(toolKey, [...(toolInputs.get(toolKey) || []), span.spanId]);
		}
		const retrievalKey = normalizeMetricKey(span.prompt || span.toolArgs, 180);
		if ((span.role === "retrieval" || span.role === "embedding") && retrievalKey) {
			retrievalInputs.set(retrievalKey, [...(retrievalInputs.get(retrievalKey) || []), span.spanId]);
		}

		for (const child of span.children) visit(child, depth + 1);
	}
	visit(summary, 0);

	const tokenDenominator = totalInputTokens + totalCacheReadTokens + totalCacheCreationTokens;

	return {
		spanCount: spans.length,
		maxDepth,
		llmCallCount,
		toolCallCount,
		retrievalCallCount,
		embeddingCallCount,
		databaseCallCount,
		httpCallCount,
		errorCount,
		totalInputTokens,
		totalOutputTokens,
		totalTokens,
		totalCacheReadTokens,
		totalCacheCreationTokens,
		totalReasoningTokens,
		totalCostUsd,
		totalDurationMs,
		avgInputTokensPerLlm: llmCallCount > 0 ? totalInputTokens / llmCallCount : 0,
		avgOutputTokensPerLlm: llmCallCount > 0 ? totalOutputTokens / llmCallCount : 0,
		avgCostPerLlm: llmCallCount > 0 ? totalCostUsd / llmCallCount : 0,
		cacheHitRate: tokenDenominator > 0 ? totalCacheReadTokens / tokenDenominator : 0,
		costPerCall: spans.length > 0 ? totalCostUsd / spans.length : 0,
		modelsUsed: Array.from(models),
		providersUsed: Array.from(providers),
		toolsUsed: Array.from(tools),
		largestContextSpanId,
		largestContextTokens,
		slowestSpanId,
		slowestDurationMs,
		mostExpensiveSpanId,
		mostExpensiveCostUsd,
		repeatedSpanNames: topRepeatedEntries(repeatedNames).map(({ key, ...entry }) => ({ name: key, ...entry })),
		duplicateToolInputs: topRepeatedEntries(toolInputs),
		duplicateRetrievalInputs: topRepeatedEntries(retrievalInputs),
		potentialRetrySequences: siblingRetrySequences(summary).slice(0, 8),
	};
}

function contextForLogs(summary: ImprovementSpanSummary, metrics: TraceAnalysisMetrics) {
	const spans = flattenSummary(summary);
	return {
		traceId: summary.traceId,
		rootSpanId: summary.spanId,
		spanCount: metrics.spanCount,
		maxDepth: metrics.maxDepth,
		llmCallCount: metrics.llmCallCount,
		toolCallCount: metrics.toolCallCount,
		retrievalCallCount: metrics.retrievalCallCount,
		errorCount: metrics.errorCount,
		totalTokens: metrics.totalTokens,
		totalInputTokens: metrics.totalInputTokens,
		totalOutputTokens: metrics.totalOutputTokens,
		totalCacheReadTokens: metrics.totalCacheReadTokens,
		totalCacheCreationTokens: metrics.totalCacheCreationTokens,
		totalReasoningTokens: metrics.totalReasoningTokens,
		totalCostUsd: metrics.totalCostUsd,
		modelsUsed: metrics.modelsUsed,
		toolsUsed: metrics.toolsUsed,
		mostExpensiveSpanId: metrics.mostExpensiveSpanId,
		slowestSpanId: metrics.slowestSpanId,
		largestContextSpanId: metrics.largestContextSpanId,
		repeatedSpanNames: metrics.repeatedSpanNames,
		duplicateToolInputs: metrics.duplicateToolInputs,
		duplicateRetrievalInputs: metrics.duplicateRetrievalInputs,
		potentialRetrySequences: metrics.potentialRetrySequences,
		spanPreviews: spans.slice(0, 12).map((span) => ({
			spanId: span.spanId,
			name: span.spanName,
			role: span.role,
			serviceName: span.serviceName,
			resource: span.resource,
			attributeKeys: span.attributeKeys,
			resourceKeys: span.resourceKeys,
			model: span.model,
			toolName: span.toolName,
			toolCallId: span.toolCallId,
			durationMs: span.durationMs,
			cost: span.cost,
			inputTokens: span.promptTokens,
			outputTokens: span.completionTokens,
			cacheReadTokens: span.cacheReadTokens,
			cacheCreationTokens: span.cacheCreationTokens,
			systemPreview: previewValue(span.systemPrompt),
			promptPreview: previewValue(span.prompt),
			responsePreview: previewValue(span.response),
			reasoningPreview: previewValue(span.reasoning),
			toolArgsPreview: previewValue(span.toolArgs),
			toolResultPreview: previewValue(span.toolResult),
			dbQueryPreview: previewValue(span.dbQuery),
			httpUrl: span.httpUrl,
			events: span.eventSummary,
			error: previewValue(span.error),
		})),
	};
}

function spanForDimension(span: ImprovementSpanSummary, dimension: TraceAnalysisDimension): Record<string, unknown> {
	const base = {
		spanId: span.spanId,
		spanName: span.spanName,
		role: span.role,
		statusCode: span.statusCode,
		statusMessage: span.statusMessage,
		durationMs: span.durationMs,
		error: span.error,
		children: span.children.map((child) => spanForDimension(child, dimension)),
	};

	if (dimension === "cost") {
		return {
			...base,
			model: span.model,
			provider: span.provider,
			cost: span.cost,
			promptTokens: span.promptTokens,
			completionTokens: span.completionTokens,
			totalTokens: span.totalTokens,
		};
	}

	if (dimension === "token_efficiency") {
		return {
			...base,
			model: span.model,
			promptTokens: span.promptTokens,
			completionTokens: span.completionTokens,
			totalTokens: span.totalTokens,
			cacheReadTokens: span.cacheReadTokens,
			cacheCreationTokens: span.cacheCreationTokens,
			reasoningTokens: span.reasoningTokens,
			systemPrompt: span.systemPrompt,
			prompt: span.prompt,
			response: span.response,
			toolArgs: span.toolArgs,
			toolResult: span.toolResult,
		};
	}

	if (dimension === "wrong_turns") {
		return {
			...base,
			toolName: span.toolName,
			toolArgs: span.toolArgs,
			toolResult: span.toolResult,
			prompt: span.prompt,
			response: span.response,
			reasoning: span.reasoning,
			eventSummary: span.eventSummary,
		};
	}

	if (dimension === "path_analysis") {
		return {
			...base,
			serviceName: span.serviceName,
			toolName: span.toolName,
			toolCallId: span.toolCallId,
			toolArgs: span.toolArgs,
			dbQuery: span.dbQuery,
			httpUrl: span.httpUrl,
			resource: span.resource,
		};
	}

	if (dimension === "strengths") {
		return {
			...base,
			model: span.model,
			provider: span.provider,
			cost: span.cost,
			totalTokens: span.totalTokens,
			toolName: span.toolName,
			prompt: span.prompt,
			response: span.response,
		};
	}

	return {
		...base,
		model: span.model,
		provider: span.provider,
		cost: span.cost,
		totalTokens: span.totalTokens,
		prompt: span.prompt,
		response: span.response,
		toolName: span.toolName,
		toolArgs: span.toolArgs,
		toolResult: span.toolResult,
		dbQuery: span.dbQuery,
		httpUrl: span.httpUrl,
		resource: span.resource,
	};
}

function metricsForDimension(metrics: TraceAnalysisMetrics, dimension: TraceAnalysisDimension): Record<string, unknown> {
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

	if (dimension === "cost") {
		return {
			...common,
			totalCostUsd: metrics.totalCostUsd,
			costPerCall: metrics.costPerCall,
			avgCostPerLlm: metrics.avgCostPerLlm,
			mostExpensiveSpanId: metrics.mostExpensiveSpanId,
			mostExpensiveCostUsd: metrics.mostExpensiveCostUsd,
			totalTokens: metrics.totalTokens,
		};
	}

	if (dimension === "token_efficiency") {
		return {
			...common,
			totalInputTokens: metrics.totalInputTokens,
			totalOutputTokens: metrics.totalOutputTokens,
			totalTokens: metrics.totalTokens,
			totalCacheReadTokens: metrics.totalCacheReadTokens,
			totalCacheCreationTokens: metrics.totalCacheCreationTokens,
			totalReasoningTokens: metrics.totalReasoningTokens,
			cacheHitRate: metrics.cacheHitRate,
			largestContextSpanId: metrics.largestContextSpanId,
			largestContextTokens: metrics.largestContextTokens,
			duplicateToolInputs: metrics.duplicateToolInputs,
			duplicateRetrievalInputs: metrics.duplicateRetrievalInputs,
			repeatedSpanNames: metrics.repeatedSpanNames,
		};
	}

	if (dimension === "wrong_turns") {
		return {
			...common,
			potentialRetrySequences: metrics.potentialRetrySequences,
			repeatedSpanNames: metrics.repeatedSpanNames,
			slowestSpanId: metrics.slowestSpanId,
			slowestDurationMs: metrics.slowestDurationMs,
		};
	}

	if (dimension === "path_analysis") {
		return {
			...common,
			totalDurationMs: metrics.totalDurationMs,
			maxDepth: metrics.maxDepth,
			repeatedSpanNames: metrics.repeatedSpanNames,
			potentialRetrySequences: metrics.potentialRetrySequences,
			databaseCallCount: metrics.databaseCallCount,
			httpCallCount: metrics.httpCallCount,
		};
	}

	return {
		...common,
		totalCostUsd: metrics.totalCostUsd,
		totalTokens: metrics.totalTokens,
		totalDurationMs: metrics.totalDurationMs,
		slowestSpanId: metrics.slowestSpanId,
		mostExpensiveSpanId: metrics.mostExpensiveSpanId,
		largestContextSpanId: metrics.largestContextSpanId,
	};
}

function buildDimensionSystemPrompt(dimension: TraceAnalysisDimension) {
	return `You are analyzing one dimension of a single OpenTelemetry trace from an LLM application.

Dimension: ${dimension}
Dimension goal: ${DIMENSION_GUIDANCE[dimension]}

Rules:
- Output strict JSON only.
- Return an object with exactly this shape: {"summary":"one concise sentence","findings":Finding[]}
- Finding schema: ${TRACE_ANALYSIS_SCHEMA.match(/type Finding = \{[\s\S]*?\};/)?.[0] || "Finding[]"}
- Every finding must cite span IDs in span_refs.
- If this dimension is healthy or there is no concrete evidence, return {"summary":"No concrete findings for this dimension.","findings":[]}.
- Do not include findings from other dimensions. If evidence belongs to a more specific dimension, omit it from this pass.
- Be concrete, span-grounded, and concise.`;
}

function buildDimensionUserPrompt({
	spanId,
	dimension,
	summary,
	metrics,
	ruleContext,
}: {
	spanId: string;
	dimension: TraceAnalysisDimension;
	summary: ImprovementSpanSummary;
	metrics: TraceAnalysisMetrics;
	ruleContext: TraceRuleContext;
}) {
	return `Analyze only the "${dimension}" dimension.

Source span id: ${spanId}

Focused deterministic metrics:
\`\`\`json
${JSON.stringify(metricsForDimension(metrics, dimension), null, 2)}
\`\`\`

Rule-engine context:
\`\`\`json
${JSON.stringify({
	matchingRuleIds: ruleContext.matchingRuleIds,
	contextEntityIds: ruleContext.contextEntityIds,
	contextContents: ruleContext.contextContents.map((content) => truncateMiddle(content, 350)),
}, null, 2)}
\`\`\`

Focused trace tree:
\`\`\`json
${JSON.stringify(spanForDimension(summary, dimension), null, 2)}
\`\`\`

Return strict JSON: {"summary": string, "findings": Finding[]}.`;
}

function buildDimensionGraderSystemPrompt(dimension: TraceAnalysisDimension) {
	return `You are the quality grader for one dimension of an OpenTelemetry trace analysis.

Dimension: ${dimension}
Dimension goal: ${DIMENSION_GUIDANCE[dimension]}

Your job is to improve the first-pass analysis, not to produce a separate critique.

Rules:
- Output strict JSON only.
- Return an object with exactly this shape: {"summary":"one concise sentence","findings":Finding[]}
- Finding schema: ${TRACE_ANALYSIS_SCHEMA.match(/type Finding = \{[\s\S]*?\};/)?.[0] || "Finding[]"}
- Remove findings that are generic, duplicate, weakly supported, or outside this dimension.
- Improve severity, summaries, details, span_refs, suggested_fix, and estimated_savings when the evidence supports it.
- Add missing high-confidence findings only when directly supported by the provided metrics or trace tree.
- Every finding must cite span IDs in span_refs.
- Do not invent telemetry, token counts, costs, tools, prompts, or failures.
- If there are no concrete supported findings, return {"summary":"No concrete findings for this dimension.","findings":[]}.`;
}

function buildDimensionGraderUserPrompt({
	spanId,
	dimension,
	summary,
	metrics,
	ruleContext,
	firstPass,
}: {
	spanId: string;
	dimension: TraceAnalysisDimension;
	summary: ImprovementSpanSummary;
	metrics: TraceAnalysisMetrics;
	ruleContext: TraceRuleContext;
	firstPass: { summary: string; findings: TraceAnalysisFinding[] };
}) {
	return `Grade and refine the first-pass "${dimension}" analysis.

Source span id: ${spanId}

First-pass analysis:
\`\`\`json
${JSON.stringify(firstPass, null, 2)}
\`\`\`

Focused deterministic metrics:
\`\`\`json
${JSON.stringify(metricsForDimension(metrics, dimension), null, 2)}
\`\`\`

Rule-engine context:
\`\`\`json
${JSON.stringify({
	matchingRuleIds: ruleContext.matchingRuleIds,
	contextEntityIds: ruleContext.contextEntityIds,
	contextContents: ruleContext.contextContents.map((content) => truncateMiddle(content, 350)),
}, null, 2)}
\`\`\`

Focused trace tree:
\`\`\`json
${JSON.stringify(spanForDimension(summary, dimension), null, 2)}
\`\`\`

Return the improved final JSON only: {"summary": string, "findings": Finding[]}.`;
}

function estimateCost(promptTokens: number, completionTokens: number) {
	return (promptTokens * 0.003 + completionTokens * 0.015) / 1000;
}

function calculateTotals(root: TraceHeirarchySpan) {
	const spans = collectSpanIds(root);
	let totalTokens = 0;
	let totalCost = 0;
	let durationMs = 0;

	function visit(span: TraceHeirarchySpan) {
		const attrs = span.SpanAttributes || {};
		totalTokens += readFirstNumber(attrs, [
			"gen_ai.usage.total_tokens",
			"gen_ai.client.token.usage",
			"llm.usage.total_tokens",
			"total_tokens",
			"claude_code.usage.total_tokens",
		]) || 0;
		totalCost += span.Cost || readFirstNumber(attrs, [
			"gen_ai.usage.cost",
			"llm.usage.cost",
			"cost",
			"claude_code.cost",
		]) || 0;
		durationMs += spanDurationMs(span);
		(span.children || []).forEach(visit);
	}
	visit(root);

	return {
		span_count: spans.length,
		total_tokens: totalTokens,
		total_cost_usd: totalCost,
		duration_ms: durationMs,
	};
}

function normalizeFinding(finding: any, dimension: TraceAnalysisDimension): TraceAnalysisFinding {
	return {
		id: finding.id || stableFindingId(finding, dimension),
		severity: ["info", "minor", "major", "critical"].includes(finding.severity)
			? finding.severity
			: "info",
		summary: String(finding.summary || "Untitled finding").slice(0, 140),
		detail: String(finding.detail || ""),
		span_refs: Array.isArray(finding.span_refs) ? finding.span_refs.map(String) : [],
		...(finding.suggested_fix ? { suggested_fix: String(finding.suggested_fix) } : {}),
		...(Array.isArray(finding.suggested_fix_patches) && finding.suggested_fix_patches.length > 0
			? {
					suggested_fix_patches: finding.suggested_fix_patches
						.filter((p: any) => p && p.field && p.span_ref && typeof p.original === "string" && typeof p.replacement === "string")
						.map((p: any) => ({
							field: ["prompt", "response", "system"].includes(p.field) ? p.field : "prompt",
							span_ref: String(p.span_ref),
							original: String(p.original).slice(0, 300),
							replacement: String(p.replacement).slice(0, 300),
						})),
				}
			: {}),
		...(finding.estimated_savings ? { estimated_savings: finding.estimated_savings } : {}),
	};
}

function parseDimensionAnalysis(
	rawText: string,
	dimension: TraceAnalysisDimension,
	root: TraceHeirarchySpan
): { summary: string; findings: TraceAnalysisFinding[] } {
	const jsonText = rawText
		.trim()
		.replace(/^```json\s*/i, "")
		.replace(/^```\s*/i, "")
		.replace(/```$/i, "")
		.trim();
	try {
		const parsed = JSON.parse(jsonText);
		const findingsSource = Array.isArray(parsed)
			? parsed
			: Array.isArray(parsed?.findings)
				? parsed.findings
				: Array.isArray(parsed?.[dimension])
					? parsed[dimension]
					: [];
		return {
			summary: String(parsed?.summary || ""),
			findings: findingsSource.map((finding: any) => normalizeFinding(finding, dimension)),
		};
	} catch (error) {
		logTraceAnalysisError("dimension_parse_failed", error, {
			dimension,
			rootSpanId: root.SpanId,
			rawChars: rawText.length,
			rawPreview: previewValue(rawText, 300),
		});
		return {
			summary: "This dimension could not be parsed.",
			findings: [{
				id: stableFindingId({ span_refs: [root.SpanId], summary: `${DIMENSION_LABELS[dimension]} analysis could not be parsed` }, dimension),
				severity: "minor",
				summary: `${DIMENSION_LABELS[dimension]} analysis could not be parsed`,
				detail: "The model response for this dimension was not valid JSON, so OpenLIT could not build findings for it.",
				span_refs: [root.SpanId],
				suggested_fix: "Rerun the analysis. If this persists, tighten the model configuration for this dimension.",
			}],
		};
	}
}

type DimensionGenerationStats = {
	promptTokens: number;
	completionTokens: number;
	cost: number;
};

async function streamJsonText({
	model,
	system,
	prompt,
	maxOutputTokens,
	onUsage,
}: {
	model: Parameters<typeof streamText>[0]["model"];
	system: string;
	prompt: string;
	maxOutputTokens: number;
	onUsage: (stats: DimensionGenerationStats) => void;
}) {
	let text = "";
	let finishResolve: () => void;
	const finishPromise = new Promise<void>((resolve) => {
		finishResolve = resolve;
	});

	const result = streamText({
		model,
		system,
		prompt,
		maxOutputTokens,
		temperature: 0,
		onFinish: ({ usage }) => {
			const promptTokens = usage?.inputTokens ?? 0;
			const completionTokens = usage?.outputTokens ?? 0;
			onUsage({
				promptTokens,
				completionTokens,
				cost: estimateCost(promptTokens, completionTokens),
			});
			finishResolve!();
		},
	});

	for await (const part of result.fullStream) {
		const textDelta =
			part.type === "text-delta"
				? ((part as any).text ?? (part as any).delta ?? "")
				: "";
		if (textDelta) text += textDelta;
	}

	await Promise.race([
		finishPromise,
		new Promise((resolve) => setTimeout(resolve, 5000)),
	]);

	return text;
}

function buildAggregatedSummary(dimensionSummaries: Partial<Record<TraceAnalysisDimension, string>>, analysis: TraceAnalysis) {
	const counts = TRACE_ANALYSIS_DIMENSIONS
		.map((dimension) => `${DIMENSION_LABELS[dimension]}: ${analysis[dimension].length}`)
		.join(", ");
	const nonEmptySummaries = TRACE_ANALYSIS_DIMENSIONS
		.map((dimension) => dimensionSummaries[dimension])
		.filter(Boolean)
		.slice(0, 2);
	return [
		`Focused analysis completed across six separate dimension passes (${counts}).`,
		nonEmptySummaries.length ? nonEmptySummaries.join(" ") : "No concrete issues were found beyond the populated dimension findings.",
	].join(" ");
}

export async function getTraceImprovement(
	spanId: string,
	databaseConfigId?: string,
	scope: TraceAnalysisScope = "trace"
): Promise<{ data?: { rootSpanId: string; runs: TraceAnalysisRun[] }; err?: unknown }> {
	logTraceAnalysis("get_start", { spanId, scope, databaseConfigId: databaseConfigId || "" });
	const { record, err } = await getHeirarchyViaSpanId(spanId);
	const hierarchyRecord = record as TraceHeirarchySpan | undefined;
	if (err || !hierarchyRecord?.SpanId) {
		logTraceAnalysisError("get_hierarchy_failed", err || "Trace hierarchy not found", { spanId });
		return { err: err || "Trace hierarchy not found" };
	}

	const { analysisRoot, rootSpanId } = getAnalysisTarget(hierarchyRecord, spanId, scope);
	const analysisType = analysisTypeForScope(scope);

	const { data: runs, err: runsErr } = await getTraceAnalysisRuns(rootSpanId, databaseConfigId, analysisType);
	logTraceAnalysis("get_runs_loaded", {
		spanId,
		scope,
		rootSpanId,
		analysisType,
		runCount: runs?.length || 0,
		hasRunError: Boolean(runsErr),
	});

	if (!runsErr && runs && runs.length > 0) {
		return { data: { rootSpanId, runs } };
	}

	logTraceAnalysis("get_no_runs", { spanId, scope, rootSpanId, analysisType });
	return { data: { rootSpanId, runs: [] } };
}

function createStreamEvent(
	controller: ReadableStreamDefaultController<Uint8Array>,
	encoder: TextEncoder,
	event: Record<string, unknown>
) {
	controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function createDebugEvent(
	controller: ReadableStreamDefaultController<Uint8Array>,
	encoder: TextEncoder,
	stage: string,
	payload: Record<string, unknown>
) {
	createStreamEvent(controller, encoder, {
		type: "debug",
		stage,
		payload: {
			time: new Date().toISOString(),
			...payload,
		},
	});
}

export async function streamTraceImprovementAnalysis(
	spanId: string,
	databaseConfigId?: string,
	scope: TraceAnalysisScope = "trace"
) {
	logTraceAnalysis("start", { spanId, scope, databaseConfigId: databaseConfigId || "" });
	const { data: config, err: configErr } =
		await getChatConfigWithApiKey(databaseConfigId);
	if (configErr || !config) {
		logTraceAnalysisError("config_failed", configErr || "Chat not configured", { spanId });
		return {
			err:
				configErr ||
				"Chat not configured. Please set up your AI provider in Chat Settings.",
		};
	}
	logTraceAnalysis("config_loaded", {
		spanId,
		provider: config.provider,
		model: config.model,
		hasApiKey: Boolean(config.apiKey),
	});

	const { record, err: hierarchyErr } = await getHeirarchyViaSpanId(spanId);
	const hierarchyRecord = record as TraceHeirarchySpan | undefined;
	if (hierarchyErr || !hierarchyRecord?.SpanId) {
		logTraceAnalysisError("hierarchy_failed", hierarchyErr || "Trace hierarchy not found", { spanId });
		return { err: hierarchyErr || "Trace hierarchy not found" };
	}

	const { analysisRoot, rootSpanId } = getAnalysisTarget(hierarchyRecord, spanId, scope);
	const analysisType = analysisTypeForScope(scope);
	const { data: existingRuns } = await getTraceAnalysisRuns(rootSpanId, databaseConfigId, analysisType);
	const runNumber = (existingRuns?.length || 0) + 1;

	const summary = summarizeSpan(analysisRoot);
	const metrics = extractTraceMetrics(summary);
	const ruleContext = await getRuleContextForTraceHierarchy(
		analysisRoot,
		spanId,
		databaseConfigId
	);
	logTraceAnalysis("hierarchy_loaded", {
		spanId,
		scope,
		rootSpanId,
		targetSpanId: analysisRoot.SpanId,
		analysisType,
		runNumber,
		existingRunCount: existingRuns?.length || 0,
		childCount: analysisRoot.children?.length || 0,
	});
	logTraceAnalysis("context_extracted", contextForLogs(summary, metrics));
	logTraceAnalysis("rule_context_extracted", {
		spanId,
		rootSpanId,
		matchingRuleIds: ruleContext.matchingRuleIds,
		contextEntityIds: ruleContext.contextEntityIds,
		contextCount: ruleContext.contextContents.length,
		contextPreviews: ruleContext.contextContents.map((content) => previewValue(content, 220)),
	});
	const dimensionPromptChars = TRACE_ANALYSIS_DIMENSIONS.reduce(
		(total, dimension) =>
			total +
			buildDimensionSystemPrompt(dimension).length +
			buildDimensionUserPrompt({ spanId, dimension, summary, metrics, ruleContext }).length,
		0
	);
	logTraceAnalysis("prompt_built", {
		spanId,
		rootSpanId,
		passCount: TRACE_ANALYSIS_DIMENSIONS.length,
		totalDimensionPromptChars: dimensionPromptChars,
		distilledTreeChars: JSON.stringify(summary).length,
		metricsChars: JSON.stringify(metrics).length,
		ruleContextChars: JSON.stringify(ruleContext).length,
	});
	const modelInstance = getModelInstance(config.provider, config.apiKey, config.model);
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let finishStats = { promptTokens: 0, completionTokens: 0, cost: 0 };
			const addFinishStats = (stats: DimensionGenerationStats) => {
				finishStats = {
					promptTokens: finishStats.promptTokens + stats.promptTokens,
					completionTokens: finishStats.completionTokens + stats.completionTokens,
					cost: finishStats.cost + stats.cost,
				};
			};

			try {
				const traceId =
					(hierarchyRecord as any).traceId || (hierarchyRecord as any).TraceId || rootSpanId;
				createDebugEvent(controller, encoder, "hierarchy_loaded", {
					spanId,
					scope,
					rootSpanId,
					targetSpanId: analysisRoot.SpanId,
					analysisType,
					runNumber,
					existingRunCount: existingRuns?.length || 0,
					childCount: analysisRoot.children?.length || 0,
				});
				createDebugEvent(controller, encoder, "context_extracted", contextForLogs(summary, metrics));
				createDebugEvent(controller, encoder, "rule_context_extracted", {
					spanId,
					rootSpanId,
					matchingRuleIds: ruleContext.matchingRuleIds,
					contextEntityIds: ruleContext.contextEntityIds,
					contextCount: ruleContext.contextContents.length,
					contextPreviews: ruleContext.contextContents.map((content) => previewValue(content, 220)),
				});
				createDebugEvent(controller, encoder, "prompt_built", {
					spanId,
					rootSpanId,
					passCount: TRACE_ANALYSIS_DIMENSIONS.length,
					totalDimensionPromptChars: dimensionPromptChars,
					distilledTreeChars: JSON.stringify(summary).length,
					metricsChars: JSON.stringify(metrics).length,
					ruleContextChars: JSON.stringify(ruleContext).length,
				});
				createStreamEvent(controller, encoder, {
					type: "step",
					status: "complete",
					label: scope === "span" ? "Loaded span context" : "Loaded trace hierarchy",
					detail: `${scope === "span" ? "Span" : "Root span"} ${rootSpanId}; ${metrics.spanCount} spans`,
				});
				createStreamEvent(controller, encoder, {
					type: "step",
					status: "complete",
					label: "Extracted prompt, response, tokens, cost, and tool steps",
					detail: `${metrics.llmCallCount} LLM calls, ${metrics.toolCallCount} tools, ${metrics.totalTokens} tokens, $${metrics.totalCostUsd.toFixed(6)}`,
				});
				createStreamEvent(controller, encoder, {
					type: "step",
					status: "active",
					label: "Otter is analyzing each dimension separately",
				});

				const analysis = emptyTraceAnalysis(traceId);
				analysis.totals = calculateTotals(analysisRoot);
				const dimensionSummaries: Partial<Record<TraceAnalysisDimension, string>> = {};

				await Promise.all(TRACE_ANALYSIS_DIMENSIONS.map(async (dimension) => {
					createStreamEvent(controller, encoder, {
						type: "step",
						status: "active",
						label: `Analyzing ${DIMENSION_LABELS[dimension]}`,
						detail: DIMENSION_GUIDANCE[dimension],
					});
					logTraceAnalysis("dimension_started", {
						spanId,
						scope,
						rootSpanId,
						runNumber,
						dimension,
					});

					let dimensionText = "";
					let dimensionStats = { promptTokens: 0, completionTokens: 0, cost: 0 };
					dimensionText = await streamJsonText({
						system: buildDimensionSystemPrompt(dimension),
						prompt: buildDimensionUserPrompt({
							spanId,
							dimension,
							summary,
							metrics,
							ruleContext,
						}),
						maxOutputTokens: 900,
						model: modelInstance,
						onUsage: (stats) => {
							dimensionStats = stats;
							addFinishStats(stats);
						},
					});

					const dimensionAnalysis = parseDimensionAnalysis(
						dimensionText,
						dimension,
						analysisRoot
					);

					logTraceAnalysis("dimension_finished", {
						spanId,
						scope,
						rootSpanId,
						runNumber,
						dimension,
						responseChars: dimensionText.length,
						findingCount: dimensionAnalysis.findings.length,
						promptTokens: dimensionStats.promptTokens,
						completionTokens: dimensionStats.completionTokens,
						cost: dimensionStats.cost,
						summaryPreview: previewValue(dimensionAnalysis.summary, 180),
					});
					createDebugEvent(controller, encoder, "dimension_finished", {
						spanId,
						rootSpanId,
						runNumber,
						dimension,
						findingCount: dimensionAnalysis.findings.length,
						promptTokens: dimensionStats.promptTokens,
						completionTokens: dimensionStats.completionTokens,
						cost: dimensionStats.cost,
						summaryPreview: previewValue(dimensionAnalysis.summary, 180),
					});
					createStreamEvent(controller, encoder, {
						type: "step",
						status: "active",
						label: `Grading ${DIMENSION_LABELS[dimension]}`,
						detail: "Checking evidence, removing weak findings, and tightening recommendations",
					});

					let gradedAnalysis = dimensionAnalysis;
					let graderText = "";
					let graderStats = { promptTokens: 0, completionTokens: 0, cost: 0 };
					try {
						graderText = await streamJsonText({
							model: modelInstance,
							system: buildDimensionGraderSystemPrompt(dimension),
							prompt: buildDimensionGraderUserPrompt({
								spanId,
								dimension,
								summary,
								metrics,
								ruleContext,
								firstPass: dimensionAnalysis,
							}),
							maxOutputTokens: 1000,
							onUsage: (stats) => {
								graderStats = stats;
								addFinishStats(stats);
							},
						});
						gradedAnalysis = parseDimensionAnalysis(
							graderText,
							dimension,
							analysisRoot
						);
						if (gradedAnalysis.summary === "This dimension could not be parsed.") {
							logTraceAnalysisError("dimension_grader_parse_failed_fallback", "Using first-pass analysis", {
								spanId,
								scope,
								rootSpanId,
								runNumber,
								dimension,
								rawChars: graderText.length,
								rawPreview: previewValue(graderText, 300),
							});
							gradedAnalysis = dimensionAnalysis;
						}
					} catch (error) {
						logTraceAnalysisError("dimension_grader_failed", error, {
							spanId,
							scope,
							rootSpanId,
							runNumber,
							dimension,
						});
					}

					analysis[dimension] = gradedAnalysis.findings;
					dimensionSummaries[dimension] = gradedAnalysis.summary;

					logTraceAnalysis("dimension_graded", {
						spanId,
						scope,
						rootSpanId,
						runNumber,
						dimension,
						responseChars: graderText.length,
						firstPassFindingCount: dimensionAnalysis.findings.length,
						finalFindingCount: analysis[dimension].length,
						promptTokens: graderStats.promptTokens,
						completionTokens: graderStats.completionTokens,
						cost: graderStats.cost,
						summaryPreview: previewValue(gradedAnalysis.summary, 180),
					});
					createDebugEvent(controller, encoder, "dimension_graded", {
						spanId,
						rootSpanId,
						runNumber,
						dimension,
						firstPassFindingCount: dimensionAnalysis.findings.length,
						finalFindingCount: analysis[dimension].length,
						promptTokens: graderStats.promptTokens,
						completionTokens: graderStats.completionTokens,
						cost: graderStats.cost,
						summaryPreview: previewValue(gradedAnalysis.summary, 180),
					});
					createStreamEvent(controller, encoder, {
						type: "dimension",
						dimension,
						findings: analysis[dimension],
					});
					createStreamEvent(controller, encoder, {
						type: "step",
						status: "complete",
						label: `Grading ${DIMENSION_LABELS[dimension]}`,
					});
					createStreamEvent(controller, encoder, {
						type: "step",
						status: "complete",
						label: `Analyzing ${DIMENSION_LABELS[dimension]}`,
					});
				}));

				analysis.summary = buildAggregatedSummary(dimensionSummaries, analysis);
				const dimensionCounts = Object.fromEntries(
					TRACE_ANALYSIS_DIMENSIONS.map((dimension) => [dimension, analysis[dimension].length])
				);
				logTraceAnalysis("model_response_parsed", {
					spanId,
					rootSpanId,
					runNumber,
					scope,
					summaryPreview: previewValue(analysis.summary, 220),
					dimensionCounts,
					promptTokens: finishStats.promptTokens,
					completionTokens: finishStats.completionTokens,
					estimatedCost: finishStats.cost,
				});
				createDebugEvent(controller, encoder, "model_response_parsed", {
					spanId,
					rootSpanId,
					runNumber,
					summaryPreview: previewValue(analysis.summary, 220),
					dimensionCounts,
					promptTokens: finishStats.promptTokens,
					completionTokens: finishStats.completionTokens,
					estimatedCost: finishStats.cost,
				});

				createStreamEvent(controller, encoder, {
					type: "step",
					status: "complete",
					label: "Otter is analyzing each dimension separately",
				});
				createStreamEvent(controller, encoder, {
					type: "step",
					status: "active",
					label: "Saving improvement analysis",
				});

				const { data: savedRun, err: saveErr } = await saveTraceAnalysisRun(
					{
						rootSpanId,
						selectedSpanId: spanId,
						analysisType,
						runNumber,
						analysis,
						modelProvider: config.provider,
						modelName: config.model,
						promptTokens: finishStats.promptTokens,
						completionTokens: finishStats.completionTokens,
						cost: finishStats.cost,
					},
					databaseConfigId
				);

				if (saveErr || !savedRun) {
					throw new Error("Failed to save trace analysis run");
				}
				logTraceAnalysis("analysis_saved", {
					spanId,
					scope,
					rootSpanId,
					runNumber,
					savedRunId: savedRun.id,
					worstSeverity: savedRun.worstSeverity,
					promptTokens: finishStats.promptTokens,
					completionTokens: finishStats.completionTokens,
					cost: finishStats.cost,
				});
				createDebugEvent(controller, encoder, "analysis_saved", {
					spanId,
					rootSpanId,
					runNumber,
					savedRunId: savedRun.id,
					worstSeverity: savedRun.worstSeverity,
					promptTokens: finishStats.promptTokens,
					completionTokens: finishStats.completionTokens,
					cost: finishStats.cost,
				});

				createStreamEvent(controller, encoder, {
					type: "step",
					status: "complete",
					label: "Saving improvement analysis",
				});

				createStreamEvent(controller, encoder, {
					type: "done",
					data: {
						rootSpanId,
						runs: [...(existingRuns || []), savedRun],
					},
				});
			} catch (error: any) {
				logTraceAnalysisError("stream_failed", error, { spanId, rootSpanId, runNumber });
				createStreamEvent(controller, encoder, {
					type: "error",
					error: error?.message || "Failed to run AI improvement analysis",
				});
			} finally {
				controller.close();
			}
		},
	});

	return {
		response: new Response(stream, {
			headers: {
				"Content-Type": "application/x-ndjson; charset=utf-8",
				"Cache-Control": "no-cache, no-transform",
			},
		}),
	};
}
