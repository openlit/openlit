import { useRequest } from "./request-context";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FolderTree, DollarSign } from "lucide-react";
import { findSpanInHierarchyLodash } from "@/helpers/client/trace";
import { TraceHeirarchySpan } from "@/types/trace";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
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

const VIEW_TABS: { mode: ViewMode; label: string }[] = [
	{ mode: "tree", label: "Tree" },
	{ mode: "chat", label: "Chat" },
	{ mode: "timeline", label: "Timeline" },
	{ mode: "graph", label: "Graph" },
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
					{/* ── Left rail: accordion toggle only ── */}
					<AccordionTrigger
						className="flex flex-col items-center gap-3 px-3 py-4 hover:no-underline hover:bg-stone-100 dark:hover:bg-stone-900 [&[data-state=open]]:bg-stone-100 dark:[&[data-state=open]]:bg-stone-900/50 [&[data-state=open]>svg]:rotate-90 [&[data-state=closed]>svg]:rotate-[-90deg] border-r border-stone-200 dark:border-stone-800 transition-colors shrink-0"
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

					{/* ── Main content area ── */}
					<AccordionContent className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down transition-all h-full pb-0" parentClassName="h-full w-full">
						<div className="flex flex-col h-full">
							{/* View mode tabs — horizontal at the top */}
							<div className="flex items-center gap-1 px-3 py-1.5 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 shrink-0 z-10">
								{VIEW_TABS.map(({ mode, label }) => (
									<button
										key={mode}
										onClick={() => setViewMode(mode)}
										className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
											viewMode === mode
												? "bg-primary/10 text-primary"
												: "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800"
										}`}
									>
										{label}
									</button>
								))}
							</div>

							{/* Content */}
							<div className={`flex-1 min-h-0 ${viewMode === "graph" ? "flex flex-col" : "overflow-auto"}`}>
								{viewMode === "tree" && (
									<div className="p-3 min-w-fit overflow-auto h-full">
										<TreeNode span={record} level={0} />
									</div>
								)}
								{viewMode === "chat" && (
									<div className="overflow-auto h-full">
										<ChatView record={record} />
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
