import { useRequest } from "./request-context";

import React, { useEffect, useState } from "react";
import { FolderTree, Zap, Clock, Activity, Minus, Plus, ListTree, GanttChart, Network } from "lucide-react";
import {
	findSpanInHierarchyLodash,
	getNormalizedTraceAttribute,
} from "@/helpers/client/trace";
import { TraceHeirarchySpan } from "@/types/trace";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { TraceMapping } from "@/constants/traces";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ResizeablePanel } from "@/components/ui/resizeable-panel";
import TimelineView from "./components/timeline-view";
import NodeGraph from "./components/node-graph";

type ViewMode = "tree" | "timeline" | "graph";

interface TreeNodeProps {
	span: TraceHeirarchySpan;
	level: number;
	isLast?: boolean;
	parentPath?: boolean[];
}

export function TreeNode({ span, level, isLast = false, parentPath = [] }: TreeNodeProps) {
	const [request, updateRequest] = useRequest();
	const [isExpanded, setIsExpanded] = useState(true);
	const hasChildren = span.children && span.children.length > 0;
	const isSelected = request?.spanId === span.SpanId;

	const onClick = () => {
		if (request?.spanId !== span.SpanId) {
			updateRequest({
				spanId: span.SpanId,
			});
		}
	};

	const toggleExpanded = (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsExpanded(!isExpanded);
	};

	const duration = parseFloat(
		getNormalizedTraceAttribute("requestDuration", span.Duration) as string
	).toFixed(2);

	const getSpanTypeIcon = (spanName: string) => {
		if (spanName.includes('browser_action')) return <Activity className="h-3.5 w-3.5" />;
		if (spanName.includes('model_request')) return <Zap className="h-3.5 w-3.5" />;
		if (spanName.includes('execute_task')) return <Clock className="h-3.5 w-3.5" />;
		return <Zap className="h-3.5 w-3.5" />;
	};

	const getTimingColor = () => {
		const time = parseFloat(duration);
		if (time > 10) return "text-red-600 dark:text-red-400";
		if (time > 5) return "text-yellow-600 dark:text-yellow-400";
		if (time > 1) return "text-blue-600 dark:text-blue-400";
		return "text-green-600 dark:text-green-400";
	};

	const CONNECTION_LINES_CLASSES = "absolute left-3 bg-stone-400 dark:bg-stone-700"

	return (
		<div className="relative">
			{/* Connection lines */}
			{/* {level > 0 && renderConnectionLines()} */}
			<div className="absolute left-0 top-0 bottom-0 flex">
				{parentPath.map((showLine, index) => (
					<div key={index} className="w-6 relative">
						{showLine && (
							<div className={`${CONNECTION_LINES_CLASSES} top-0 bottom-0 w-px`} />
						)}
					</div>
				))}

				{level > 0 && (
					<div className="w-6 relative">
						{/* Vertical line */}
						<div className={`${CONNECTION_LINES_CLASSES} top-0 h-6 w-px`} />
						{/* Horizontal line */}
						<div className={`${CONNECTION_LINES_CLASSES} top-6 w-3 h-px`} />
						{/* Corner connector for non-last items */}
						{!isLast && (
							<div className={`${CONNECTION_LINES_CLASSES} top-6 bottom-0 w-px`} />
						)}
					</div>
				)}
			</div>

			{/* Node content */}
			<div
				className={`flex items-center gap-3 py-2 pr-4 rounded-md transition-colors cursor-pointer group ${level === 0 ? 'ml-0' : `ml-${(level + 1) * 6}`
					}
				 ${isSelected
						? "bg-primary/[0.05] dark:bg-primary/[0.05] text-primary dark:text-primary"
						: "hover:bg-stone-200/[0.5] dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"
					}
				`}
				style={{ marginLeft: level > 0 ? `${(level + 1) * 24}px` : '0' }}
				onClick={onClick}
				title={span.SpanName}
			>
				{/* Expand/collapse button for parents */}
				{hasChildren && (
					<button
						onClick={toggleExpanded}
						className={`flex items-center justify-center w-5 h-5 rounded border
							 ${isSelected
								? "text-primary/[0.5] dark:text-primary/[0.5] border-primary/[0.5] dark:border-primary/[0.5]"
								: "text-stone-400 dark:text-stone-700 border-stone-400 dark:border-stone-800 "
							}
							`}
						aria-label={isExpanded ? 'Collapse' : 'Expand'}
					>
						{isExpanded ? (
							<Minus className="w-3 h-3" />
						) : (
							<Plus className="w-3 h-3" />
						)}
					</button>
				)}

				{/* Icon */}
				<div className={`flex items-center justify-center w-6 h-6 rounded
					 ${isSelected
						? "bg-primary/[0.2] dark:bg-primary/[0.2] text-primary dark:text-primary"
						: "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400"
					}`}>
					{getSpanTypeIcon(span.SpanName)}
				</div>

				{/* Title */}
				<span className={`text-sm flex-1 overflow-hidden text-ellipsis whitespace-nowrap`}>
					{span.SpanName}
				</span>

				{/* Timing */}
				<span className={`text-sm ${getTimingColor()}`}>
					{duration}{TraceMapping.requestDuration.valueSuffix}
				</span>
			</div>

			{/* Children */}
			{hasChildren && isExpanded && (
				<div className="relative">
					{span?.children!.map((child, index) => {
						const isLastChild = index === span.children!.length - 1;

						return (
							<TreeNode
								key={child.SpanId}
								span={child}
								level={level + 1}
								isLast={isLastChild}
								parentPath={[...parentPath, !isLast]}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
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
						</div>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</ResizeablePanel>
	);
}
