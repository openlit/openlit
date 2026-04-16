import getMessage from "@/constants/messages";
import { getCurrentUser } from "@/lib/session";
import { throwIfError } from "@/utils/error";
import { dataCollector, OTEL_TRACES_TABLE_NAME } from "@/lib/platform/common";
import { getTraceMappingKeyFullPath } from "@/helpers/server/trace";
import { SUPPORTED_EVALUATION_OPERATIONS } from "@/constants/traces";
import { getDBConfigById } from "@/lib/db-config";
import { getRequestViaSpanId } from "@/lib/platform/request";
import { ProviderRegistry } from "@/lib/platform/providers/provider-registry";
import { getPricingConfigById } from "./config";
import { getLastRunCronLogByCronId, insertCronLog } from "@/lib/platform/cron-log";
import { CronRunStatus, CronType } from "@/types/cron";
import { differenceInSeconds } from "date-fns";
import Sanitizer from "@/utils/sanitizer";
import asaw from "@/utils/asaw";

const COST_KEY = getTraceMappingKeyFullPath("cost") as string; // gen_ai.usage.cost
const MODEL_KEY = getTraceMappingKeyFullPath("model") as string; // gen_ai.request.model
const PROVIDER_KEY = getTraceMappingKeyFullPath("provider") as string; // gen_ai.system
const PROMPT_TOKENS_KEY = getTraceMappingKeyFullPath("promptTokens") as string; // gen_ai.usage.input_tokens
const COMPLETION_TOKENS_KEY = getTraceMappingKeyFullPath("completionTokens") as string; // gen_ai.usage.output_tokens
const TYPE_KEY = getTraceMappingKeyFullPath("type") as string; // gen_ai.operation.name

interface TraceRow {
	SpanId: string;
	Timestamp: string;
	SpanAttributes: Record<string, string>;
}

function getAttr(trace: TraceRow, key: string): string {
	return (trace.SpanAttributes || {})[key] ?? "";
}

/**
 * Compute the cost for a single trace by looking up the model in
 * openlit_provider_models and applying token-based pricing.
 * Returns null if pricing can't be determined (missing model/tokens).
 */
async function computeCostForTrace(
	trace: TraceRow,
	databaseConfigId: string
): Promise<{ cost: number | null; reason?: string }> {
	const provider = getAttr(trace, PROVIDER_KEY);
	const model = getAttr(trace, MODEL_KEY);
	const promptTokens = Number(getAttr(trace, PROMPT_TOKENS_KEY)) || 0;
	const completionTokens = Number(getAttr(trace, COMPLETION_TOKENS_KEY)) || 0;

	const allKeys = Object.keys(trace.SpanAttributes || {});
	const genAiKeys = allKeys.filter((k) => k.startsWith("gen_ai"));

	if (!provider || !model) {
		const reason = `Missing ${!provider ? "provider" : ""}${
			!provider && !model ? " and " : ""
		}${!model ? "model" : ""} attribute on the trace (provider='${provider}', model='${model}')`;
		return { cost: null, reason };
	}
	if (promptTokens === 0 && completionTokens === 0) {
		const reason = `Trace has zero tokens (prompt=${promptTokens}, completion=${completionTokens})`;
		return { cost: null, reason };
	}

	const modelMeta = await ProviderRegistry.getModel(
		provider,
		model,
		databaseConfigId
	);
	if (!modelMeta) {
		const reason = `Model '${model}' not found under provider '${provider}' in openlit_provider_models. Add it in Manage Models.`;
		return { cost: null, reason };
	}

	const inputCost = (promptTokens / 1_000_000) * modelMeta.inputPricePerMToken;
	const outputCost =
		(completionTokens / 1_000_000) * modelMeta.outputPricePerMToken;

	return { cost: inputCost + outputCost };
}

/**
 * Update the gen_ai.usage.cost attribute on a specific span in otel_traces.
 * Uses ClickHouse's mapUpdate (adds/replaces a key in a Map column).
 */
async function writeCostToTrace(
	spanId: string,
	cost: number,
	databaseConfigId: string
): Promise<{ err?: string }> {
	const sanitizedSpanId = Sanitizer.sanitizeValue(spanId);
	// toString keeps the attribute format consistent with how SDKs write it
	const costString = cost.toFixed(10);
	const query = `
		ALTER TABLE ${OTEL_TRACES_TABLE_NAME}
		UPDATE SpanAttributes = mapUpdate(SpanAttributes, map('${COST_KEY}', '${costString}'))
		WHERE SpanId = '${sanitizedSpanId}'
	`;

	const { err } = await dataCollector({ query }, "exec", databaseConfigId);
	return { err: err as string | undefined };
}

/**
 * Manually recalculate + persist cost for a single span.
 * Exposed via POST /api/pricing/[spanId].
 */
export async function setPricingForSpanId(spanId: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const sanitizedSpanId = Sanitizer.sanitizeValue(spanId);
	const { record: spanData, err: traceErr } = await getRequestViaSpanId(
		sanitizedSpanId
	);
	throwIfError(!!traceErr, getMessage().TRACE_NOT_FOUND);
	throwIfError(
		!(spanData as any)?.SpanId,
		getMessage().TRACE_NOT_FOUND
	);

	const trace = spanData as TraceRow;

	// The trace itself doesn't tell us the dbConfig; fall back to the default
	const { default: prisma } = await import("@/lib/prisma");
	const pricingConfig = await prisma.pricingConfigs.findFirst();
	const dbConfigId =
		pricingConfig?.databaseConfigId ||
		(await (async () => {
			const { getDBConfigByUser } = await import("@/lib/db-config");
			const [, dbc] = await asaw(getDBConfigByUser(true));
			return dbc?.id;
		})());

	if (!dbConfigId) {
		return { success: false, err: getMessage().DATABASE_CONFIG_NOT_FOUND };
	}

	const { cost, reason } = await computeCostForTrace(trace, dbConfigId);
	if (cost === null) {
		return {
			success: false,
			err:
				reason ||
				"Could not compute cost — missing provider/model/tokens or model not in openlit_provider_models",
		};
	}

	const { err } = await writeCostToTrace(trace.SpanId, cost, dbConfigId);
	if (err) return { success: false, err };

	return { success: true, data: { spanId: trace.SpanId, cost } };
}

interface AutoPricingPayload {
	pricingConfigId: string;
	cronId: string;
}

/**
 * Auto pricing: fetch traces in the window since last cron run and
 * recompute + persist cost for each. Called by the /api/pricing/auto cron.
 */
export async function autoUpdatePricing(payload: AutoPricingPayload) {
	const startedAt = new Date();
	const cronLogObject = {
		cronId: payload.cronId,
		cronType: CronType.SPAN_PRICING,
		metaProperties: { ...payload },
		startedAt,
	};

	const pricingConfig = await getPricingConfigById(payload.pricingConfigId);
	if (!pricingConfig) {
		return { success: false, err: "Pricing config not found" };
	}

	const [dbConfigErr, dbConfig] = await asaw(
		getDBConfigById({ id: pricingConfig.databaseConfigId })
	);

	if (dbConfigErr || !dbConfig?.id) {
		return { success: false, err: getMessage().DATABASE_CONFIG_NOT_FOUND };
	}

	const lastRunTime = await getLastRunCronLogByCronId(payload.cronId);

	// Only LLM-type spans with tokens recorded
	const typeKeyPath = `SpanAttributes['${TYPE_KEY}']`;
	const operationList = SUPPORTED_EVALUATION_OPERATIONS.map(
		(op) => `'${op}'`
	).join(", ");

	const query = `
		SELECT SpanId, Timestamp, SpanAttributes
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${typeKeyPath} IN (${operationList})
		${
			lastRunTime
				? `AND Timestamp >= parseDateTimeBestEffort('${lastRunTime}')`
				: ""
		}
		ORDER BY Timestamp
	`;

	const { data, err } = await dataCollector({ query }, "query", dbConfig.id);

	if (err) {
		const finishedAt = new Date();
		await insertCronLog(
			{
				...cronLogObject,
				runStatus: CronRunStatus.FAILURE,
				errorStacktrace: {
					error: `${getMessage().TRACE_FETCHING_ERROR} : ${err}`,
				},
				finishedAt,
				duration: differenceInSeconds(finishedAt, startedAt),
			},
			dbConfig.id
		);
		return { success: false, err: err as string };
	}

	const traces = (data as TraceRow[]) || [];
	let errorCount = 0;
	let updatedCount = 0;
	const errorObject: Record<string, string> = {};

	// Run sequentially to avoid hammering ClickHouse with many ALTER mutations
	for (const trace of traces) {
		try {
			const { cost } = await computeCostForTrace(trace, dbConfig.id);
			if (cost === null) {
				// Skip traces we can't price (no counting as error)
				continue;
			}
			const { err: writeErr } = await writeCostToTrace(
				trace.SpanId,
				cost,
				dbConfig.id
			);
			if (writeErr) {
				errorCount++;
				errorObject[trace.SpanId] = writeErr;
			} else {
				updatedCount++;
			}
		} catch (e: any) {
			errorCount++;
			errorObject[trace.SpanId] = e.message || String(e);
		}
	}

	const finishedAt = new Date();
	const totalProcessed = updatedCount + errorCount;
	const runStatus =
		totalProcessed === 0
			? CronRunStatus.SUCCESS
			: errorCount === 0
				? CronRunStatus.SUCCESS
				: errorCount === totalProcessed
					? CronRunStatus.FAILURE
					: CronRunStatus.PARTIAL_SUCCESS;

	const { err: cronLogErr } = await insertCronLog(
		{
			...cronLogObject,
			runStatus,
			errorStacktrace: errorObject,
			meta: {
				totalSpans: traces.length,
				totalUpdated: updatedCount,
				totalFailed: errorCount,
				totalSkipped: traces.length - totalProcessed,
			},
			finishedAt,
			duration: differenceInSeconds(finishedAt, startedAt),
		},
		dbConfig.id
	);

	return { success: true, err: cronLogErr };
}
