import getMessage from "@/constants/messages";
import { getCurrentUser } from "@/lib/session";
import { throwIfError } from "@/utils/error";
import Sanitizer from "@/utils/sanitizer";
import { dataCollector, MetricParams, OTEL_TRACES_TABLE_NAME } from "../common";
import { OPENLIT_EVALUATION_TABLE_NAME } from "./table-details";
import { runEvaluation } from "./run-evaluation";
import { getEvaluationConfig, getEvaluationConfigById } from "./config";
import asaw from "@/utils/asaw";
import { evaluateRules } from "@/lib/platform/rule-engine/evaluate";
import {
	AutoEvaluationConfig,
	Evaluation,
	EvaluationConfig,
	EvaluationConfigWithSecret,
	EvaluationResponse,
} from "@/types/evaluation";
import { consoleLog } from "@/utils/log";
import { getTraceSpanRecord } from "../traces/read";
import { getTraceMappingKeyFullPath } from "@/helpers/server/trace";
import {
	getContextFromRuleEngineForTrace,
	getContextFromRulesWithPriority,
} from "./rule-engine-context";
import { TraceRow } from "@/types/trace";
import { get } from "lodash";
import { getDBConfigById } from "@/lib/db-config";
import { SUPPORTED_EVALUATION_OPERATIONS } from "@/constants/traces";
import {
	AUTO_EVALUATION_HANDLED_SOURCES,
	EVALUATION_SOURCE,
} from "@/constants/evaluation-sources";
import { DEFAULT_EVAL_SAMPLE_RATE } from "@/constants/evaluation-sampling";
import { jsonParse } from "@/utils/json";
import {
	normalizeEvalSampleRate,
	shouldAutoEvaluateSpan,
} from "./sampling";
import {
	getLastRunCronLogByCronId,
	getLastFailureCronLogBySpanId,
	insertCronLog,
} from "@/lib/platform/cron-log";
import { CronType, CronRunStatus, CronLogData } from "@/types/cron";
import { differenceInSeconds } from "date-fns";
import { getFilterPreviousParams } from "@/helpers/server/platform";

/** Approximate cost per 1K tokens (USD) for common models. Fallback for evaluation cost. */
const EVAL_COST_PER_1K: Record<string, { prompt: number; completion: number }> = {
	"gpt-4o": { prompt: 0.0025, completion: 0.01 },
	"gpt-4o-mini": { prompt: 0.00015, completion: 0.0006 },
	"gpt-4": { prompt: 0.03, completion: 0.06 },
	"gpt-4-turbo": { prompt: 0.01, completion: 0.03 },
	"gpt-3.5-turbo": { prompt: 0.0005, completion: 0.0015 },
	"claude-3-5-sonnet": { prompt: 0.003, completion: 0.015 },
	"claude-3-haiku": { prompt: 0.00025, completion: 0.00125 },
	"claude-3-opus": { prompt: 0.015, completion: 0.075 },
};

function estimateEvaluationCost(
	model: string,
	promptTokens: number,
	completionTokens: number
): number {
	const modelKey = Object.keys(EVAL_COST_PER_1K).find(
		(k) => model.toLowerCase().includes(k) || k.includes(model.toLowerCase())
	);
	const rates = modelKey ? EVAL_COST_PER_1K[modelKey] : { prompt: 0.001, completion: 0.002 };
	return (
		(promptTokens / 1000) * rates.prompt +
		(completionTokens / 1000) * rates.completion
	);
}

/** Span ids already handled by auto-eval (evaluated or sampling-skipped). */
async function loadAutoHandledSpanIds(
	databaseConfigId: string
): Promise<Set<string>> {
	const autoHandledSources = AUTO_EVALUATION_HANDLED_SOURCES.map(
		(source) => `'${source}'`
	).join(", ");
	const query = `
		SELECT DISTINCT span_id
		FROM ${OPENLIT_EVALUATION_TABLE_NAME}
		WHERE meta['source'] IN (${autoHandledSources})
	`;
	const { data, err } = await dataCollector(
		{ query },
		"query",
		databaseConfigId
	);
	if (err) return new Set();
	return new Set(
		((data as { span_id?: string }[]) || [])
			.map((r) => r.span_id)
			.filter((id): id is string => !!id)
	);
}

/**
 * Candidate spans for auto-evaluation. Built-in ClickHouse keeps the
 * historical JOIN against otel_traces; external sources list via the
 * traces adapter and exclude already-handled ids from the app-store eval table.
 */
async function fetchAutoEvalCandidateSpans({
	databaseConfigId,
	lastRunTime,
}: {
	databaseConfigId: string;
	lastRunTime?: string | Date | null;
}): Promise<{ data: TraceRow[]; err?: string }> {
	const keyPath = `SpanAttributes['${getTraceMappingKeyFullPath("type")}']`;
	const autoHandledSources = AUTO_EVALUATION_HANDLED_SOURCES.map(
		(source) => `'${source}'`
	).join(", ");
	const lastRunIso =
		lastRunTime instanceof Date
			? lastRunTime.toISOString()
			: lastRunTime || null;

	try {
		const { getTelemetryAdapterForDbConfig } = await import(
			"@/lib/telemetry-source"
		);
		const { denormalizeSpanToTraceRow } = await import(
			"@/lib/platform/datasource/clickhouse/normalize"
		);
		const resolved = await getTelemetryAdapterForDbConfig(
			databaseConfigId,
			"traces"
		);
		if (!resolved.isBuiltIn) {
			const end = new Date();
			const start = lastRunIso
				? new Date(lastRunIso)
				: new Date(end.getTime() - 24 * 60 * 60 * 1000);
			const handled = await loadAutoHandledSpanIds(databaseConfigId);
			const frame = await resolved.adapter.listSpans({
				signal: "traces",
				timeRange: { start, end },
				aiSelector: true,
				limit: 500,
				filters: [
					{
						target: "attribute",
						scope: "span",
						key: "gen_ai.operation.name",
						op: "in",
						value: [...SUPPORTED_EVALUATION_OPERATIONS],
					},
				],
			});
			const rows = frame.rows
				.filter((span) => !handled.has(span.spanId))
				.map(
					(span) =>
						denormalizeSpanToTraceRow(span) as unknown as TraceRow
				);
			return { data: rows };
		}
	} catch (err) {
		consoleLog(
			`fetchAutoEvalCandidateSpans: external path failed (${String(
				(err as Error)?.message || err
			)}); trying ClickHouse`
		);
	}

	const query = `
		SELECT t.*
		FROM ${OTEL_TRACES_TABLE_NAME} AS t
		LEFT JOIN (
			SELECT span_id FROM ${OPENLIT_EVALUATION_TABLE_NAME}
			WHERE meta['source'] IN (${autoHandledSources})
		) AS e ON t.SpanId = e.span_id
		WHERE ${keyPath} IN (${SUPPORTED_EVALUATION_OPERATIONS.map(
		(operation) => `'${operation}'`
	).join(", ")})
		AND (e.span_id = '' OR e.span_id IS NULL)
		${
			lastRunIso
				? `AND t.Timestamp >= parseDateTimeBestEffort('${lastRunIso}')`
				: ""
		}
		ORDER BY t.Timestamp;
	`;

	const { data, err } = await dataCollector(
		{ query },
		"query",
		databaseConfigId
	);
	if (err) return { data: [], err: String(err) };
	return { data: (data as TraceRow[]) || [] };
}

export async function getEvaluationSummaryForSpanId(spanId: string) {
	const user = await getCurrentUser();
	if (!user) return null;
	const sanitizedSpanId = Sanitizer.sanitizeValue(spanId);

	const query = `
		SELECT 
			count() as runCount,
			sum(toFloat64OrZero(meta['cost'])) as totalCost,
			argMax(meta['model'], created_at) as latestModel
		FROM ${OPENLIT_EVALUATION_TABLE_NAME}
		WHERE span_id = '${sanitizedSpanId}' AND meta['source'] NOT IN ('${EVALUATION_SOURCE.MANUAL_FEEDBACK}', '${EVALUATION_SOURCE.AUTO_SKIPPED}');
	`;

	const { data, err } = await dataCollector({ query });
	if (err || !(data as any[])?.[0]) return null;

	const row = (data as any[])[0];
	return {
		runCount: Number(row?.runCount) || 0,
		totalCost: Number(row?.totalCost) || 0,
		latestModel: row?.latestModel || undefined,
	};
}

export async function getEvaluationsForSpanId(spanId: string) {
	const user = await getCurrentUser();

	throwIfError(!user, getMessage().UNAUTHORIZED_USER);
	const sanitizedSpanId = Sanitizer.sanitizeValue(spanId);

	const query = `
		SELECT 
			span_id as spanId,
			created_at as createdAt,
			id,
			meta,
			arrayMap(
					(e, c, ex, v) -> 
					map('evaluation', e, 'score', if(mapContains(scores, e), toString(scores[e]), toString(0.0)), 'classification', c, 'explanation', ex, 'verdict', v),
					evaluationData.evaluation,
					evaluationData.classification,
					evaluationData.explanation,
					evaluationData.verdict
			) AS evaluations
		FROM ${OPENLIT_EVALUATION_TABLE_NAME}
		WHERE spanId = '${sanitizedSpanId}'
		ORDER BY created_at;
	`;

	const { data, err } = await dataCollector({ query });

	if (err) {
		return { err };
	}

	const allRows = (data as any[]) || [];
	const feedbackRows = allRows.filter(
		(r: any) => r?.meta?.source === EVALUATION_SOURCE.MANUAL_FEEDBACK
	);
	const aiEvalRows = allRows.filter(
		(r: any) =>
			r?.meta?.source !== EVALUATION_SOURCE.MANUAL_FEEDBACK &&
			r?.meta?.source !== EVALUATION_SOURCE.AUTO_SKIPPED
	);
	const feedbacks: Array<{
		createdAt: Date;
		rating: "positive" | "negative" | "neutral";
		comment?: string;
	}> = feedbackRows.map((r: any) => ({
		createdAt: r.createdAt,
		rating:
			(r?.meta?.feedback_rating as "positive" | "negative" | "neutral") ||
			"neutral",
		comment: r?.meta?.feedback_comment || undefined,
	}));

	if (!allRows.length) {
		const [evaluationConfigErr, evaluationConfig] = await asaw(
			getEvaluationConfig()
		);
		const evaluationConfigTyped = evaluationConfig as EvaluationConfig;
		if (evaluationConfigErr) {
			return { configErr: evaluationConfigErr };
		}
		if (!evaluationConfigTyped?.id) {
			return { configErr: getMessage().EVALUATION_CONFIG_NOT_FOUND };
		}

		const { data: lastFailureCronLog } = await getLastFailureCronLogBySpanId(
			spanId
		);

		const errorMessage =
			(lastFailureCronLog as CronLogData[])?.[0]?.errorStacktrace?.[spanId] ||
			"";

		if (errorMessage) {
			return { err: errorMessage };
		}

		// Include rule context that would be applied (for UI to show before running)
		const { record: traceRecord } = await getTraceSpanRecord(sanitizedSpanId);
		const trace = traceRecord as TraceRow;
		let ruleContext: {
			matchingRuleIds: string[];
			contextApplied: boolean;
			contextEntityIds?: string[];
		} = {
			matchingRuleIds: [],
			contextApplied: false,
			contextEntityIds: [],
		};
		if (trace?.SpanId) {
			const {
				matchingRuleIds,
				contextEntityIds,
			} = await getContextFromRuleEngineForTrace(
				trace,
				evaluationConfigTyped.databaseConfigId
			);
			ruleContext = {
				matchingRuleIds,
				contextApplied: matchingRuleIds.length > 0,
				contextEntityIds: contextEntityIds || [],
			};
		}
		return {
			config: evaluationConfigTyped.id,
			ruleContext,
			feedbacks,
		};
	}
	const runs: Array<{
		id: string;
		createdAt: Date;
		meta: Record<string, any>;
		evaluations: Evaluation[];
		cost?: number;
	}> = aiEvalRows.map((r: any) => ({
		id: r.id,
		createdAt: r.createdAt,
		meta: r.meta || {},
		evaluations: r.evaluations || [],
		cost: r.meta?.cost ? parseFloat(r.meta.cost) : undefined,
	}));

	const latestData =
		(aiEvalRows as EvaluationResponse[])?.[aiEvalRows.length - 1] || {};

	// Always include config and ruleContext so user can run evaluation again (manual runs allowed anytime)
	const [evaluationConfigErr, evaluationConfig] = await asaw(
		getEvaluationConfig()
	);
	const evaluationConfigTyped = evaluationConfig as EvaluationConfig;
	let ruleContext: {
		matchingRuleIds: string[];
		contextApplied: boolean;
		contextEntityIds?: string[];
	} = {
		matchingRuleIds: [],
		contextApplied: false,
		contextEntityIds: [],
	};
	if (!evaluationConfigErr && evaluationConfigTyped?.id) {
		const { record: traceRecord } = await getTraceSpanRecord(sanitizedSpanId);
		const trace = traceRecord as TraceRow;
		if (trace?.SpanId) {
			const { matchingRuleIds, contextEntityIds } =
				await getContextFromRuleEngineForTrace(
					trace,
					evaluationConfigTyped.databaseConfigId
				);
			ruleContext = {
				matchingRuleIds,
				contextApplied: matchingRuleIds.length > 0,
				contextEntityIds: contextEntityIds || [],
			};
		}
	}

	return {
		data: latestData,
		runs,
		feedbacks,
		config: evaluationConfigTyped?.id,
		ruleContext,
	};
}

function toClickHouseDateTime(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	const h = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

async function storeEvaluation(
	spanId: string,
	evaluation: Evaluation[],
	meta: any,
	dbConfigId?: string
) {
	const now = new Date();
	const createdAt = toClickHouseDateTime(now);
	// Ensure meta values are strings (Map(LowCardinality(String), String))
	const metaStrings =
		meta && typeof meta === "object"
			? Object.fromEntries(
					Object.entries(meta).map(([k, v]) => [k, String(v ?? "")])
				)
			: {};

	const { err } = await dataCollector(
		{
			table: OPENLIT_EVALUATION_TABLE_NAME,
			values: [
				{
					span_id: spanId,
					created_at: createdAt,
					meta: metaStrings,
					"evaluationData.evaluation": evaluation.map((e) => e.evaluation),
					"evaluationData.classification": evaluation.map(
						(e) => e.classification
					),
					"evaluationData.explanation": evaluation.map((e) => e.explanation),
					"evaluationData.verdict": evaluation.map((e) => e.verdict),
					scores: evaluation.reduce((acc: Record<string, number>, e) => {
						acc[e.evaluation] = e.score;
						return acc;
					}, {}),
				},
			],
		},
		"insert",
		dbConfigId
	);
	if (err) {
		consoleLog(err);
		return { err };
	}

	return { data: true };
}

async function storeAutoEvaluationSkip(
	trace: TraceRow,
	sampleRate: number,
	dbConfigId: string
) {
	const serviceName =
		String(
			trace.ServiceName ||
				(trace.ResourceAttributes as Record<string, unknown> | undefined)?.[
					"service.name"
				] ||
				""
		) || "";
	return storeEvaluation(
		trace.SpanId,
		[],
		{
			source: EVALUATION_SOURCE.AUTO_SKIPPED,
			traceTimeStamp: String(trace.Timestamp ?? ""),
			sampleRate: String(sampleRate),
			...(serviceName ? { "service.name": serviceName } : {}),
		},
		dbConfigId
	);
}

export async function storeManualFeedback(
	spanId: string,
	rating: "positive" | "negative" | "neutral",
	comment?: string,
	dbConfigId?: string
) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);
	const sanitizedSpanId = Sanitizer.sanitizeValue(spanId);

	const { record: spanData } = await getTraceSpanRecord(sanitizedSpanId);
	throwIfError(!(spanData as any)?.SpanId, getMessage().TRACE_NOT_FOUND);

	const meta: Record<string, string> = {
		source: "manual_feedback",
		feedback_rating: rating,
		...(comment ? { feedback_comment: comment } : {}),
	};

	const evaluation: Evaluation[] = [
		{
			evaluation: "manual_feedback",
			classification: rating,
			explanation: comment || "",
			verdict: "yes",
			score: rating === "positive" ? 0 : rating === "negative" ? 1 : 0.5,
		},
	];

	const now = new Date();
	const createdAt = toClickHouseDateTime(now);
	const metaStrings =
		meta && typeof meta === "object"
			? Object.fromEntries(
					Object.entries(meta).map(([k, v]) => [k, String(v ?? "")])
				)
			: {};
	const { err } = await dataCollector(
		{
			table: OPENLIT_EVALUATION_TABLE_NAME,
			values: [
				{
					span_id: sanitizedSpanId,
					created_at: createdAt,
					meta: metaStrings,
					"evaluationData.evaluation": evaluation.map((e) => e.evaluation),
					"evaluationData.classification": evaluation.map(
						(e) => e.classification
					),
					"evaluationData.explanation": evaluation.map((e) => e.explanation),
					"evaluationData.verdict": evaluation.map((e) => e.verdict),
					scores: evaluation.reduce(
						(acc: Record<string, number>, e) => {
							acc[e.evaluation] = e.score;
							return acc;
						},
						{}
					),
				},
			],
		},
		"insert",
		dbConfigId
	);

	if (err) {
		consoleLog(err);
		return { err };
	}
	return { data: true };
}

export async function setEvaluationsForSpanId(spanId: string) {
	const user = await getCurrentUser();

	throwIfError(!user, getMessage().UNAUTHORIZED_USER);
	const sanitizedSpanId = Sanitizer.sanitizeValue(spanId);

	const { record: spanData } = await getTraceSpanRecord(sanitizedSpanId);
	const spanDataTyped = spanData as TraceRow;

	throwIfError(!(spanData as any)?.SpanId, getMessage().TRACE_NOT_FOUND);

	const evaluationConfig = await getEvaluationConfig(undefined, false);
	return await getEvaluationConfigForTrace(
		spanDataTyped,
		evaluationConfig,
		undefined,
		"manual"
	);
}

/**
 * Extract prompt/completion for evaluation, attribute-first for portability.
 *
 * The trace-detail chat view reads prompt/completion from span *attributes*
 * (`gen_ai.input.messages` / `gen_ai.output.messages` + legacy variants), but
 * evals historically read them from OTel span *events*
 * (`Events.Attributes[0]['gen_ai.prompt']` / `[1]['gen_ai.completion']`).
 * External observability backends (Datadog, New Relic, ...) do not reliably
 * expose OTel span events, so we prefer span attributes and fall back to
 * events. This also makes evals consistent with what the chat view renders.
 */
export function extractEvalPromptCompletion(trace: unknown): {
	prompt: string;
	response: string;
} {
	const attrs =
		((trace as { SpanAttributes?: Record<string, string> })?.SpanAttributes ||
			{}) as Record<string, string>;
	const firstNonEmpty = (keys: string[]): string => {
		for (const k of keys) {
			const v = attrs[k];
			if (typeof v === "string" && v.trim() !== "") return v;
		}
		return "";
	};
	const promptFromAttr = firstNonEmpty([
		"gen_ai.input.messages",
		"gen_ai.prompt",
		"gen_ai.content.prompt",
		"gen_ai.request.input",
	]);
	const responseFromAttr = firstNonEmpty([
		"gen_ai.output.messages",
		"gen_ai.completion",
		"gen_ai.content.completion",
		"gen_ai.response.output",
	]);
	const promptFromEvent = get(
		trace,
		getTraceMappingKeyFullPath("prompt", true)
	) as string | undefined;
	const responseFromEvent = get(
		trace,
		getTraceMappingKeyFullPath("response", true)
	) as string | undefined;
	return {
		prompt: promptFromAttr || promptFromEvent || "",
		response: responseFromAttr || responseFromEvent || "",
	};
}

async function getEvaluationConfigForTrace(
	trace: TraceRow,
	evaluationConfig: EvaluationConfigWithSecret,
	dbConfigId?: string,
	source: "manual" | "auto" = "auto"
) {
	const { prompt, response } = extractEvalPromptCompletion(trace);

	const dbConfig = dbConfigId ?? evaluationConfig.databaseConfigId;
	const evaluationTypes =
		((evaluationConfig as any).evaluationTypes || []) as Array<{
			id: string;
			enabled: boolean;
			rules?: Array<{ ruleId: string; priority: number }>;
			ruleId?: string;
			priority?: number;
			prompt?: string;
			defaultPrompt?: string;
		}>;

	// Default: Hallucination, Bias, Toxicity enabled
	const enabledTypes =
		evaluationTypes.filter((t) => t.enabled).length > 0
			? evaluationTypes.filter((t) => t.enabled)
			: evaluationTypes.filter(
					(t) =>
						t.id === "hallucination" ||
						t.id === "bias" ||
						t.id === "toxicity"
				).map((t) => ({ ...t, enabled: true }));

	// Collect rules with priority from enabled types
	const rulesWithPriority: Array<{ ruleId: string; priority: number }> = [];
	for (const t of enabledTypes) {
		if (t.rules?.length) {
			rulesWithPriority.push(
				...t.rules.filter((r) => r.ruleId && r.ruleId.trim())
			);
		} else if (t.ruleId) {
			rulesWithPriority.push({
				ruleId: t.ruleId,
				priority: t.priority ?? 0,
			});
		}
	}

	let contextContents: string[];
	let matchingRuleIds: string[];
	let contextEntityIds: string[];
	if (rulesWithPriority.length > 0) {
		const result = await getContextFromRulesWithPriority(
			trace,
			rulesWithPriority,
			dbConfig
		);
		contextContents = result.contextContents;
		matchingRuleIds = result.matchingRuleIds;
		contextEntityIds = result.contextEntityIds || [];
	} else {
		const result = await getContextFromRuleEngineForTrace(trace, dbConfig);
		contextContents = result.contextContents;
		matchingRuleIds = result.matchingRuleIds;
		contextEntityIds = result.contextEntityIds || [];
	}

	// Append prebuilt context for each enabled evaluation type (from DB or custom prompt)
	const prebuiltParts: string[] = [];
	for (const t of enabledTypes) {
		const customPrompt = t.prompt?.trim();
		const defaultPrompt = t.defaultPrompt?.trim();
		const promptToUse = customPrompt || defaultPrompt;
		if (promptToUse) {
			prebuiltParts.push(promptToUse);
		}
	}
	const allContextParts = [...prebuiltParts, ...contextContents];
	const finalContextString =
		allContextParts.length > 0 ? allContextParts.join("\n\n") : "";

	try {
		const data = await runEvaluation({
			provider: evaluationConfig.provider,
			model: evaluationConfig.model,
			apiKey: evaluationConfig.secret.value,
			prompt: prompt ?? "",
			contexts: finalContextString,
			response: response ?? "",
			thresholdScore: 0.5,
		});


		if (!data.success) {
			return { success: false, error: data.error };
		}

		const serviceName =
			String(
				trace.ServiceName ||
					(trace.ResourceAttributes as Record<string, unknown> | undefined)?.[
						"service.name"
					] ||
					""
			) || "";
		const metaBase: Record<string, string> = {
			model: `${evaluationConfig.provider}/${evaluationConfig.model}`,
			traceTimeStamp: String(trace.Timestamp ?? ""),
			ruleIds: matchingRuleIds.join(","),
			contextIds: contextEntityIds.join(","),
			contextApplied: contextContents.length > 0 ? "yes" : "no",
			source,
			...(serviceName ? { "service.name": serviceName } : {}),
		};
		if (data.usage) {
			metaBase.promptTokens = String(data.usage.promptTokens);
			metaBase.completionTokens = String(data.usage.completionTokens);
			const cost = estimateEvaluationCost(
				evaluationConfig.model,
				data.usage.promptTokens,
				data.usage.completionTokens
			);
			if (cost > 0) metaBase.cost = cost.toFixed(8);
		}

		const storeResult = await storeEvaluation(
			trace.SpanId,
			data.result || [],
			metaBase,
			dbConfig
		);
		if (storeResult.err) {
			consoleLog(storeResult.err);
			return { success: false, error: storeResult.err };
		}
		return { success: true };
	} catch (e) {
		consoleLog(e);
		return { success: false, error: e };
	}
}

export async function autoEvaluate(autoEvaluationConfig: AutoEvaluationConfig) {
	const startedAt = new Date();
	const cronLogObject = {
		cronId: autoEvaluationConfig.cronId,
		cronType: CronType.SPAN_EVALUATION,
		metaProperties: {
			...autoEvaluationConfig,
		},
		startedAt,
	};

	// TODO: Verify the cron job request
	const [evaluationConfigErr, evaluationConfig] = await asaw(
		getEvaluationConfigById(autoEvaluationConfig.evaluationConfigId, false)
	);

	if (evaluationConfigErr || !evaluationConfig.id) {
		return { err: getMessage().EVALUATION_CONFIG_NOT_FOUND, success: false };
	}

	const [databaseConfigErr, databaseConfig] = await asaw(
		getDBConfigById({ id: evaluationConfig.databaseConfigId })
	);

	if (databaseConfigErr || !databaseConfig.id) {
		return {
			err: getMessage().DATABASE_CONFIG_NOT_FOUND,
			success: false,
		};
	}

	const lastRunTime = await getLastRunCronLogByCronId(
		autoEvaluationConfig.cronId
	);

	const { data, err } = await fetchAutoEvalCandidateSpans({
		databaseConfigId: databaseConfig.id,
		lastRunTime,
	});

	if (err) {
		const finishedAt = new Date();
		const { err: cronLogErr } = await insertCronLog(
			{
				...cronLogObject,
				runStatus: CronRunStatus.FAILURE,
				errorStacktrace: {
					error: `${getMessage().TRACE_FETCHING_ERROR} : ${err}`,
				},
				finishedAt,
				duration: differenceInSeconds(finishedAt, startedAt),
			},
			databaseConfig.id
		);
		return { err: cronLogErr || err, success: false };
	}

	const traces = data as TraceRow[];
	const configMeta = jsonParse(evaluationConfig.meta || "{}") as Record<
		string,
		unknown
	>;
	const normalizedSampleRate = normalizeEvalSampleRate(
		configMeta.evalSampleRate
	);
	if (Number.isNaN(normalizedSampleRate)) {
		consoleLog(
			`Invalid evalSampleRate in evaluation config meta (${String(configMeta.evalSampleRate)}); defaulting to ${DEFAULT_EVAL_SAMPLE_RATE}`
		);
	}
	const sampleRate = Number.isNaN(normalizedSampleRate)
		? DEFAULT_EVAL_SAMPLE_RATE
		: normalizedSampleRate;

	const sampledTraces: TraceRow[] = [];
	const skippedTraces: TraceRow[] = [];
	for (const trace of traces) {
		if (shouldAutoEvaluateSpan(trace.SpanId, sampleRate)) {
			sampledTraces.push(trace);
		} else if (sampleRate < 1) {
			skippedTraces.push(trace);
		}
	}

	if (skippedTraces.length > 0) {
		const skipResults = await Promise.all(
			skippedTraces.map((trace) =>
				storeAutoEvaluationSkip(trace, sampleRate, databaseConfig.id)
			)
		);
		for (const skipResult of skipResults) {
			if (skipResult.err) {
				consoleLog(skipResult.err);
			}
		}
	}

	let errorCount = 0;

	const results = await Promise.all(
		sampledTraces.map(async (trace) => {
			return await getEvaluationConfigForTrace(
				trace,
				evaluationConfig,
				evaluationConfig.databaseConfigId,
				"auto"
			);
		})
	);

	const errorObject = results.reduce(
		(acc: Record<string, string>, r, index) => {
			if (!r.success) {
				acc[sampledTraces[index].SpanId] = r.error as string;
				errorCount++;
			}
			return acc;
		},
		{}
	);

	const finishedAt = new Date();
	const { err: cronLogErr } = await insertCronLog(
		{
			...cronLogObject,
			runStatus:
				sampledTraces.length > 0 && errorCount === results.length
					? CronRunStatus.FAILURE
					: errorCount > 0
					? CronRunStatus.PARTIAL_SUCCESS
					: CronRunStatus.SUCCESS,
			errorStacktrace: errorObject,
			meta: {
				sampleRate,
				totalSpans: traces.length,
				totalSampled: sampledTraces.length,
				totalSkipped: skippedTraces.length,
				totalEvaluated: results.length - errorCount,
				totalFailed: errorCount,
				spanIds: sampledTraces.map((t) => t.SpanId),
			},
			finishedAt,
			duration: differenceInSeconds(finishedAt, startedAt),
		},
		databaseConfig.id
	);

	return { success: true, err: cronLogErr };
}

export async function getEvaluationDetectedByType(
	params: MetricParams,
	evalType: string
) {
	const currentWhereParams = params;
	const previousWhereParams = getFilterPreviousParams(currentWhereParams);

	const serviceNames = Array.isArray(
		(params.selectedConfig as { serviceNames?: unknown } | undefined)
			?.serviceNames
	)
		? (
				(params.selectedConfig as { serviceNames?: string[] }).serviceNames ||
				[]
			).filter((s): s is string => typeof s === "string" && s.length > 0)
		: [];
	const serviceScopeSql =
		serviceNames.length > 0
			? `AND meta['service.name'] IN (${serviceNames
					.map((s) => `'${Sanitizer.sanitizeValue(s)}'`)
					.join(", ")})`
			: "";

	const commonQuery = (parameters: MetricParams) => `
		SELECT
			COUNT(DISTINCT span_id) AS total_evaluation_detected,
			'${params.timeLimit.start}' as start_date
		FROM ${OPENLIT_EVALUATION_TABLE_NAME} 
		ARRAY JOIN evaluationData
		WHERE 
			evaluationData.evaluation = '${evalType}'
			AND evaluationData.verdict = 'yes'
			AND parseDateTimeBestEffort(meta['traceTimeStamp']) >= parseDateTimeBestEffort('${parameters.timeLimit.start}') 
			AND parseDateTimeBestEffort(meta['traceTimeStamp']) <= parseDateTimeBestEffort('${parameters.timeLimit.end}')
			${serviceScopeSql}
	`;

	const query = `
		SELECT
			CAST(current_data.total_evaluation_detected AS FLOAT) AS total_evaluation_detected,
			CAST(previous_day.total_evaluation_detected AS FLOAT) AS previous_total_evaluation_detected
		FROM
			(
				${commonQuery(currentWhereParams)}
			) as current_data
			JOIN
			(
				${commonQuery(previousWhereParams)}
			) as previous_day
		ON
			current_data.start_date = previous_day.start_date;
	`;

	return dataCollector({ query });
}

export interface OfflineEvaluationInput {
	prompt: string;
	response: string;
	contexts?: string[];
	evalTypes?: string[];
	thresholdScore?: number;
	storeResults?: boolean;
	runId?: string;
	metadata?: Record<string, string>;
	attributes?: Record<string, string | number | boolean>;
}

export interface OfflineEvaluationResult {
	success: boolean;
	evaluations?: Evaluation[];
	contextApplied?: {
		ruleMatched: boolean;
		matchingRuleIds: string[];
		contextEntityIds: string[];
		userContextsCount: number;
	};
	metadata?: Record<string, any>;
	error?: string;
}

export async function runOfflineEvaluation(
	input: OfflineEvaluationInput,
	evaluationConfig: EvaluationConfigWithSecret & { evaluationTypes?: any[] },
	databaseConfigId: string
): Promise<OfflineEvaluationResult> {
	const {
		prompt,
		response,
		contexts: userContexts,
		evalTypes: requestedTypes,
		thresholdScore = 0.5,
		storeResults = true,
		runId,
		metadata: userMetadata,
		attributes,
	} = input;

	const allTypes = ((evaluationConfig as any).evaluationTypes || []) as Array<{
		id: string;
		enabled: boolean;
		label?: string;
		rules?: Array<{ ruleId: string; priority: number }>;
		ruleId?: string;
		priority?: number;
		prompt?: string;
		defaultPrompt?: string;
	}>;

	let enabledTypes = requestedTypes?.length
		? allTypes.filter((t) => requestedTypes.includes(t.id))
		: allTypes.filter((t) => t.enabled);

	if (enabledTypes.length === 0) {
		enabledTypes = allTypes
			.filter((t) => ["hallucination", "bias", "toxicity"].includes(t.id))
			.map((t) => ({ ...t, enabled: true }));
	}

	if (requestedTypes?.length) {
		const allTypeIds = new Set(allTypes.map((t) => t.id));
		const unknown = requestedTypes.filter((id) => !allTypeIds.has(id));
		if (unknown.length > 0) {
			return {
				success: false,
				error: `Unknown eval types: ${unknown.join(", ")}`,
			};
		}
	}

	let contextContents: string[] = [];
	let matchingRuleIds: string[] = [];
	let contextEntityIds: string[] = [];

	if (attributes && Object.keys(attributes).length > 0) {
		try {
			const ruleResult = await evaluateRules(
				{
					fields: attributes,
					entity_type: "context" as any,
					include_entity_data: true,
				},
				databaseConfigId
			);

			matchingRuleIds = ruleResult.matchingRuleIds || [];

			if (ruleResult.entity_data) {
				for (const [key, entityData] of Object.entries(
					ruleResult.entity_data
				)) {
					if (entityData?.content) {
						contextContents.push(String(entityData.content));
						const match = key.match(/^context:(.+)$/);
						if (match) contextEntityIds.push(match[1]);
					}
				}
			}
		} catch (e) {
			consoleLog("Rule engine evaluation failed for offline eval:", e);
		}
	}

	const userContextsCount = userContexts?.length || 0;
	if (userContexts?.length) {
		contextContents.push(...userContexts);
	}

	const prebuiltParts: string[] = [];
	for (const t of enabledTypes) {
		const promptToUse = t.prompt?.trim() || t.defaultPrompt?.trim();
		if (promptToUse) prebuiltParts.push(promptToUse);
	}
	const allContextParts = [...prebuiltParts, ...contextContents];
	const finalContextString =
		allContextParts.length > 0 ? allContextParts.join("\n\n") : "";

	try {
		const data = await runEvaluation({
			provider: evaluationConfig.provider,
			model: evaluationConfig.model,
			apiKey: evaluationConfig.secret.value,
			prompt,
			contexts: finalContextString,
			response,
			thresholdScore,
		});

		if (!data.success) {
			return { success: false, error: data.error };
		}

		const metaBase: Record<string, string> = {
			model: `${evaluationConfig.provider}/${evaluationConfig.model}`,
			ruleIds: matchingRuleIds.join(","),
			contextIds: contextEntityIds.join(","),
			contextApplied: contextContents.length > 0 ? "yes" : "no",
			source: "offline_sdk",
		};
		if (runId) metaBase.runId = runId;
		if (userMetadata) {
			for (const [k, v] of Object.entries(userMetadata)) {
				metaBase[`user_${k}`] = String(v);
			}
		}

		let cost: number | undefined;
		if (data.usage) {
			metaBase.promptTokens = String(data.usage.promptTokens);
			metaBase.completionTokens = String(data.usage.completionTokens);
			cost = estimateEvaluationCost(
				evaluationConfig.model,
				data.usage.promptTokens,
				data.usage.completionTokens
			);
			if (cost > 0) metaBase.cost = cost.toFixed(8);
		}

		if (storeResults) {
			const spanId = `offline_${crypto.randomUUID()}`;
			const storeResult = await storeEvaluation(
				spanId,
				data.result || [],
				metaBase,
				databaseConfigId
			);
			if (storeResult?.err) {
				consoleLog("Failed to store offline eval results:", storeResult.err);
			}
		}

		return {
			success: true,
			evaluations: data.result || [],
			contextApplied: {
				ruleMatched: matchingRuleIds.length > 0,
				matchingRuleIds,
				contextEntityIds,
				userContextsCount,
			},
			metadata: {
				model: `${evaluationConfig.provider}/${evaluationConfig.model}`,
				evalTypesRun: enabledTypes.map((t) => t.id),
				thresholdScore,
				runId: runId || undefined,
				usage: data.usage || undefined,
				cost: cost || undefined,
			},
		};
	} catch (e) {
		consoleLog(e);
		return {
			success: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
