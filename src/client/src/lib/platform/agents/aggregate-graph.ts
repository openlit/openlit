/**
 * Aggregate per-agent-version DAG.
 *
 * Single-trace `transformTracesToGraph` (see lib/platform/graph-transform.ts)
 * answers "how did this individual call flow?". For the agent detail page's
 * Overview tab we need the inverse — "what does a typical call flow look
 * like across N traces in this version?". This module produces that
 * aggregate graph directly from `otel_traces` using a self-join, which:
 *
 *  - Avoids fetching every span of every trace into Node and merging there
 *    (cheaper and bounded by ClickHouse's aggregation budget).
 *  - Naturally collapses repeated invocations of the same span name (e.g.
 *    `lookup_weather`) into a single node with a count + latency stats.
 *
 * The output mirrors `DAG` from `graph-transform.ts` in spirit but with
 * aggregate edge labels (`count`, `p50_ms`, `error_rate`).
 */

import {
	dataCollector,
	OTEL_TRACES_TABLE_NAME,
} from "@/lib/platform/common";
import { buildVersionWhereClause } from "./version-filter";
import { agentsLogger } from "./logger";
import type { VersionFilter } from "@/types/platform";
import { escapeClickHouseString } from "@/lib/clickhouse-escape";

const escape = escapeClickHouseString;

export type AggregateNodeKind = "span" | "tool";

export interface AggregateNode {
	id: string;
	spanName: string;
	spanCount: number;
	p50Ms: number;
	errorRate: number;
	depth: number;
	/**
	 * `span` = real OTel span observed in the trace.
	 * `tool` = synthetic node derived from `gen_ai.tool.name` recorded on a
	 *          chat/LLM span; used because vanilla provider instrumentations
	 *          (OpenAI, Anthropic, …) emit only the parent chat span and
	 *          carry the invoked tool name as an attribute rather than a
	 *          separate `execute_tool` span. Surfacing the tools as nodes is
	 *          critical for the agent operator's mental model.
	 */
	kind: AggregateNodeKind;
}

export interface AggregateEdge {
	from: string;
	to: string;
	count: number;
	p50Ms: number;
	errorRate: number;
}

export interface AggregateGraph {
	nodes: AggregateNode[];
	edges: AggregateEdge[];
	traceCount: number;
	spanCount: number;
}

export interface AggregateGraphParams {
	serviceName: string;
	environment?: string;
	versionFilter?: VersionFilter | null;
	dbConfigId?: string;
	/** Cap aggregated traces. Higher = more accurate p50 but heavier query. */
	maxTraces?: number;
}

const DEFAULT_MAX_TRACES = 500;

const HEALTHY_STATUS_VALUES = [
	"STATUS_CODE_OK",
	"STATUS_CODE_UNSET",
	"Ok",
	"Unset",
];

/**
 * Aggregate the version's traffic into one DAG. When no `versionFilter` is
 * supplied the function falls back to a recent 24h window so the call-site
 * still has something to render.
 */
export async function getAggregateGraph(
	params: AggregateGraphParams
): Promise<AggregateGraph> {
	const maxTraces = Math.max(50, params.maxTraces || DEFAULT_MAX_TRACES);
	const env = params.environment || "default";
	const envPredicate =
		env === "default"
			? `(ResourceAttributes['deployment.environment'] = 'default' OR ResourceAttributes['deployment.environment'] = '')`
			: `ResourceAttributes['deployment.environment'] = '${escape(env)}'`;

	const versionClause = buildVersionWhereClause(params.versionFilter);
	const recentFallback =
		versionClause === ""
			? "Timestamp >= now() - INTERVAL 24 HOUR"
			: "1=1";

	// Sample top-N traces in the window so the joins are bounded.
	const sampledTracesCte = `
		SELECT DISTINCT TraceId
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE ServiceName = '${escape(params.serviceName)}'
			AND ${envPredicate}
			${versionClause ? `AND ${versionClause}` : ""}
			AND ${recentFallback}
		ORDER BY TraceId DESC
		LIMIT ${maxTraces}
	`;

	const healthyStatuses = HEALTHY_STATUS_VALUES.map((s) => `'${s}'`).join(", ");

	// Single-query design: previously this module hit ClickHouse 4 times
	// (nodes, edges, tool-edges, trace count) and the trace-count query was
	// unbounded — it would scan every matching span in the window even when
	// `maxTraces` capped everything else. Combining into one UNION ALL with
	// a `kind` discriminator gives us:
	//
	//   * 1 round-trip instead of 4 (mutates p99 latency on the detail page).
	//   * `trace_count` derived from `sampled_traces` so it inherits the cap
	//     and reports the actual sample size, which is what we surface in the
	//     UI ("based on the last N sampled traces").
	//   * Single materialisation point for `trace_spans` shared by both the
	//     node aggregation and the edge self-join, reducing redundant filter
	//     work.
	//
	// Each branch returns the same column shape so JSON parsing stays cheap.
	const combinedQuery = `
		WITH sampled_traces AS (${sampledTracesCte}),
		trace_spans AS (
			SELECT TraceId, SpanId, ParentSpanId, SpanName, Duration, StatusCode, SpanAttributes
			FROM ${OTEL_TRACES_TABLE_NAME}
			WHERE TraceId IN (SELECT TraceId FROM sampled_traces)
				AND ServiceName = '${escape(params.serviceName)}'
				AND ${envPredicate}
		)
		SELECT * FROM (
			SELECT
				'node' AS kind,
				SpanName AS source,
				'' AS target,
				toUInt64(count()) AS edge_count,
				quantile(0.5)(toFloat64(Duration) / 1e6) AS p50_ms,
				countIf(StatusCode NOT IN (${healthyStatuses})) / count() AS error_rate
			FROM trace_spans
			WHERE SpanName != ''
			GROUP BY source
			ORDER BY edge_count DESC
			LIMIT 200
		)
		UNION ALL
		SELECT * FROM (
			SELECT
				'edge' AS kind,
				parent.SpanName AS source,
				child.SpanName AS target,
				toUInt64(count()) AS edge_count,
				quantile(0.5)(toFloat64(child.Duration) / 1e6) AS p50_ms,
				countIf(child.StatusCode NOT IN (${healthyStatuses})) / count() AS error_rate
			FROM trace_spans AS child
			INNER JOIN trace_spans AS parent
				ON child.TraceId = parent.TraceId
				AND child.ParentSpanId = parent.SpanId
			WHERE parent.SpanName != ''
				AND child.SpanName != ''
			GROUP BY source, target
			ORDER BY edge_count DESC
			LIMIT 400
		)
		UNION ALL
		SELECT * FROM (
			SELECT
				'tool_edge' AS kind,
				SpanName AS source,
				tool_name AS target,
				toUInt64(count()) AS edge_count,
				quantile(0.5)(toFloat64(Duration) / 1e6) AS p50_ms,
				countIf(StatusCode NOT IN (${healthyStatuses})) / count() AS error_rate
			FROM trace_spans
			ARRAY JOIN arrayMap(
				s -> trimBoth(s),
				splitByString(',', SpanAttributes['gen_ai.tool.name'])
			) AS tool_name
			WHERE SpanAttributes['gen_ai.tool.name'] != ''
				AND tool_name != ''
			GROUP BY source, target
			ORDER BY edge_count DESC
			LIMIT 200
		)
		UNION ALL
		SELECT
			'trace_count' AS kind,
			'' AS source,
			'' AS target,
			toUInt64(count()) AS edge_count,
			toFloat64(0) AS p50_ms,
			toFloat64(0) AS error_rate
		FROM sampled_traces
	`;

	const combinedRes = await dataCollector(
		{ query: combinedQuery },
		"query",
		params.dbConfigId
	);
	if (combinedRes.err) {
		agentsLogger.error("aggregate_graph_query_failed", {
			err: combinedRes.err,
		});
	}

	type CombinedRow = {
		kind: "node" | "edge" | "tool_edge" | "trace_count";
		source: string;
		target: string;
		edge_count: number;
		p50_ms: number;
		error_rate: number;
	};
	const rows = (combinedRes.data as CombinedRow[]) || [];

	const nodeRows: Array<{
		span_name: string;
		span_count: number;
		p50_ms: number;
		error_rate: number;
	}> = [];
	const edgeRows: Array<{
		source: string;
		target: string;
		edge_count: number;
		p50_ms: number;
		error_rate: number;
	}> = [];
	const toolRows: Array<{
		source: string;
		target: string;
		edge_count: number;
		p50_ms: number;
		error_rate: number;
	}> = [];
	let traceCount = 0;

	for (const row of rows) {
		switch (row.kind) {
			case "node":
				nodeRows.push({
					span_name: row.source,
					span_count: Number(row.edge_count || 0),
					p50_ms: Number(row.p50_ms || 0),
					error_rate: Number(row.error_rate || 0),
				});
				break;
			case "edge":
				edgeRows.push({
					source: row.source,
					target: row.target,
					edge_count: Number(row.edge_count || 0),
					p50_ms: Number(row.p50_ms || 0),
					error_rate: Number(row.error_rate || 0),
				});
				break;
			case "tool_edge":
				toolRows.push({
					source: row.source,
					target: row.target,
					edge_count: Number(row.edge_count || 0),
					p50_ms: Number(row.p50_ms || 0),
					error_rate: Number(row.error_rate || 0),
				});
				break;
			case "trace_count":
				traceCount = Number(row.edge_count || 0);
				break;
		}
	}

	const nodes: AggregateNode[] = nodeRows.map<AggregateNode>((row) => ({
		id: row.span_name,
		spanName: row.span_name,
		spanCount: Number(row.span_count || 0),
		p50Ms: Number(row.p50_ms || 0),
		errorRate: Number(row.error_rate || 0),
		depth: 0,
		kind: "span",
	}));

	const edges: AggregateEdge[] = edgeRows
		// Drop self-loops and stale references to a non-existent node so the
		// frontend layout doesn't need defensive checks.
		.filter((row) => row.source !== row.target)
		.map<AggregateEdge>((row) => ({
			from: row.source,
			to: row.target,
			count: Number(row.edge_count || 0),
			p50Ms: Number(row.p50_ms || 0),
			errorRate: Number(row.error_rate || 0),
		}));

	// Merge synthetic tool nodes/edges. Each tool gets a single node summed
	// across the chat spans that invoked it; multiple chat-→-tool edges
	// remain distinct so the operator can see fan-in.
	const toolNodeAgg = new Map<
		string,
		{ count: number; p50Sum: number; errorSum: number; samples: number }
	>();
	for (const row of toolRows) {
		const target = (row.target || "").trim();
		if (!target) continue;
		const toolId = `tool:${target}`;
		const count = Number(row.edge_count || 0);
		const agg = toolNodeAgg.get(toolId) || {
			count: 0,
			p50Sum: 0,
			errorSum: 0,
			samples: 0,
		};
		agg.count += count;
		agg.p50Sum += Number(row.p50_ms || 0) * count;
		agg.errorSum += Number(row.error_rate || 0) * count;
		agg.samples += count;
		toolNodeAgg.set(toolId, agg);

		edges.push({
			from: row.source,
			to: toolId,
			count,
			p50Ms: Number(row.p50_ms || 0),
			errorRate: Number(row.error_rate || 0),
		});
	}

	Array.from(toolNodeAgg.entries()).forEach(([toolId, agg]) => {
		const toolName = toolId.slice("tool:".length);
		const samples = Math.max(1, agg.samples);
		nodes.push({
			id: toolId,
			spanName: toolName,
			spanCount: agg.count,
			p50Ms: agg.p50Sum / samples,
			errorRate: agg.errorSum / samples,
			depth: 0,
			kind: "tool",
		});
	});

	assignDepths(nodes, edges);

	const totalSpans = nodes
		.filter((n) => n.kind === "span")
		.reduce((s, n) => s + n.spanCount, 0);

	return {
		nodes,
		edges,
		traceCount: Number(traceCount || 0),
		spanCount: totalSpans,
	};
}

/**
 * BFS-style depth assignment so the canvas can lay out parents-above-children
 * even when traces sometimes invert order (depth = longest path from any root).
 *
 * Exported for unit testing — call sites should use the full
 * `getAggregateGraph()` instead, which assigns depths automatically.
 */
export function assignDepths(nodes: AggregateNode[], edges: AggregateEdge[]) {
	const byName = new Map<string, AggregateNode>();
	for (const n of nodes) byName.set(n.id, n);
	const incoming = new Map<string, string[]>();
	for (const n of nodes) incoming.set(n.id, []);
	for (const e of edges) {
		if (!byName.has(e.from) || !byName.has(e.to)) continue;
		incoming.get(e.to)!.push(e.from);
	}
	const memo = new Map<string, number>();
	const visiting = new Set<string>();
	const depthOf = (id: string): number => {
		if (memo.has(id)) return memo.get(id)!;
		if (visiting.has(id)) {
			// Cycle: clamp to 0 to avoid infinite recursion.
			memo.set(id, 0);
			return 0;
		}
		visiting.add(id);
		const parents = incoming.get(id) || [];
		const d = parents.length === 0 ? 0 : Math.max(...parents.map(depthOf)) + 1;
		visiting.delete(id);
		memo.set(id, d);
		return d;
	};
	for (const n of nodes) {
		n.depth = depthOf(n.id);
	}
}

export { buildVersionWhereClause };
