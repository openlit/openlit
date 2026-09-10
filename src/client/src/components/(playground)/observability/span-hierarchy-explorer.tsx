"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BarChart3, DollarSign, GitBranch, MessageSquareText, Network, Repeat, Shield, Sparkles } from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useSignalCapabilities } from "@/utils/hooks/useSignalCapabilities";
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
import TraceGovernancePanel from "./trace-governance-panel";
import getMessage from "@/constants/messages";
import { cn } from "@/lib/utils";
import { getCurrentProjectEnvironment } from "@/selectors/project";
import { useRootStore } from "@/store";
import { detectAgentLoops } from "@/lib/platform/agent-loop/classify";
import { agentLoopDetailLine } from "@/lib/platform/agent-loop/format";
import { flattenHierarchy } from "@/lib/platform/governance/hierarchy";
import { extractResourceHint, matchingLoopSpans } from "@/lib/platform/governance/evidence";

type ViewMode = "tree" | "chat" | "agentloop" | "analysis" | "governance" | "timeline" | "graph";
type ViewModeLabelKey =
	| "OBSERVABILITY_TREE"
	| "OBSERVABILITY_CHAT"
	| "OBSERVABILITY_AGENT_LOOP"
	| "TRACE_AI_TAB_TITLE"
	| "GOVERNANCE_TAB_TITLE"
	| "OBSERVABILITY_TIMELINE"
	| "OBSERVABILITY_GRAPH";

const VIEW_MODES: { key: ViewMode; labelKey: ViewModeLabelKey; icon: ReactNode }[] = [
	{ key: "tree", labelKey: "OBSERVABILITY_TREE", icon: <GitBranch className="h-3.5 w-3.5" /> },
	{ key: "chat", labelKey: "OBSERVABILITY_CHAT", icon: <MessageSquareText className="h-3.5 w-3.5" /> },
	{ key: "agentloop", labelKey: "OBSERVABILITY_AGENT_LOOP", icon: <Repeat className="h-3.5 w-3.5" /> },
	{ key: "governance", labelKey: "GOVERNANCE_TAB_TITLE", icon: <Shield className="h-3.5 w-3.5" /> },
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

function AgentLoopView({
	record,
	onSelectSpan,
}: {
	record: TraceHeirarchySpan;
	onSelectSpan?: (spanId: string) => void;
}) {
	const m = getMessage();
	const spans = useMemo(() => flattenHierarchy(record), [record]);
	const loops = useMemo(() => detectAgentLoops(spans), [spans]);

	if (!loops.length) {
		return (
			<div className="px-3 py-8 text-sm text-stone-400">
				{m.OBSERVABILITY_AGENT_LOOP_EMPTY}
			</div>
		);
	}

	return (
		<div className="grid min-w-0 gap-2 p-3">
			{loops.map((loop) => {
				const matched = matchingLoopSpans(spans, loop.toolName, loop.fingerprint);
				const sample = matched[0];
				const resource = sample ? extractResourceHint(sample) : "";
				return (
					<div
						key={`${loop.toolName}:${loop.fingerprint}`}
						className="min-w-0 max-w-full overflow-hidden rounded-md border border-stone-200 bg-white px-2.5 py-2 dark:border-stone-800 dark:bg-stone-950"
					>
						<p className="break-words text-xs font-medium text-stone-900 dark:text-stone-50">
							{agentLoopDetailLine(loop)}
						</p>
						{resource ? (
							<p className="mt-1 break-all font-mono text-[11px] text-stone-500 dark:text-stone-400">
								{resource}
							</p>
						) : null}
						{matched.length > 0 && onSelectSpan ? (
							<div className="mt-2 flex min-w-0 flex-wrap gap-1">
								<span className="sr-only">{m.OBSERVABILITY_AGENT_LOOP_SPANS}</span>
								{matched.slice(0, 8).map((span) => (
									<button
										key={span.SpanId}
										type="button"
										onClick={() => onSelectSpan(span.SpanId)}
										className="max-w-full break-all rounded border border-stone-200 px-1.5 py-0.5 font-mono text-[10px] text-stone-600 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
									>
										{span.SpanId.slice(0, 8)}
									</button>
								))}
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

function SpanHierarchyExplorerInner({
	hierarchySpanId,
	selectedSpanId,
	traceId,
	onSelectSpan,
	fill = false,
}: {
	hierarchySpanId: string;
	selectedSpanId: string;
	traceId?: string;
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
	const { data, fireRequest, isLoading, reset } = useFetchWrapper();
	const { capabilities } = useSignalCapabilities();
	const environment = useRootStore(getCurrentProjectEnvironment);

	// The Chat view renders OTel span events (prompts/completions). Sources that
	// don't carry span events (e.g. Datadog, New Relic) can't populate it, so we
	// hide the tab and never auto-switch to it — honest capability gating.
	const supportsSpanEvents =
		capabilities?.traces?.capabilities?.spanEvents !== false;
	const availableViewModes = useMemo(
		() => VIEW_MODES.filter((v) => v.key !== "chat" || supportsSpanEvents),
		[supportsSpanEvents]
	);

	useEffect(() => {
		updateRequest({ spanId: selectedSpanId } as any);
	}, [selectedSpanId, updateRequest]);

	useEffect(() => {
		reset();
	}, [environment, reset]);

	useEffect(() => {
		const params = new URLSearchParams();
		if (traceId) params.set("traceId", traceId);
		if (environment) params.set("environment", environment);
		const qs = params.size ? `?${params.toString()}` : "";
		fireRequest({
			requestType: "GET",
			url: `/api/telemetry/request/span/${hierarchySpanId}/heirarchy${qs}`,
		});
	}, [environment, fireRequest, hierarchySpanId, traceId]);

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
		if (isCodingAgent && supportsSpanEvents && !userPickedViewRef.current) {
			setViewMode("chat");
		}
	}, [isCodingAgent, supportsSpanEvents]);

	// If the active view is no longer available for this source, fall back.
	useEffect(() => {
		if (!availableViewModes.some((v) => v.key === viewMode)) {
			setViewMode("tree");
		}
	}, [availableViewModes, viewMode]);

	const spanCountLabel = isLoading
		? m.OBSERVABILITY_LOADING_SPANS
		: m.OBSERVABILITY_SPAN_COUNT(spanCount.toLocaleString());

	return (
		<section
			className={cn(
				"overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950",
				fill ? "flex h-full min-h-0" : "flex"
			)}
		>
			<SelectionBridge
				selectedSpanId={selectedSpanId}
				onSelectSpan={onSelectSpan}
			/>
			<nav
				aria-label={m.OBSERVABILITY_SPAN_HIERARCHY}
				className="flex w-9 shrink-0 flex-col items-center gap-0.5 border-r border-stone-200 bg-stone-50 py-1.5 dark:border-stone-800 dark:bg-stone-900"
			>
				{availableViewModes.map((mode) => {
					const selected = viewMode === mode.key;
					const label = m[mode.labelKey];
					return (
						<Tooltip key={mode.key} delayDuration={100}>
							<TooltipTrigger asChild>
								<button
									type="button"
									aria-label={label}
									aria-pressed={selected}
									onClick={() => {
										userPickedViewRef.current = true;
										setViewMode(mode.key);
									}}
									className={cn(
										"flex h-8 w-8 items-center justify-center rounded transition-colors",
										selected
											? "bg-primary text-white"
											: "text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
									)}
								>
									{mode.icon}
								</button>
							</TooltipTrigger>
							<TooltipContent side="right" sideOffset={6}>
								{label}
							</TooltipContent>
						</Tooltip>
					);
				})}
				<div className="mt-auto px-0.5 pb-0.5">
					<Tooltip delayDuration={100}>
						<TooltipTrigger asChild>
							<span className="block max-w-[2rem] truncate text-center text-[9px] font-medium tabular-nums text-stone-500 dark:text-stone-400">
								{isLoading ? "…" : spanCount.toLocaleString()}
							</span>
						</TooltipTrigger>
						<TooltipContent side="right" sideOffset={6}>
							{spanCountLabel}
						</TooltipContent>
					</Tooltip>
				</div>
			</nav>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
							"min-w-0 bg-stone-50/60 dark:bg-stone-950",
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
						{viewMode === "agentloop" && (
							<AgentLoopView record={record} onSelectSpan={onSelectSpan} />
						)}
						{viewMode === "analysis" && (
							<div className="h-full overflow-auto">
								<TraceAiAnalysisPanel spanId={hierarchySpanId} scope="trace" />
							</div>
						)}
						{viewMode === "governance" && (
							<div className="h-full overflow-auto">
								<TraceGovernancePanel
									hierarchySpanId={hierarchySpanId}
									traceId={traceId}
									onSelectSpan={onSelectSpan}
								/>
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
							{m.EVALUATION_STAT_TOTAL_COST}
						</span>
						<span className="font-mono text-xs font-semibold text-stone-900 dark:text-stone-100">
							${aggregateCost.toFixed(10)}
						</span>
					</div>
				)}
			</div>
		</section>
	);
}

export default function SpanHierarchyExplorer({
	hierarchySpanId,
	selectedSpanId,
	traceId,
	onSelectSpan,
	fill,
}: {
	hierarchySpanId: string;
	selectedSpanId: string;
	traceId?: string;
	onSelectSpan?: (spanId: string) => void;
	fill?: boolean;
}) {
	return (
		<RequestProvider syncUrl={false}>
			<SpanHierarchyExplorerInner
				hierarchySpanId={hierarchySpanId}
				selectedSpanId={selectedSpanId}
				traceId={traceId}
				onSelectSpan={onSelectSpan}
				fill={fill}
			/>
		</RequestProvider>
	);
}
