import { useRequest } from "./request-context";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FolderTree, DollarSign, ListTree, GanttChart, Network, MessageSquare } from "lucide-react";
import { findSpanInHierarchyLodash } from "@/helpers/client/trace";
import { TraceHeirarchySpan } from "@/types/trace";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import TimelineView from "./components/timeline-view";
import NodeGraph from "./components/node-graph";
import TreeNode from "./components/tree-node";
import ChatView from "./components/chat-view";

type ViewMode = "tree" | "timeline" | "graph" | "chat";

function sumCostRecursive(span: TraceHeirarchySpan): number {
	const cost = span.Cost != null && span.Cost > 0 ? span.Cost : 0;
	const childrenCost = (span.children || []).reduce((acc, c) => acc + sumCostRecursive(c), 0);
	return cost + childrenCost;
}

const DEFAULT_WIDTH = 46;

const VIEW_TABS: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
	{ mode: "tree", icon: <ListTree className="h-4 w-4" />, label: "Tree" },
	{ mode: "timeline", icon: <GanttChart className="h-4 w-4" />, label: "Timeline" },
	{ mode: "graph", icon: <Network className="h-4 w-4" />, label: "Graph" },
	{ mode: "chat", icon: <MessageSquare className="h-4 w-4" />, label: "Chat" },
];

export default function HeirarchyDisplay() {
	const [request] = useRequest();
	const { data, fireRequest, isLoading } = useFetchWrapper();
	const [accordionValue, setAccordionValue] = useState("");
	const [viewMode, setViewMode] = useState<ViewMode>("tree");
	const lastFetchedSpanId = useRef<string | null>(null);

	useEffect(() => {
		if (!isLoading) {
			setAccordionValue("debug");
		}
	}, [isLoading]);

	const typedData =
		(data as { record: TraceHeirarchySpan; err?: string }) || {};

	const spanId = request?.spanId;

	useEffect(() => {
		if (!spanId || isLoading) return;

		if (lastFetchedSpanId.current === spanId) return;

		if (
			typedData.record?.SpanId &&
			findSpanInHierarchyLodash(typedData.record, spanId)
		) {
			return;
		}

		lastFetchedSpanId.current = spanId;
		fireRequest({
			requestType: "GET",
			url: `/api/metrics/request/span/${spanId}/heirarchy`,
			failureCb: (err?: string) => {
				toast.error(err || `Cannot connect to server!`, {
					id: "heirarchy-fetch",
				});
			},
		});
	}, [spanId, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

	const { record } = typedData;
	const aggregateCost = useMemo(() => (record ? sumCostRecursive(record) : 0), [record]);

	if (isLoading || typedData.err || !record || !record.SpanId) {
		return null;
	}

	return (
		<ResizeablePanel
			defaultWidth={accordionValue ? 450 : DEFAULT_WIDTH}
			minWidth={DEFAULT_WIDTH}
			maxWidth={700}
			handlePosition="left"
			className="absolute left-0 top-0 -translate-x-full h-full bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-t-0 shadow-lg"
		>
			<Accordion type="single" collapsible className="flex flex-1 h-full" value={accordionValue}>
				<AccordionItem value="debug" className="border-0 flex flex-1 w-full">
					{/* ── Left rail: toggle + view mode icons ── */}
					<div className="flex flex-col items-center border-r border-stone-200 dark:border-stone-800 shrink-0">
						{/* Accordion toggle area */}
						<AccordionTrigger
							className="flex flex-col items-center gap-3 px-3 py-4 hover:no-underline hover:bg-stone-100 dark:hover:bg-stone-900 [&[data-state=open]]:bg-stone-100 dark:[&[data-state=open]]:bg-stone-900/50 [&[data-state=open]>svg]:rotate-90 [&[data-state=closed]>svg]:rotate-[-90deg] transition-colors"
							onClick={() => setAccordionValue(accordionValue === "debug" ? "" : "debug")}
						>
							<div className="flex flex-col items-center gap-2">
								<FolderTree className="h-4.5 w-4.5 text-stone-600 dark:text-stone-400" />
								<span className="text-xs font-semibold [writing-mode:vertical-lr] rotate-180 transform text-stone-700 dark:text-stone-300">
									Span Hierarchy
								</span>
								{isLoading && (
									<div className="w-5 h-5 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
								)}
							</div>
						</AccordionTrigger>

						{/* View mode switcher — bottom of rail */}
						<div className="flex flex-col items-center gap-1 mt-auto px-1.5 py-3 border-t border-stone-200 dark:border-stone-800">
							{VIEW_TABS.map(({ mode, icon, label }) => (
								<Tooltip key={mode} delayDuration={0}>
									<TooltipTrigger asChild>
										<button
											onClick={() => setViewMode(mode)}
											className={`p-1.5 rounded transition-colors ${
												viewMode === mode
													? "bg-primary/15 text-primary"
													: "text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800"
											}`}
										>
											{icon}
										</button>
									</TooltipTrigger>
									<TooltipContent side="right" sideOffset={4}>
										{label}
									</TooltipContent>
								</Tooltip>
							))}
						</div>
					</div>

					{/* ── Main content area ── */}
					<AccordionContent className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down transition-all h-full pb-0" parentClassName="h-full w-full">
						<div className="flex flex-col h-full">
							{/* Header */}
							<div className="px-3 pt-2 pb-1.5 shrink-0 border-b border-stone-200 dark:border-stone-800">
								<h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
									Trace Execution Flow
								</h3>
								<p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
									Click spans to view details
								</p>
							</div>

							{/* Content */}
							<div className={`flex-1 min-h-0 ${viewMode === "graph" ? "flex flex-col" : "overflow-auto"}`}>
								{viewMode === "tree" && (
									<div className="p-3 min-w-fit overflow-auto h-full">
										<TreeNode span={record} level={0} />
									</div>
								)}
								{viewMode === "timeline" && (
									<div className="p-3 min-w-fit overflow-auto h-full">
										<TimelineView record={record} />
									</div>
								)}
								{viewMode === "graph" && (
									<NodeGraph key={record.SpanId} record={record} />
								)}
								{viewMode === "chat" && (
									<div className="overflow-auto h-full">
										<ChatView record={record} />
									</div>
								)}
							</div>

							{/* Aggregate cost footer */}
							{aggregateCost > 0 && (
								<div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50">
									<DollarSign className="h-3.5 w-3.5 text-stone-500 dark:text-stone-400" />
									<span className="text-xs font-medium text-stone-600 dark:text-stone-400">
										Total cost:
									</span>
									<span className="text-xs font-semibold text-stone-800 dark:text-stone-200">
										${aggregateCost.toFixed(10)}
									</span>
								</div>
							)}
						</div>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</ResizeablePanel>
	);
}
