"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BarChart3, GitBranch, MessageSquareText, Network } from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { TraceHeirarchySpan } from "@/types/trace";
import {
	RequestProvider,
	useRequest,
} from "@/components/(playground)/request/request-context";
import TreeNode from "@/components/(playground)/request/components/tree-node";
import TimelineView from "@/components/(playground)/request/components/timeline-view";
import NodeGraph from "@/components/(playground)/request/components/node-graph";
import ChatView from "@/components/(playground)/request/components/chat-view";

type ViewMode = "tree" | "chat" | "timeline" | "graph";

const VIEW_MODES: { key: ViewMode; label: string; icon: ReactNode }[] = [
	{ key: "tree", label: "Tree", icon: <GitBranch className="h-3.5 w-3.5" /> },
	{ key: "chat", label: "Chat", icon: <MessageSquareText className="h-3.5 w-3.5" /> },
	{ key: "timeline", label: "Timeline", icon: <BarChart3 className="h-3.5 w-3.5" /> },
	{ key: "graph", label: "Graph", icon: <Network className="h-3.5 w-3.5" /> },
];

function sumCostRecursive(span: TraceHeirarchySpan): number {
	const cost = span.Cost != null && span.Cost > 0 ? span.Cost : 0;
	const childrenCost = (span.children || []).reduce(
		(acc, child) => acc + sumCostRecursive(child),
		0
	);
	return cost + childrenCost;
}

function countSpans(span?: TraceHeirarchySpan): number {
	if (!span) return 0;
	return 1 + (span.children || []).reduce((acc, child) => acc + countSpans(child), 0);
}

function SelectionBridge({
	onSelectSpan,
	selectedSpanId,
}: {
	onSelectSpan?: (spanId: string) => void;
	selectedSpanId: string;
}) {
	const [request] = useRequest();
	const lastSelectedSpanId = useRef(selectedSpanId);

	useEffect(() => {
		if (lastSelectedSpanId.current !== selectedSpanId) {
			lastSelectedSpanId.current = selectedSpanId;
			return;
		}
		if (request?.spanId && request.spanId !== selectedSpanId) {
			onSelectSpan?.(request.spanId);
		}
	}, [onSelectSpan, request?.spanId, selectedSpanId]);

	return null;
}

function SpanHierarchyExplorerInner({
	hierarchySpanId,
	selectedSpanId,
	onSelectSpan,
}: {
	hierarchySpanId: string;
	selectedSpanId: string;
	onSelectSpan?: (spanId: string) => void;
}) {
	const [, updateRequest] = useRequest();
	const [viewMode, setViewMode] = useState<ViewMode>("tree");
	const { data, fireRequest, isLoading } = useFetchWrapper();

	useEffect(() => {
		updateRequest({ spanId: selectedSpanId } as any);
	}, [selectedSpanId, updateRequest]);

	useEffect(() => {
		fireRequest({
			requestType: "GET",
			url: `/api/metrics/request/span/${hierarchySpanId}/heirarchy`,
		});
	}, [fireRequest, hierarchySpanId]);

	const typedData = (data as { record?: TraceHeirarchySpan; err?: string }) || {};
	const record = typedData.record;
	const aggregateCost = useMemo(
		() => (record ? sumCostRecursive(record) : 0),
		[record]
	);
	const spanCount = useMemo(() => countSpans(record), [record]);

	return (
		<section className="rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 overflow-hidden">
			<SelectionBridge
				selectedSpanId={selectedSpanId}
				onSelectSpan={onSelectSpan}
			/>
			<div className="flex flex-wrap items-center gap-2 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 px-3 py-2">
				<div className="mr-auto min-w-0">
					<h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
						Span Hierarchy
					</h2>
					<p className="text-xs text-stone-500 dark:text-stone-400">
						{isLoading
							? "Loading spans"
							: `${spanCount.toLocaleString()} spans${aggregateCost > 0 ? ` / $${aggregateCost.toFixed(8)}` : ""}`}
					</p>
				</div>
				<div className="flex rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-0.5">
					{VIEW_MODES.map((mode) => (
						<button
							key={mode.key}
							onClick={() => setViewMode(mode.key)}
							className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
								viewMode === mode.key
									? "bg-primary text-white"
									: "text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
							}`}
						>
							{mode.icon}
							{mode.label}
						</button>
					))}
				</div>
			</div>

			{isLoading ? (
				<div className="grid gap-2 p-3">
					{[0, 1, 2, 3].map((item) => (
						<div
							key={item}
							className="h-9 animate-pulse rounded bg-stone-100 dark:bg-stone-900"
						/>
					))}
				</div>
			) : !record || typedData.err ? (
				<div className="px-3 py-8 text-sm text-stone-400">
					Span hierarchy is not available for this span.
				</div>
			) : (
				<div className={`${viewMode === "graph" ? "h-[520px] overflow-hidden overscroll-contain" : "max-h-[520px] overflow-auto"} bg-stone-50/60 dark:bg-stone-950`}>
					{viewMode === "tree" && (
						<div className="min-w-fit p-3">
							<TreeNode span={record} level={0} />
						</div>
					)}
					{viewMode === "chat" && <ChatView record={record} />}
					{viewMode === "timeline" && (
						<div className="min-w-fit p-3">
							<TimelineView record={record} />
						</div>
					)}
					{viewMode === "graph" && <NodeGraph record={record} />}
				</div>
			)}
		</section>
	);
}

export default function SpanHierarchyExplorer({
	hierarchySpanId,
	selectedSpanId,
	onSelectSpan,
}: {
	hierarchySpanId: string;
	selectedSpanId: string;
	onSelectSpan?: (spanId: string) => void;
}) {
	return (
		<RequestProvider syncUrl={false}>
			<SpanHierarchyExplorerInner
				hierarchySpanId={hierarchySpanId}
				selectedSpanId={selectedSpanId}
				onSelectSpan={onSelectSpan}
			/>
		</RequestProvider>
	);
}
