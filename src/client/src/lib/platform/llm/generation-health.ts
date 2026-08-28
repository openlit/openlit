import {
	getFilterPreviousParams,
	getFilterWhereCondition,
} from "@/helpers/server/platform";
import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "../common";
import {
	HAS_BOTH_MODELS_SQL,
	HAS_FINISH_REASON_SQL,
	HAS_LLM_SPAN_SQL,
	HAS_OUTPUT_TOKENS_SQL,
	IS_EMPTY_SQL,
	IS_FILTERED_SQL,
	IS_MODEL_SWAP_SQL,
	IS_TRUNCATED_SQL,
	uniqTraceIfSql,
} from "@/lib/platform/generation-health/sql";
import {
	classifyGenerationHealth,
	GENERATION_HEALTH_SAMPLE_TRACES,
	matchesGenerationHealthChip,
	percentOfEligible,
} from "@/lib/platform/generation-health/classify";
import { UnsupportedCapabilityError } from "@/lib/platform/connectors/datasource/types";

export type GenerationHealthRow = {
	unsupported?: boolean;
	llm_spans: number;
	truncated: number;
	truncated_eligible: number;
	truncated_pct: number;
	filtered: number;
	filtered_eligible: number;
	filtered_pct: number;
	empty: number;
	empty_eligible: number;
	empty_pct: number;
	swapped: number;
	swapped_eligible: number;
	swapped_pct: number;
	previous_truncated: number;
	previous_truncated_eligible: number;
	previous_truncated_pct: number;
	previous_filtered: number;
	previous_filtered_eligible: number;
	previous_filtered_pct: number;
	previous_empty: number;
	previous_empty_eligible: number;
	previous_empty_pct: number;
	previous_swapped: number;
	previous_swapped_eligible: number;
	previous_swapped_pct: number;
};

function asCount(value: unknown): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
}

function metric(count: unknown, eligible: unknown, total: number) {
	const c = asCount(count);
	const e = asCount(eligible);
	return {
		count: c,
		eligible: e,
		skipped: Math.max(total - e, 0),
		pct: percentOfEligible(c, e),
	};
}

function emptyRow(unsupported = false): GenerationHealthRow {
	return {
		unsupported,
		llm_spans: 0,
		truncated: 0,
		truncated_eligible: 0,
		truncated_pct: 0,
		filtered: 0,
		filtered_eligible: 0,
		filtered_pct: 0,
		empty: 0,
		empty_eligible: 0,
		empty_pct: 0,
		swapped: 0,
		swapped_eligible: 0,
		swapped_pct: 0,
		previous_truncated: 0,
		previous_truncated_eligible: 0,
		previous_truncated_pct: 0,
		previous_filtered: 0,
		previous_filtered_eligible: 0,
		previous_filtered_pct: 0,
		previous_empty: 0,
		previous_empty_eligible: 0,
		previous_empty_pct: 0,
		previous_swapped: 0,
		previous_swapped_eligible: 0,
		previous_swapped_pct: 0,
	};
}

function fromQueryRow(
	current: Record<string, unknown> | undefined,
	previous: Record<string, unknown> | undefined
): GenerationHealthRow {
	const llmSpans = asCount(current?.llm_spans);
	const previousSpans = asCount(previous?.llm_spans);
	const truncated = metric(
		current?.truncated,
		current?.finish_eligible,
		llmSpans
	);
	const filtered = metric(
		current?.filtered,
		current?.finish_eligible,
		llmSpans
	);
	const empty = metric(current?.empty, current?.empty_eligible, llmSpans);
	const swapped = metric(current?.swapped, current?.swap_eligible, llmSpans);
	const previousTruncated = metric(
		previous?.truncated,
		previous?.finish_eligible,
		previousSpans
	);
	const previousFiltered = metric(
		previous?.filtered,
		previous?.finish_eligible,
		previousSpans
	);
	const previousEmpty = metric(
		previous?.empty,
		previous?.empty_eligible,
		previousSpans
	);
	const previousSwapped = metric(
		previous?.swapped,
		previous?.swap_eligible,
		previousSpans
	);

	return {
		llm_spans: llmSpans,
		truncated: truncated.count,
		truncated_eligible: truncated.eligible,
		truncated_pct: truncated.pct,
		filtered: filtered.count,
		filtered_eligible: filtered.eligible,
		filtered_pct: filtered.pct,
		empty: empty.count,
		empty_eligible: empty.eligible,
		empty_pct: empty.pct,
		swapped: swapped.count,
		swapped_eligible: swapped.eligible,
		swapped_pct: swapped.pct,
		previous_truncated: previousTruncated.count,
		previous_truncated_eligible: previousTruncated.eligible,
		previous_truncated_pct: previousTruncated.pct,
		previous_filtered: previousFiltered.count,
		previous_filtered_eligible: previousFiltered.eligible,
		previous_filtered_pct: previousFiltered.pct,
		previous_empty: previousEmpty.count,
		previous_empty_eligible: previousEmpty.eligible,
		previous_empty_pct: previousEmpty.pct,
		previous_swapped: previousSwapped.count,
		previous_swapped_eligible: previousSwapped.eligible,
		previous_swapped_pct: previousSwapped.pct,
	};
}

function healthAttrs(span: {
	spanAttributes?: Record<string, unknown>;
	resourceAttributes?: Record<string, unknown>;
}): Record<string, unknown> {
	return {
		...(span.resourceAttributes || {}),
		...(span.spanAttributes || {}),
	};
}

function isLlmSpan(attrs: Record<string, unknown> | undefined): boolean {
	if (!attrs) return false;
	const health = classifyGenerationHealth(attrs);
	return (
		health.hasFinishReason ||
		health.hasBothModels ||
		health.hasOutputTokens ||
		Boolean(attrs["gen_ai.request.model"]) ||
		Boolean(attrs["gen_ai.operation.name"])
	);
}

function traceGroupKey(
	span: { traceId?: string },
	index: number
): string {
	const id = String(span.traceId || "").trim();
	return id || `span:${index}`;
}

export function summarizeGenerationHealthFromSpans(
	spans: Array<{
		traceId?: string;
		spanAttributes?: Record<string, unknown>;
		resourceAttributes?: Record<string, unknown>;
	}>
): GenerationHealthRow {
	const grouped = new Map<string, typeof spans>();
	spans.forEach((span, index) => {
		const key = traceGroupKey(span, index);
		const group = grouped.get(key);
		if (group) group.push(span);
		else grouped.set(key, [span]);
	});

	let truncated = 0;
	let filtered = 0;
	let empty = 0;
	let swapped = 0;
	let finishEligible = 0;
	let emptyEligible = 0;
	let swapEligible = 0;
	let llmTraces = 0;
	for (const group of Array.from(grouped.values())) {
		const llm = group.filter((span) => isLlmSpan(healthAttrs(span)));
		if (!llm.length) continue;
		llmTraces += 1;
		const healths = llm.map((span) =>
			classifyGenerationHealth(healthAttrs(span))
		);
		if (healths.some((health) => health.hasFinishReason)) finishEligible += 1;
		if (healths.some((health) => health.hasOutputTokens)) emptyEligible += 1;
		if (healths.some((health) => health.hasBothModels)) swapEligible += 1;
		if (healths.some((health) => matchesGenerationHealthChip(health, "truncated"))) {
			truncated += 1;
		}
		if (healths.some((health) => matchesGenerationHealthChip(health, "filtered"))) {
			filtered += 1;
		}
		if (healths.some((health) => matchesGenerationHealthChip(health, "empty"))) {
			empty += 1;
		}
		if (healths.some((health) => matchesGenerationHealthChip(health, "swapped"))) {
			swapped += 1;
		}
	}
	return fromQueryRow(
		{
			llm_spans: llmTraces,
			finish_eligible: finishEligible,
			truncated,
			filtered,
			empty_eligible: emptyEligible,
			empty,
			swap_eligible: swapEligible,
			swapped,
		},
		{}
	);
}

async function fromExternalSample(params: MetricParams): Promise<GenerationHealthRow> {
	const { resolveSignalReadContext } =
		await import("@/lib/platform/connectors/datasource/facade");
	const { metricParamsToOpenLITQuery } =
		await import("@/lib/platform/connectors/datasource/clickhouse/query-map");
	const context = await resolveSignalReadContext("traces", {
		sourceId: params.sourceId,
		environment: params.environment,
	});
	const adapter = context?.adapter;
	if (typeof adapter?.sampleTracesForGraph !== "function") {
		return emptyRow(true);
	}
	const query = metricParamsToOpenLITQuery(
		paramsWithoutHealthChips(params),
		"traces"
	);
	try {
		const spans = await adapter.sampleTracesForGraph(
			query,
			GENERATION_HEALTH_SAMPLE_TRACES
		);
		return summarizeGenerationHealthFromSpans(spans);
	} catch (err) {
		if (err instanceof UnsupportedCapabilityError) return emptyRow(true);
		throw err;
	}
}

async function resolveExternalTraces(params: MetricParams) {
	const { resolveTelemetrySourceDescriptor } =
		await import("@/lib/telemetry-source");
	const descriptor = await resolveTelemetrySourceDescriptor({
		signal: "traces",
		sourceId: params.sourceId,
		environment: params.environment,
	});
	if (descriptor.isBuiltIn || descriptor.type === "clickhouse") {
		return null;
	}
	return { descriptor };
}

function paramsWithoutHealthChips(params: MetricParams): MetricParams {
	const selectedConfig = { ...(params.selectedConfig || {}) };
	delete selectedConfig.generationHealth;
	return { ...params, selectedConfig };
}

function windowQuery(params: MetricParams) {
	const scoped = paramsWithoutHealthChips(params);
	return `
		SELECT
			${uniqTraceIfSql(HAS_LLM_SPAN_SQL)} AS llm_spans,
			${uniqTraceIfSql(HAS_FINISH_REASON_SQL)} AS finish_eligible,
			${uniqTraceIfSql(`${HAS_FINISH_REASON_SQL} AND ${IS_TRUNCATED_SQL}`)} AS truncated,
			${uniqTraceIfSql(`${HAS_FINISH_REASON_SQL} AND ${IS_FILTERED_SQL}`)} AS filtered,
			${uniqTraceIfSql(HAS_OUTPUT_TOKENS_SQL)} AS empty_eligible,
			${uniqTraceIfSql(IS_EMPTY_SQL)} AS empty,
			${uniqTraceIfSql(HAS_BOTH_MODELS_SQL)} AS swap_eligible,
			${uniqTraceIfSql(IS_MODEL_SWAP_SQL)} AS swapped
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ${getFilterWhereCondition(scoped, true)}
	`;
}

export async function getGenerationHealth(
	params: MetricParams
): Promise<{ err?: unknown; data?: GenerationHealthRow[] }> {
	const external = await resolveExternalTraces(params);
	if (external) {
		try {
			return { data: [await fromExternalSample(params)] };
		} catch (err) {
			return { err, data: [] };
		}
	}

	const previousParams = getFilterPreviousParams(params);
	const query = `
		SELECT
			current_data.llm_spans AS llm_spans,
			current_data.finish_eligible AS finish_eligible,
			current_data.truncated AS truncated,
			current_data.filtered AS filtered,
			current_data.empty_eligible AS empty_eligible,
			current_data.empty AS empty,
			current_data.swap_eligible AS swap_eligible,
			current_data.swapped AS swapped,
			previous_data.llm_spans AS previous_llm_spans,
			previous_data.finish_eligible AS previous_finish_eligible,
			previous_data.truncated AS previous_truncated,
			previous_data.filtered AS previous_filtered,
			previous_data.empty_eligible AS previous_empty_eligible,
			previous_data.empty AS previous_empty,
			previous_data.swap_eligible AS previous_swap_eligible,
			previous_data.swapped AS previous_swapped
		FROM (${windowQuery(params)}) AS current_data
		CROSS JOIN (${windowQuery(previousParams)}) AS previous_data
	`;

	const result = await dataCollector({ query });
	if (result.err) return { err: result.err, data: [] };
	const rows = (result.data as Record<string, unknown>[]) || [];
	const current = rows[0] || {};
	const previous = {
		llm_spans: current.previous_llm_spans,
		finish_eligible: current.previous_finish_eligible,
		truncated: current.previous_truncated,
		filtered: current.previous_filtered,
		empty_eligible: current.previous_empty_eligible,
		empty: current.previous_empty,
		swap_eligible: current.previous_swap_eligible,
		swapped: current.previous_swapped,
	};
	return { data: [fromQueryRow(current, previous)] };
}
