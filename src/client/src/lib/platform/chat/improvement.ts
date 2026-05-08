import { streamText } from "ai";
import { createHash, randomUUID } from "crypto";
import { getChatConfigWithApiKey } from "./config";
import { getImprovementConversationByHierarchySpanIds } from "./conversation";
import { OPENLIT_TRACE_ANALYSIS_TABLE } from "./table-details";
import { dataCollector } from "../common";
import { getModelInstance } from "./stream";
import { getHeirarchyViaSpanId } from "../request";
import { TraceHeirarchySpan } from "@/types/trace";
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
	statusCode?: string;
	durationMs: number;
	cost?: number;
	model?: string;
	provider?: string;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	prompt?: string;
	response?: string;
	toolName?: string;
	toolArgs?: string;
	error?: string;
	children: ImprovementSpanSummary[];
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
	databaseConfigId?: string
): Promise<{ data?: TraceAnalysisRun[]; err?: unknown }> {
	const safeRootSpanId = Sanitizer.sanitizeValue(rootSpanId);
	const query = `
		SELECT
			id,
			root_span_id AS rootSpanId,
			selected_span_id AS selectedSpanId,
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
	}: {
		rootSpanId: string;
		selectedSpanId: string;
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

export async function getAnalysisStatusBySpanIds(
	spanIds: string[],
	databaseConfigId?: string
): Promise<{ data?: Record<string, string>; err?: unknown }> {
	if (!spanIds.length) return { data: {} };
	const safeIds = spanIds.map((id) => Sanitizer.sanitizeValue(id)).filter(Boolean);
	const idList = safeIds.map((id) => `'${id}'`).join(", ");
	const query = `
		SELECT root_span_id AS rootSpanId, argMax(worst_severity, run_number) AS worstSeverity
		FROM ${OPENLIT_TRACE_ANALYSIS_TABLE}
		WHERE root_span_id IN (${idList})
		GROUP BY root_span_id
	`;
	const { data, err } = await dataCollector({ query }, "query", databaseConfigId);
	if (err) return { data: {} };
	const rows = (data as { rootSpanId: string; worstSeverity: string }[]) || [];
	return {
		data: Object.fromEntries(rows.map((r) => [r.rootSpanId, r.worstSeverity])),
	};
}

export async function getComparisonBySpanIds(
	spanIds: string[],
	databaseConfigId?: string
): Promise<{
	data?: Array<{ rootSpanId: string; runs: TraceAnalysisRun[] }>;
	err?: unknown;
}> {
	const results = await Promise.all(
		spanIds.map(async (spanId) => {
			const { data, err } = await getTraceImprovement(spanId, databaseConfigId);
			if (err || !data) return null;
			return data;
		})
	);
	const filtered = results.filter(Boolean) as Array<{ rootSpanId: string; runs: TraceAnalysisRun[] }>;
	return { data: filtered };
}

function readNumber(attrs: Record<string, string | number>, key: string) {
	const value = Number(attrs[key]);
	return Number.isFinite(value) ? value : undefined;
}

function readString(attrs: Record<string, string | number>, keys: string[]) {
	for (const key of keys) {
		const value = attrs[key];
		if (typeof value === "string" && value.trim()) return value;
		if (typeof value === "number") return String(value);
	}
	return undefined;
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

function summarizeSpan(span: TraceHeirarchySpan): ImprovementSpanSummary {
	const attrs = span.SpanAttributes || {};
	const prompt = readString(attrs, [
		"gen_ai.input.messages",
		"gen_ai.content.prompt",
		"gen_ai.request.input",
		"db.query.text",
	]);
	const response = readString(attrs, [
		"gen_ai.output.messages",
		"gen_ai.content.completion",
		"gen_ai.response.output",
	]);

	return {
		traceId: (span as any).TraceId,
		spanId: span.SpanId,
		spanName: span.SpanName,
		statusCode: span.StatusCode,
		durationMs: Number.isFinite(span.Duration) ? span.Duration / 1e6 : 0,
		cost: span.Cost,
		model: readString(attrs, [
			"gen_ai.request.model",
			"gen_ai.response.model",
			"llm.request.model",
		]),
		provider: readString(attrs, ["gen_ai.system", "llm.system"]),
		promptTokens:
			readNumber(attrs, "gen_ai.usage.input_tokens") ||
			readNumber(attrs, "gen_ai.usage.prompt_tokens"),
		completionTokens:
			readNumber(attrs, "gen_ai.usage.output_tokens") ||
			readNumber(attrs, "gen_ai.usage.completion_tokens"),
		totalTokens: readNumber(attrs, "gen_ai.usage.total_tokens"),
		prompt: truncateMiddle(prompt),
		response: truncateMiddle(response),
		toolName: readString(attrs, ["gen_ai.tool.name"]),
		toolArgs: truncateMiddle(readString(attrs, ["gen_ai.tool.call.arguments"]), 400),
		error: readString(attrs, [
			"exception.message",
			"error.message",
			"gen_ai.error.message",
		]) || span.StatusCode,
		children: (span.children || []).map(summarizeSpan),
	};
}

function collectSpanIds(span: TraceHeirarchySpan): string[] {
	return [
		span.SpanId,
		...(span.children || []).flatMap((child) => collectSpanIds(child)),
	].filter(Boolean);
}

function getTraceImprovementSystemPrompt() {
	return `You are analyzing a single OpenTelemetry trace from an LLM application. Produce a structured post-mortem with findings grouped into six dimensions: strengths, improvements, wrong_turns, cost, token_efficiency, path_analysis.

Each finding belongs to exactly one dimension; pick the most specific bucket. For example, redundant retrieval belongs in token_efficiency, not improvements. Cite span IDs in span_refs for every finding. Be specific and concrete; vague findings like "could be optimized" are not acceptable.

Keep each finding concise. The summary is the two-line visible takeaway. The detail is the expandable explanation and must start with a short gist before adding evidence.

Determinism requirements:
- Treat the supplied distilled trace as the only source of truth.
- Use the same evidence-to-dimension mapping every time. Do not invent alternate interpretations when the same spans and metrics are supplied.
- Prefer repeatable, span-grounded findings over novel but weak observations.
- A finding requires concrete evidence from span ids, cost, token counts, duration, status, prompt/response shape, tool calls, or parent-child path.
- If evidence is borderline, omit the finding instead of speculating.
- Creative analysis means precise, non-generic fixes tied to the trace evidence; it does not mean changing the core diagnosis between runs.
- Do not change severity unless the underlying evidence clearly supports it.
- Keep cost findings about spend/model choice; keep token_efficiency about waste/duplication/context bloat; keep wrong_turns about rework, retries, or off-task decisions; keep path_analysis about routing/tool/path quality.

Output strict JSON only, with no markdown fences and no commentary, matching this schema:

${TRACE_ANALYSIS_SCHEMA}

Rules for suggested_fix_patches:
- Include ONLY when the fix is a concrete text substitution in a span's prompt, response, or system field.
- "original" must be an exact verbatim substring copied from the span's field as shown in the trace data. Keep it under 250 chars; if the target text is longer, quote only the specific phrase that needs changing.
- "replacement" is what that substring should become. Keep under 250 chars.
- Omit suggested_fix_patches entirely for architectural fixes (change model, add caching, restructure tool chain, fix latency, add retry logic, etc.).
- Do not invent text that is not present in the trace data.

If a dimension is healthy or has no meaningful issue, return an empty array for that dimension. Do not invent problems. A finding belongs in one bucket only.`;
}

function buildUserPrompt(spanId: string, summary: ImprovementSpanSummary) {
	return `Analyze this distilled OpenLIT trace hierarchy.

Source span id: ${spanId}

Stability instructions:
- Build findings from the concrete fields in the tree below.
- Use the same span ids as anchors for the same issues across reruns.
- Do not add a finding unless it can cite at least one span id.
- If there is no issue in a dimension, return an empty array for that dimension.
- Make suggested_fix specific to the cited spans and observed metric/prompt/tool behavior.

Distilled trace hierarchy:
\`\`\`json
${JSON.stringify(summary, null, 2)}
\`\`\`

Return strict JSON matching TraceAnalysis.`;
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
		totalTokens += readNumber(attrs, "gen_ai.usage.total_tokens") || 0;
		totalCost += span.Cost || readNumber(attrs, "gen_ai.usage.cost") || 0;
		durationMs += Number.isFinite(span.Duration) ? span.Duration / 1e6 : 0;
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

function parseTraceAnalysis(rawText: string, traceId: string, root: TraceHeirarchySpan): TraceAnalysis {
	const jsonText = rawText
		.trim()
		.replace(/^```json\s*/i, "")
		.replace(/^```\s*/i, "")
		.replace(/```$/i, "")
		.trim();
	let parsed: any;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		parsed = emptyTraceAnalysis(traceId);
		parsed.summary = "The analysis model did not return valid structured JSON. Rerun the analysis or inspect the raw trace.";
		parsed.improvements = [{
			id: stableFindingId({ span_refs: [root.SpanId], summary: "Structured analysis could not be parsed" }, "improvements"),
			severity: "minor",
			summary: "Structured analysis could not be parsed",
			detail: "The model response was not valid JSON, so OpenLIT could not build dimension-specific findings.",
			span_refs: [root.SpanId],
			suggested_fix: "Rerun the analysis. If this persists, tighten the trace-analysis model configuration.",
		}];
	}

	const totals = calculateTotals(root);
	const analysis: TraceAnalysis = {
		...emptyTraceAnalysis(traceId),
		...parsed,
		trace_id: parsed?.trace_id || traceId,
		summary: parsed?.summary || "Trace analysis completed.",
		totals: {
			...totals,
			...(parsed?.totals || {}),
		},
	};

	for (const dimension of TRACE_ANALYSIS_DIMENSIONS) {
		const findings = Array.isArray((analysis as any)[dimension])
			? (analysis as any)[dimension]
			: [];
		(analysis as any)[dimension] = findings.map((finding: any) => ({
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
		}));
	}

	return analysis;
}

export async function getTraceImprovement(
	spanId: string,
	databaseConfigId?: string
): Promise<{ data?: { rootSpanId: string; runs: TraceAnalysisRun[] }; err?: unknown }> {
	const { record, err } = await getHeirarchyViaSpanId(spanId);
	const hierarchyRecord = record as TraceHeirarchySpan | undefined;
	if (err || !hierarchyRecord?.SpanId) {
		return { err: err || "Trace hierarchy not found" };
	}

	const rootSpanId = hierarchyRecord.SpanId;

	const { data: runs, err: runsErr } = await getTraceAnalysisRuns(rootSpanId, databaseConfigId);

	if (!runsErr && runs && runs.length > 0) {
		return { data: { rootSpanId, runs } };
	}
	// If the new table doesn't exist yet (migration pending) or is empty, fall through to legacy

	// Legacy fallback: old conversation-based storage
	const legacy = await getImprovementConversationByHierarchySpanIds(
		rootSpanId,
		collectSpanIds(hierarchyRecord),
		databaseConfigId
	);

	if (legacy.err) return { err: legacy.err };

	if (legacy.data) {
		const legacyRuns: TraceAnalysisRun[] = legacy.data.messages
			.filter((m) => m.role === "assistant")
			.map((m, index) => ({
				id: m.id || `legacy-${index}`,
				rootSpanId,
				selectedSpanId: rootSpanId,
				runNumber: index + 1,
				analysisJson: m.queryResult || "{}",
				summary: "",
				modelProvider: legacy.data!.conversation.provider,
				modelName: legacy.data!.conversation.model,
				promptTokens: m.promptTokens || 0,
				completionTokens: m.completionTokens || 0,
				cost: m.cost || 0,
				worstSeverity: "",
				createdAt: m.createdAt,
			}));
		return { data: { rootSpanId, runs: legacyRuns } };
	}

	return { data: { rootSpanId, runs: [] } };
}

function createStreamEvent(
	controller: ReadableStreamDefaultController<Uint8Array>,
	encoder: TextEncoder,
	event: Record<string, unknown>
) {
	controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

export async function streamTraceImprovementAnalysis(
	spanId: string,
	databaseConfigId?: string
) {
	const { data: config, err: configErr } =
		await getChatConfigWithApiKey(databaseConfigId);
	if (configErr || !config) {
		return {
			err:
				configErr ||
				"Chat not configured. Please set up your AI provider in Chat Settings.",
		};
	}

	const { record, err: hierarchyErr } = await getHeirarchyViaSpanId(spanId);
	const hierarchyRecord = record as TraceHeirarchySpan | undefined;
	if (hierarchyErr || !hierarchyRecord?.SpanId) {
		return { err: hierarchyErr || "Trace hierarchy not found" };
	}

	const rootSpanId = hierarchyRecord.SpanId;
	const { data: existingRuns } = await getTraceAnalysisRuns(rootSpanId, databaseConfigId);
	const runNumber = (existingRuns?.length || 0) + 1;

	const summary = summarizeSpan(hierarchyRecord);
	const userPrompt = buildUserPrompt(spanId, summary);
	const modelInstance = getModelInstance(config.provider, config.apiKey, config.model);
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let responseText = "";
			let finishStats = { promptTokens: 0, completionTokens: 0, cost: 0 };

			try {
				const traceId =
					(hierarchyRecord as any).traceId || (hierarchyRecord as any).TraceId || rootSpanId;
				createStreamEvent(controller, encoder, {
					type: "step",
					status: "complete",
					label: "Loaded trace hierarchy",
					detail: `Root span ${rootSpanId}`,
				});
				createStreamEvent(controller, encoder, {
					type: "step",
					status: "complete",
					label: "Extracted prompt, response, tokens, cost, and tool steps",
				});
				createStreamEvent(controller, encoder, {
					type: "step",
					status: "active",
					label: "Otter is analyzing improvement opportunities",
				});

				let finishResolve: () => void;
				const finishPromise = new Promise<void>((resolve) => {
					finishResolve = resolve;
				});

				const result = streamText({
					model: modelInstance,
					system: getTraceImprovementSystemPrompt(),
					prompt: userPrompt,
					maxOutputTokens: 1800,
					temperature: 0,
					onFinish: ({ usage }) => {
						const promptTokens = usage?.inputTokens ?? 0;
						const completionTokens = usage?.outputTokens ?? 0;
						finishStats = {
							promptTokens,
							completionTokens,
							cost: estimateCost(promptTokens, completionTokens),
						};
						finishResolve!();
					},
				});

				for await (const part of result.fullStream) {
					if (part.type === "text-delta" && (part as any).text) {
						const text = (part as any).text as string;
						responseText += text;
						createStreamEvent(controller, encoder, { type: "delta", text });
					}
				}

				await Promise.race([
					finishPromise,
					new Promise((resolve) => setTimeout(resolve, 5000)),
				]);

				const analysis = parseTraceAnalysis(responseText, traceId, hierarchyRecord);

				createStreamEvent(controller, encoder, {
					type: "step",
					status: "complete",
					label: "Otter is analyzing improvement opportunities",
				});
				for (const dimension of TRACE_ANALYSIS_DIMENSIONS) {
					createStreamEvent(controller, encoder, {
						type: "dimension",
						dimension,
						findings: analysis[dimension],
					});
				}
				createStreamEvent(controller, encoder, {
					type: "step",
					status: "active",
					label: "Saving improvement analysis",
				});

				const { data: savedRun, err: saveErr } = await saveTraceAnalysisRun(
					{
						rootSpanId,
						selectedSpanId: spanId,
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
