/**
 * Build an aggregate agent DAG in-process from sampled full traces.
 *
 * The agent aggregate-graph (`getAggregateGraph`) uses ClickHouse's self-join
 * for the built-in source and this in-process reconstruction for external
 * trace sources, fed by `adapter.sampleTracesForGraph`.
 *
 * ClickHouse builds this via a self-join on `ParentSpanId` within `TraceId`
 * plus `GROUP BY SpanName` + `quantile`/`countIf`. Vendors without server-side
 * aggregation (Tempo, Jaeger) cannot express that, so their adapters fetch a
 * bounded sample of full traces and this function reproduces the DAG: nodes
 * keyed by span name with call counts + duration quantiles, and edges keyed by
 * (parentName -> childName) with call counts.
 */

import type { NormalizedSpan } from "../types";

export interface DagNode {
	name: string;
	count: number;
	errorCount: number;
	p50DurationMs: number;
	p95DurationMs: number;
	totalCost: number;
}

export interface DagEdge {
	from: string;
	to: string;
	count: number;
}

export interface AggregateDag {
	nodes: DagNode[];
	edges: DagEdge[];
	sampledTraces: number;
	sampledSpans: number;
}

function quantile(sortedNs: number[], q: number): number {
	if (sortedNs.length === 0) return 0;
	const idx = Math.min(
		sortedNs.length - 1,
		Math.max(0, Math.floor(q * (sortedNs.length - 1)))
	);
	return sortedNs[idx];
}

const isError = (span: NormalizedSpan): boolean =>
	/error/i.test(span.statusCode || "");

/** Build the aggregate DAG from a flat list of sampled spans. */
export function buildAggregateDag(spans: NormalizedSpan[]): AggregateDag {
	const byId = new Map<string, NormalizedSpan>();
	const traceIds = new Set<string>();
	for (const s of spans) {
		if (s.spanId) byId.set(s.spanId, s);
		if (s.traceId) traceIds.add(s.traceId);
	}

	const nodeDurations = new Map<string, number[]>();
	const nodeCount = new Map<string, number>();
	const nodeErrors = new Map<string, number>();
	const nodeCost = new Map<string, number>();
	const edgeCount = new Map<string, number>();

	for (const span of spans) {
		const name = span.name || "(unnamed)";
		nodeCount.set(name, (nodeCount.get(name) || 0) + 1);
		if (isError(span)) nodeErrors.set(name, (nodeErrors.get(name) || 0) + 1);
		if (typeof span.cost === "number") {
			nodeCost.set(name, (nodeCost.get(name) || 0) + span.cost);
		}
		const durations = nodeDurations.get(name) || [];
		durations.push(span.durationNs || 0);
		nodeDurations.set(name, durations);

		// Edge: parent span (same trace) -> this span.
		const parent = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
		if (parent && parent.traceId === span.traceId) {
			const from = parent.name || "(unnamed)";
			const key = `${from}\u0000${name}`;
			edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
		}
	}

	const nodes: DagNode[] = Array.from(nodeCount.keys()).map((name) => {
		const sorted = (nodeDurations.get(name) || []).slice().sort((a, b) => a - b);
		return {
			name,
			count: nodeCount.get(name) || 0,
			errorCount: nodeErrors.get(name) || 0,
			p50DurationMs: quantile(sorted, 0.5) / 1e6,
			p95DurationMs: quantile(sorted, 0.95) / 1e6,
			totalCost: nodeCost.get(name) || 0,
		};
	});

	const edges: DagEdge[] = Array.from(edgeCount.entries()).map(([key, count]) => {
		const [from, to] = key.split("\u0000");
		return { from, to, count };
	});

	return {
		nodes,
		edges,
		sampledTraces: traceIds.size,
		sampledSpans: spans.length,
	};
}
