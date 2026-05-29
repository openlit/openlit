"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BarChart3, DollarSign, GitBranch, MessageSquareText, Network, Sparkles } from "lucide-react";
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
import TraceAiAnalysisPanel from "@/components/(playground)/request/components/trace-ai-analysis-panel";
import getMessage from "@/constants/messages";
import { cn } from "@/lib/utils";

type ViewMode = "tree" | "chat" | "analysis" | "timeline" | "graph";
type ViewModeLabelKey =
	| "OBSERVABILITY_TREE"
	| "OBSERVABILITY_CHAT"
	| "TRACE_AI_TAB_TITLE"
	| "OBSERVABILITY_TIMELINE"
	| "OBSERVABILITY_GRAPH";

const VIEW_MODES: { key: ViewMode; labelKey: ViewModeLabelKey; icon: ReactNode }[] = [
	{ key: "tree", labelKey: "OBSERVABILITY_TREE", icon: <GitBranch className="h-3.5 w-3.5" /> },
	{ key: "chat", labelKey: "OBSERVABILITY_CHAT", icon: <MessageSquareText className="h-3.5 w-3.5" /> },
	{ key: "analysis", labelKey: "TRACE_AI_TAB_TITLE", icon: <Sparkles className="h-3.5 w-3.5" /> },
	{ key: "timeline", labelKey: "OBSERVABILITY_TIMELINE", icon: <BarChart3 className="h-3.5 w-3.5" /> },
	{ key: "graph", labelKey: "OBSERVABILITY_GRAPH", icon: <Network className="h-3.5 w-3.5" /> },
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

function isCodingAgentTree(span?: TraceHeirarchySpan): boolean {
	if (!span) return false;
	if (span.SpanName?.startsWith("coding_agent.")) return true;
	if (Array.isArray(span.children)) {
		for (const child of span.children) {
			if (isCodingAgentTree(child)) return true;
		}
	}
	return false;
}

function SpanHierarchyExplorerInner({
	hierarchySpanId,
	selectedSpanId,
	onSelectSpan,
	fill = false,
}: {
	hierarchySpanId: string;
	selectedSpanId: string;
	onSelectSpan?: (spanId: string) => void;
	fill?: boolean;
}) {
	const m = getMessage();
	const [, updateRequest] = useRequest();
	const [viewMode, setViewMode] = useState<ViewMode>("tree");
	// User-driven view-mode changes win over the auto-default. We track
	// whether the user has explicitly picked a view so we don't keep
	// snapping back to "chat" every time the trace data refreshes.
	const userPickedViewRef = useRef(false);
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
	const isCodingAgent = useMemo(() => isCodingAgentTree(record), [record]);

	// Coding-agent traces default to the Chat view because that's the
	// surface that renders the conversational signal (prompts, thinking,
	// tools, edits, subagents). Plain LLM traces stay on the Tree view.
	useEffect(() => {
		if (isCodingAgent && !userPickedViewRef.current) {
			setViewMode("chat");
		}
	}, [isCodingAgent]);

	return (
		<section
			className={cn(
				"rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 overflow-hidden",
				fill && "flex h-full min-h-0 flex-col"
			)}
		>
			<SelectionBridge
				selectedSpanId={selectedSpanId}
				onSelectSpan={onSelectSpan}
			/>
			<div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50 px-2 py-1.5 dark:border-stone-800 dark:bg-stone-900">
				
			<div className="flex rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-0.5">
					{VIEW_MODES.map((mode) => (
						<button
							key={mode.key}
							onClick={() => {
								userPickedViewRef.current = true;
								setViewMode(mode.key);
							}}
							className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors ${
								viewMode === mode.key
									? "bg-primary text-white"
									: "text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
							}`}
						>
							{mode.icon}
							{m[mode.labelKey]}
						</button>
					))}
				</div>
				<div className="ml-auto flex min-w-0 items-center gap-2">
					<span className="rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[11px] text-stone-500 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400">
						{isLoading
							? m.OBSERVABILITY_LOADING_SPANS
							: m.OBSERVABILITY_SPAN_COUNT(spanCount.toLocaleString())}
					</span>
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
					{m.OBSERVABILITY_HIERARCHY_UNAVAILABLE}
				</div>
			) : (
				<div
					className={cn(
						"bg-stone-50/60 dark:bg-stone-950",
						fill
							? viewMode === "graph"
								? "min-h-0 flex-1 overflow-hidden overscroll-contain"
								: "min-h-0 flex-1 overflow-auto"
							: viewMode === "graph"
								? "h-[520px] overflow-hidden overscroll-contain"
								: "max-h-[520px] overflow-auto"
					)}
				>
					{viewMode === "tree" && (
						<div className="min-w-fit p-3">
							<TreeNode span={record} level={0} />
						</div>
					)}
					{viewMode === "chat" && <ChatView record={record} />}
					{viewMode === "analysis" && (
						<div className="h-full overflow-auto">
							<TraceAiAnalysisPanel spanId={hierarchySpanId} scope="trace" />
						</div>
					)}
					{viewMode === "timeline" && (
						<div className="min-w-fit p-3">
							<TimelineView record={record} />
						</div>
					)}
					{viewMode === "graph" && <NodeGraph record={record} />}
				</div>
			)}
			{aggregateCost > 0 && (
				<div className="flex shrink-0 items-center gap-2 border-t border-stone-200 bg-stone-50 px-3 py-2 dark:border-stone-800 dark:bg-stone-900/50">
					<DollarSign className="h-3.5 w-3.5 text-stone-500 dark:text-stone-400" />
					<span className="text-xs font-medium text-stone-600 dark:text-stone-400">
						Total cost
					</span>
					<span className="font-mono text-xs font-semibold text-stone-900 dark:text-stone-100">
						${aggregateCost.toFixed(10)}
					</span>
				</div>
			)}
		</section>
	);
}

export default function SpanHierarchyExplorer({
	hierarchySpanId,
	selectedSpanId,
	onSelectSpan,
	fill,
}: {
	hierarchySpanId: string;
	selectedSpanId: string;
	onSelectSpan?: (spanId: string) => void;
	fill?: boolean;
}) {
	return (
		<RequestProvider syncUrl={false}>
			<SpanHierarchyExplorerInner
				hierarchySpanId={hierarchySpanId}
				selectedSpanId={selectedSpanId}
				onSelectSpan={onSelectSpan}
				fill={fill}
			/>
		</RequestProvider>
	);
}
