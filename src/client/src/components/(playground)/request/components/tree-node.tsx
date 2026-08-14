"use client";

import { useState } from "react";
import { useRequest } from "../request-context";
import { Zap, Clock, Activity, ChevronRight } from "lucide-react";
import { getSpanDurationDisplay, getSpanTooltipText } from "@/helpers/client/trace";
import { TraceHeirarchySpan } from "@/types/trace";

const INDENT = 28;
const NODE_HEIGHT = 40;
const NODE_CENTER = NODE_HEIGHT / 2;

interface TreeNodeProps {
	span: TraceHeirarchySpan;
	level: number;
	isLast?: boolean;
	parentPath?: boolean[];
}

function CurvedConnector({ isLast }: { isLast: boolean }) {
	return (
		<svg
			className="absolute pointer-events-none text-stone-400 dark:text-stone-600"
			style={{
				left: -INDENT,
				top: 0,
				width: INDENT + 4,
				overflow: "visible",
			}}
			height={isLast ? NODE_CENTER + 2 : "100%"}
			preserveAspectRatio="none"
		>
			{/* Vertical line down (for non-last siblings) */}
			{!isLast && (
				<line
					x1="6"
					y1="0"
					x2="6"
					y2="100%"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			)}
			{/* Curved elbow: vertical down → curve right → horizontal to node */}
			<path
				d={`M 6,0 L 6,${NODE_CENTER - 8} Q 6,${NODE_CENTER} 14,${NODE_CENTER} L ${INDENT},${NODE_CENTER}`}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</svg>
	);
}

export default function TreeNode({ span, level, isLast = false, parentPath = [] }: TreeNodeProps) {
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

	const durationDisplay = getSpanDurationDisplay(span);
	const tooltipText = getSpanTooltipText(span);

	const getSpanTypeIcon = (spanName: string) => {
		if (spanName.includes("browser_action")) return <Activity className="h-3.5 w-3.5" />;
		if (spanName.includes("model_request")) return <Zap className="h-3.5 w-3.5" />;
		if (spanName.includes("execute_task")) return <Clock className="h-3.5 w-3.5" />;
		return <Zap className="h-3.5 w-3.5" />;
	};

	const getTimingColor = () => {
		const time = parseFloat(durationDisplay);
		if (time > 10) return "text-red-600 dark:text-red-400";
		if (time > 5) return "text-yellow-600 dark:text-yellow-400";
		if (time > 1) return "text-blue-600 dark:text-blue-400";
		return "text-green-600 dark:text-green-400";
	};

	return (
		<div className="relative">
			{level > 0 && <CurvedConnector isLast={isLast} />}

			{/* Node row */}
			<div
				className="flex items-center gap-2 cursor-pointer max-w-md"
				style={{ minHeight: NODE_HEIGHT }}
				onClick={onClick}
				title={tooltipText}
			>
				{hasChildren ? (
					<button
						onClick={toggleExpanded}
						className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${isSelected
								? "bg-primary/20 text-primary"
								: "bg-stone-200/80 dark:bg-stone-700/80 text-stone-500 dark:text-stone-400 hover:bg-stone-300/80 dark:hover:bg-stone-600/80"
							}`}
						aria-label={isExpanded ? "Collapse" : "Expand"}
					>
						<ChevronRight
							className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
						/>
					</button>
				) : (
					<div className="flex h-6 w-6 shrink-0 items-center justify-center">
						<div className="h-2 w-2 rounded-full bg-stone-400 dark:bg-stone-500" />
					</div>
				)}

				<div
					className={`flex flex-1 min-w-0 items-center gap-3 rounded-md px-2 py-1.5 transition-colors ${isSelected
							? "bg-primary/[0.08] dark:bg-primary/[0.08] text-primary dark:text-primary"
							: "hover:bg-stone-200/50 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"
						}`}
				>
					<div
						className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${isSelected
								? "bg-primary/20 text-primary"
								: "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400"
							}`}
					>
						{getSpanTypeIcon(span.SpanName)}
					</div>
					<span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm min-w-0">
						{span.SpanName}
					</span>
					<span className={`shrink-0 text-sm ${getTimingColor()}`}>
						{durationDisplay}
					</span>
				</div>
			</div>

			{/* Children */}
			{hasChildren && isExpanded && (
				<div className="relative" style={{ marginLeft: INDENT }}>
					{span?.children!.map((child, index) => (
						<TreeNode
							key={child.SpanId}
							span={child}
							level={level + 1}
							isLast={index === span.children!.length - 1}
							parentPath={[...parentPath, !isLast]}
						/>
					))}
				</div>
			)}
		</div>
	);
}
