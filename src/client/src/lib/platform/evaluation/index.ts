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
import { getRequestViaSpanId } from "../request";
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
import { ProviderRegistry } from "@/lib/platform/providers/provider-registry";
import {
	resolveEvaluationType,
	type EvaluationTypeRef,
} from "@/helpers/client/evaluation-type";

/**
 * Cost from Manage Models (`openlit_provider_models`) — same source as
 * Pricing / Openground. Returns 0 if the model is not configured.
 */
async function estimateEvaluationCost(
	provider: string,
	model: string,
	promptTokens: number,
	completionTokens: number,
	databaseConfigId: string
): Promise<number> {
	if (!provider || !model || !databaseConfigId) return 0;
	if (promptTokens === 0 && completionTokens === 0) return 0;

	try {
		const modelMeta = await ProviderRegistry.getModel(
			provider,
			model,
			databaseConfigId
		);
		if (!modelMeta) {
			consoleLog(
				`Evaluation cost: model '${model}' not found under provider '${provider}' in Manage Models`
			);
			return 0;
		}

		return (
			(promptTokens / 1_000_000) * modelMeta.inputPricePerMToken +
			(completionTokens / 1_000_000) * modelMeta.outputPricePerMToken
		);
	} catch (e) {
		consoleLog("Evaluation cost lookup failed:", e);
		return 0;
	}
}

/**
 * Remap judge output names to configured type labels when possible so
 * ClickHouse stores canonical names (Hallucination) instead of variants
 * or inventons that still resolve (e.g. "Hallucination evaluation context").
 * Unmapped labels (TypeA) are left as-is and filtered from analytics.
 */
function normalizeEvaluationResults(
	evaluation: Evaluation[],
	customTypes: EvaluationTypeRef[] = []
): Evaluation[] {
	return evaluation.map((item) => {
		const resolved = resolveEvaluationType(item.evaluation, customTypes);
		if (!resolved) return item;
		return { ...item, evaluation: resolved.label };
	});
}

export async function getEvaluationSummaryForSpanId(spanId: string, dbConfigId?: string) {
	if (!dbConfigId) {
		const user = await getCurrentUser();
		if (!user) return null;
	}
	const sanitizedSpanId = Sanitizer.sanitizeValue(spanId);

	const query = `
		SELECT 
			count() as runCount,
			sum(toFloat64OrZero(meta['cost'])) as totalCost,
			argMax(meta['model'], created_at) as latestModel
		FROM ${OPENLIT_EVALUATION_TABLE_NAME}
		WHERE span_id = '${sanitizedSpanId}' AND meta['source'] NOT IN ('${EVALUATION_SOURCE.MANUAL_FEEDBACK}', '${EVALUATION_SOURCE.AUTO_SKIPPED}');
	`;

	const { data, err } = await dataCollector({ query }, "query", dbConfigId);
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
		const { record: traceRecord } = await getRequestViaSpanId(sanitizedSpanId);
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
		const { record: traceRecord } = await getRequestViaSpanId(sanitizedSpanId);
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
	dbConfigId?: string,
	customTypes: EvaluationTypeRef[] = []
) {
	const now = new Date();
	const createdAt = toClickHouseDateTime(now);
	const normalized = normalizeEvaluationResults(evaluation, customTypes);
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
					"evaluationData.evaluation": normalized.map((e) => e.evaluation),
					"evaluationData.classification": normalized.map(
						(e) => e.classification
					),
					"evaluationData.explanation": normalized.map((e) => e.explanation),
					"evaluationData.verdict": normalized.map((e) => e.verdict),
					scores: normalized.reduce((acc: Record<string, number>, e) => {
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
	return storeEvaluation(
		trace.SpanId,
		[],
		{
			source: EVALUATION_SOURCE.AUTO_SKIPPED,
			traceTimeStamp: String(trace.Timestamp ?? ""),
			sampleRate: String(sampleRate),
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

	const { record: spanData } = await getRequestViaSpanId(sanitizedSpanId);
	throwIfError(!(spanData as any).SpanId, getMessage().TRACE_NOT_FOUND);

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

	let { record: spanData } = await getRequestViaSpanId(sanitizedSpanId);
	const spanDataTyped = spanData as TraceRow;

	throwIfError(!(spanData as any).SpanId, getMessage().TRACE_NOT_FOUND);

	const evaluationConfig = await getEvaluationConfig(undefined, false);
	return await getEvaluationConfigForTrace(
		spanDataTyped,
		evaluationConfig,
		undefined,
		"manual"
	);
}

async function getEvaluationConfigForTrace(
	trace: TraceRow,
	evaluationConfig: EvaluationConfigWithSecret,
	dbConfigId?: string,
	source: "manual" | "auto" = "auto"
) {
	const response = get(trace, getTraceMappingKeyFullPath("response", true));
	const prompt = get(trace, getTraceMappingKeyFullPath("prompt", true));

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

		const metaBase: Record<string, string> = {
			model: `${evaluationConfig.provider}/${evaluationConfig.model}`,
			traceTimeStamp: String(trace.Timestamp ?? ""),
			ruleIds: matchingRuleIds.join(","),
			contextIds: contextEntityIds.join(","),
			contextApplied: contextContents.length > 0 ? "yes" : "no",
			source,
		};
		if (data.usage) {
			metaBase.promptTokens = String(data.usage.promptTokens);
			metaBase.completionTokens = String(data.usage.completionTokens);
			const cost = await estimateEvaluationCost(
				evaluationConfig.provider,
				evaluationConfig.model,
				data.usage.promptTokens,
				data.usage.completionTokens,
				dbConfig
			);
			if (cost > 0) metaBase.cost = cost.toFixed(8);
		}

		const storeResult = await storeEvaluation(
			trace.SpanId,
			data.result || [],
			metaBase,
			dbConfig,
			evaluationTypes.map((t) => ({ id: t.id, label: (t as any).label || t.id }))
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

	const keyPath = `SpanAttributes['${getTraceMappingKeyFullPath("type")}']`;

	// Exclude spans already handled by auto evaluation (evaluated or sampling-skipped).
	// Manual feedback does not block auto evaluation. Manual runs are always allowed.
	const autoHandledSources = AUTO_EVALUATION_HANDLED_SOURCES.map(
		(source) => `'${source}'`
	).join(", ");
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
			lastRunTime
				? `AND t.Timestamp >= parseDateTimeBestEffort('${lastRunTime}')`
				: ""
		}
		ORDER BY t.Timestamp;
	`;

	const { data, err } = await dataCollector(
		{ query },
		"query",
		databaseConfig.id
	);

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
			cost = await estimateEvaluationCost(
				evaluationConfig.provider,
				evaluationConfig.model,
				data.usage.promptTokens,
				data.usage.completionTokens,
				databaseConfigId
			);
			if (cost > 0) metaBase.cost = cost.toFixed(8);
		}

		if (storeResults) {
			const spanId = `offline_${crypto.randomUUID()}`;
			const customTypes = allTypes.map((t) => ({
				id: t.id,
				label: (t as any).label || t.id,
			}));
			const storeResult = await storeEvaluation(
				spanId,
				data.result || [],
				metaBase,
				databaseConfigId,
				customTypes
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
