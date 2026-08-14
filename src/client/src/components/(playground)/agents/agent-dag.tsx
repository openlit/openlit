"use client";

import { useEffect, useState } from "react";
import getMessage from "@/constants/messages";
import DagCanvas, {
	type DagEdgeInput,
	type DagNodeInput,
} from "./dag-canvas";
import type { AggregateGraph } from "@/lib/platform/agents/aggregate-graph";

interface AgentDagProps {
	agentKey: string;
	versionHash: string | null;
}

function formatLatency(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0ms";
	if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
	if (ms >= 1) return `${Math.round(ms)}ms`;
	return `${ms.toFixed(2)}ms`;
}

function formatErrorRate(rate: number): string {
	if (!Number.isFinite(rate) || rate <= 0) return "";
	return ` · ${(rate * 100).toFixed(1)}% err`;
}

export default function AgentDag({ agentKey, versionHash }: AgentDagProps) {
	const [graph, setGraph] = useState<AggregateGraph | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const params = versionHash
					? `?versionHash=${encodeURIComponent(versionHash)}`
					: "";
				const res = await fetch(`/api/agents/${agentKey}/graph${params}`);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const body = await res.json();
				if (cancelled) return;
				setGraph((body.data?.graph as AggregateGraph) || null);
			} catch (e) {
				if (!cancelled) setError(String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [agentKey, versionHash]);

	const nodes: DagNodeInput[] =
		graph?.nodes.map((n) => {
			const isTool = n.kind === "tool";
			return {
				id: n.id,
				label: n.spanName,
				subLabel: isTool
					? `${n.spanCount.toLocaleString()} invocations`
					: `${n.spanCount.toLocaleString()} calls · p50 ${formatLatency(n.p50Ms)}`,
				tooltip: isTool
					? `Tool: ${n.spanName}\n${n.spanCount.toLocaleString()} invocations${formatErrorRate(
							n.errorRate
						)}`
					: `${n.spanName}\n${n.spanCount.toLocaleString()} calls\np50 ${formatLatency(
							n.p50Ms
						)}${formatErrorRate(n.errorRate)}`,
				depth: n.depth,
				kind: isTool ? ("tool" as const) : ("span" as const),
			};
		}) || [];

	const edges: DagEdgeInput[] =
		graph?.edges.map((e) => ({
			from: e.from,
			to: e.to,
			label: `${e.count.toLocaleString()} · ${formatLatency(e.p50Ms)}`,
			tooltip: `${e.from} → ${e.to}\n${e.count.toLocaleString()} calls\np50 ${formatLatency(
				e.p50Ms
			)}${formatErrorRate(e.errorRate)}`,
			weight: e.count,
		})) || [];

	return (
		<section className="space-y-2">
			{graph && graph.traceCount > 0 && (
				<div className="text-xs text-stone-500 dark:text-stone-400 text-right">
					{getMessage().AGENTS_DAG_SAMPLED_NOTE(
						Math.min(graph.traceCount, 500),
						graph.traceCount
					)}
				</div>
			)}

			{loading && (
				<div
					className="flex items-center justify-center text-sm text-stone-500 dark:text-stone-400 border border-stone-200 dark:border-stone-800 rounded-md bg-white dark:bg-stone-950"
					style={{ minHeight: 520 }}
				>
					Loading…
				</div>
			)}
			{!loading && error && (
				<div className="border border-red-200 dark:border-red-900 rounded-md p-3 text-sm text-red-600 dark:text-red-400">
					{error}
				</div>
			)}
			{!loading && !error && (
				<DagCanvas
					nodes={nodes}
					edges={edges}
					emptyMessage={getMessage().AGENTS_DAG_EMPTY}
				/>
			)}
		</section>
	);
}
