import { useRequest } from "./request-context";

import React, { useEffect, useMemo, useState } from "react";
import { FolderTree, DollarSign, ListTree, GanttChart, Network } from "lucide-react";
import { findSpanInHierarchyLodash } from "@/helpers/client/trace";
import { TraceHeirarchySpan } from "@/types/trace";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import TimelineView from "./components/timeline-view";
import NodeGraph from "./components/node-graph";
import TreeNode from "./components/tree-node";

type ViewMode = "tree" | "timeline" | "graph";

function sumCostRecursive(span: TraceHeirarchySpan): number {
	const cost = span.Cost != null && span.Cost > 0 ? span.Cost : 0;
	const childrenCost = (span.children || []).reduce((acc, c) => acc + sumCostRecursive(c), 0);
	return cost + childrenCost;
}

const DEFAULT_WIDTH = 46;

const VIEW_TABS: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
	{ mode: "tree", icon: <ListTree className="h-3.5 w-3.5" />, label: "Tree" },
	{ mode: "timeline", icon: <GanttChart className="h-3.5 w-3.5" />, label: "Timeline" },
	{ mode: "graph", icon: <Network className="h-3.5 w-3.5" />, label: "Graph" },
];

export default function HeirarchyDisplay() {
	const [request] = useRequest();
	const { data, fireRequest, isLoading, error } = useFetchWrapper();
	const [accordionValue, setAccordionValue] = useState("");
	const [viewMode, setViewMode] = useState<ViewMode>("tree");

	useEffect(() => {
		if (!isLoading) {
			setAccordionValue("debug");
		}
	}, [isLoading]);

	const typedData =
		(data as { record: TraceHeirarchySpan; err?: string }) || {};

	useEffect(() => {
		if (
			!error &&
			!findSpanInHierarchyLodash(typedData.record || {}, request?.spanId) &&
			request?.spanId &&
			!isLoading
		) {
			fireRequest({
				requestType: "GET",
				url: `/api/metrics/request/span/${request?.spanId}/heirarchy`,
				failureCb: (err?: string) => {
					toast.error(err || `Cannot connect to server!`, {
						id: "heirarchy-fetch",
					});
				},
			});
		}
	}, [request, typedData, isLoading, error]);

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
			className="absolute left-0 top-0 -translate-x-full h-full bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-t-0  shadow-lg"
		>
			<Accordion type="single" collapsible className="flex flex-1 h-full" value={accordionValue}>
				<AccordionItem value="debug" className="border-0 flex flex-1 w-full">
					<AccordionTrigger
						className="flex flex-col items-center gap-3 px-3 py-6 hover:no-underline hover:bg-stone-100 dark:hover:bg-stone-900 [&[data-state=open]]:bg-stone-100 dark:[&[data-state=open]]:bg-stone-900/50 [&[data-state=open]>svg]:rotate-90 [&[data-state=closed]>svg]:rotate-[-90deg] border-r border-stone-200 dark:border-stone-800 transition-colors"
						onClick={() => setAccordionValue(accordionValue === "debug" ? "" : "debug")}
					>
						<div className="flex flex-col items-center gap-3">
							<FolderTree className="h-5 w-5 text-stone-600 dark:text-stone-400" />
							<span className="text-sm font-semibold [writing-mode:vertical-lr] rotate-180 transform text-stone-700 dark:text-stone-300">
								Span Hierarchy
							</span>
							{isLoading && (
								<div className="flex flex-col items-center gap-1">
									<div className="w-6 h-6 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
									<span className="text-xs text-stone-500 [writing-mode:vertical-lr] rotate-180">
										Loading...
									</span>
								</div>
							)}
						</div>
					</AccordionTrigger>
					<AccordionContent className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down transition-all h-full pb-0" parentClassName="h-full w-full">
						<div className="flex flex-col h-full">
							{/* View mode tab strip */}
							<div className="flex items-center gap-1 px-3 py-2 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 shrink-0">
								{VIEW_TABS.map(({ mode, icon, label }) => (
									<button
										key={mode}
										onClick={() => setViewMode(mode)}
										className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
											viewMode === mode
												? "bg-primary/10 text-primary dark:bg-primary/10 dark:text-primary"
												: "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800"
										}`}
									>
										{icon}
										{label}
									</button>
								))}
							</div>

							{/* Header */}
							<div className="px-3 pt-2 pb-1 shrink-0 border-b border-stone-200 dark:border-stone-800">
								<h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
									Trace Execution Flow
								</h3>
								<p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
									Click spans to view details
								</p>
							</div>

							{/* Content */}
							<div className="flex-1 min-h-0 overflow-auto">
								<div className="p-3 min-w-fit">
									{viewMode === "tree" && <TreeNode span={record} level={0} />}
									{viewMode === "timeline" && <TimelineView record={record} />}
									{viewMode === "graph" && <NodeGraph record={record} />}
								</div>
							</div>

							{/* Aggregate cost footer */}
							{aggregateCost > 0 && (
								<div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50">
									<DollarSign className="h-3.5 w-3.5 text-stone-500 dark:text-stone-400" />
									<span className="text-xs font-medium text-stone-600 dark:text-stone-400">
										Total cost:
									</span>
									<span className="text-xs font-semibold text-stone-800 dark:text-stone-200">
										${aggregateCost.toFixed(6)}
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
