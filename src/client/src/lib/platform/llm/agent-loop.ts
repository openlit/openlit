import {
	getFilterPreviousParams,
	getFilterWhereCondition,
} from "@/helpers/server/platform";
import { MetricParams, dataCollector, OTEL_TRACES_TABLE_NAME } from "../common";
import { agentLoopStatsSql } from "@/lib/platform/agent-loop/sql";
import {
	detectAgentLoops,
	hasAgentLoopFilter,
	isToolSpan,
	spanLoopAttrs,
	spanTraceId,
} from "@/lib/platform/agent-loop/classify";
import { GENERATION_HEALTH_SAMPLE_TRACES } from "@/lib/platform/generation-health/classify";
import { UnsupportedCapabilityError } from "@/lib/platform/connectors/datasource/types";

export type AgentLoopRow = {
	unsupported?: boolean;
	tool_traces: number;
	loops: number;
	loops_pct: number;
	previous_tool_traces: number;
	previous_loops: number;
	previous_loops_pct: number;
};

function asCount(value: unknown): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : 0;
}

function pct(count: number, eligible: number): number {
	if (!eligible || eligible <= 0) return 0;
	return (count / eligible) * 100;
}

function emptyRow(unsupported = false): AgentLoopRow {
	return {
		unsupported,
		tool_traces: 0,
		loops: 0,
		loops_pct: 0,
		previous_tool_traces: 0,
		previous_loops: 0,
		previous_loops_pct: 0,
	};
}

function fromQueryRow(
	current: Record<string, unknown> | undefined,
	previous: Record<string, unknown> | undefined
): AgentLoopRow {
	const toolTraces = asCount(current?.tool_traces);
	const loops = asCount(current?.loops);
	const previousToolTraces = asCount(previous?.tool_traces);
	const previousLoops = asCount(previous?.loops);
	return {
		tool_traces: toolTraces,
		loops,
		loops_pct: pct(loops, toolTraces),
		previous_tool_traces: previousToolTraces,
		previous_loops: previousLoops,
		previous_loops_pct: pct(previousLoops, previousToolTraces),
	};
}

function paramsWithoutLoop(params: MetricParams): MetricParams {
	const selectedConfig = { ...(params.selectedConfig || {}) };
	delete selectedConfig.agentLoop;
	return { ...params, selectedConfig };
}

export function summarizeAgentLoopFromSpans(
	spans: Array<{
		traceId?: string;
		spanAttributes?: Record<string, unknown>;
		resourceAttributes?: Record<string, unknown>;
	}>
): AgentLoopRow {
	const toolTraceIds = new Set<string>();
	spans.forEach((span, index) => {
		if (!isToolSpan(spanLoopAttrs(span))) return;
		toolTraceIds.add(spanTraceId(span, index));
	});
	const looping = new Set<string>();
	for (const loop of detectAgentLoops(spans)) {
		for (const traceId of loop.traceIds) looping.add(traceId);
	}
	return fromQueryRow(
		{ tool_traces: toolTraceIds.size, loops: looping.size },
		{}
	);
}

async function fromExternalSample(params: MetricParams): Promise<AgentLoopRow> {
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
	const query = metricParamsToOpenLITQuery(paramsWithoutLoop(params), "traces");
	try {
		const spans = await adapter.sampleTracesForGraph(
			query,
			GENERATION_HEALTH_SAMPLE_TRACES
		);
		return summarizeAgentLoopFromSpans(spans);
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

function windowQuery(params: MetricParams) {
	const scoped = paramsWithoutLoop(params);
	const baseWhere = getFilterWhereCondition(scoped, true);
	return agentLoopStatsSql(OTEL_TRACES_TABLE_NAME, baseWhere);
}

export async function getAgentLoop(
	params: MetricParams
): Promise<{ err?: unknown; data?: AgentLoopRow[] }> {
	const external = await resolveExternalTraces(params);
	if (external) {
		try {
			return { data: [await fromExternalSample(params)] };
		} catch (err) {
			return { err, data: [] };
		}
	}

	const previousParams = getFilterPreviousParams(paramsWithoutLoop(params));
	const query = `
		SELECT
			current_data.tool_traces AS tool_traces,
			current_data.loops AS loops,
			previous_data.tool_traces AS previous_tool_traces,
			previous_data.loops AS previous_loops
		FROM (${windowQuery(params)}) AS current_data
		CROSS JOIN (${windowQuery(previousParams)}) AS previous_data
	`;

	const result = await dataCollector(
		{ query },
		"query",
		params.databaseConfigId
	);
	if (result.err) return { err: result.err, data: [] };
	const rows = (result.data as Record<string, unknown>[]) || [];
	const current = rows[0] || {};
	const previous = {
		tool_traces: current.previous_tool_traces,
		loops: current.previous_loops,
	};
	return { data: [fromQueryRow(current, previous)] };
}

export { hasAgentLoopFilter };
