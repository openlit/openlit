"use client";

/**
 * Graph View — DAG (Directed Acyclic Graph) visualization of span hierarchy.
 *
 * ## Sequencing logic
 *
 * Layout uses a bottom-up tree placement algorithm:
 * 1. Walk the hierarchy tree recursively; leaf spans are placed left-to-right
 *    in the order they appear (siblings are pre-sorted by Timestamp in
 *    buildHierarchy on the server).
 * 2. Each parent node is centered above its children.
 * 3. Y-axis represents tree depth (parent→child), X-axis spreads siblings.
 *
 * Edges between parent and child are classified as "parallel" or "sequential"
 * by checking whether sibling spans have overlapping time windows:
 *   - parallel: spanA.start < spanB.end AND spanB.start < spanA.end
 *   - sequential: no time overlap
 * Parallel edges are drawn as dashed indigo lines; sequential as solid gray.
 */

import { TraceHeirarchySpan } from "@/types/trace";
import { useRequest } from "../request-context";
import {
	getSpanDurationDisplay,
	getSpanCostFormatted,
	getSpanTooltipText,
} from "@/helpers/client/trace";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

const NODE_WIDTH = 160;
const NODE_HEIGHT = 52;
const H_GAP = 24;
const V_GAP = 48;

interface NodeLayout {
	span: TraceHeirarchySpan;
	x: number;
	y: number;
}

function getNodeStroke(durationNs: number, isSelected: boolean): string {
	if (isSelected) return "#6366f1";
	const seconds = durationNs * 1e-9;
	if (seconds > 10) return "#ef4444";
	if (seconds > 5) return "#eab308";
	if (seconds > 1) return "#3b82f6";
	return "#22c55e";
}

function getNodeFill(durationNs: number, isSelected: boolean): string {
	if (isSelected) return "rgba(99,102,241,0.08)";
	const seconds = durationNs * 1e-9;
	if (seconds > 10) return "rgba(239,68,68,0.06)";
	if (seconds > 5) return "rgba(234,179,8,0.06)";
	if (seconds > 1) return "rgba(59,130,246,0.06)";
	return "rgba(34,197,94,0.06)";
}

function parseTimestampMs(ts?: string): number | null {
	if (!ts) return null;
	const withZ = ts.endsWith("Z") ? ts : ts + "Z";
	const ms = new Date(withZ).getTime();
	return isNaN(ms) ? null : ms;
}

function classifySiblingRelationship(
	a: TraceHeirarchySpan,
	b: TraceHeirarchySpan
): "parallel" | "sequential" {
	const aStart = parseTimestampMs(a.Timestamp);
	const bStart = parseTimestampMs(b.Timestamp);
	if (aStart === null || bStart === null) return "sequential";
	const aDurMs = a.Duration / 1e6;
	const bDurMs = b.Duration / 1e6;
	const aEnd = aStart + aDurMs;
	const bEnd = bStart + bDurMs;
	return aStart < bEnd && bStart < aEnd ? "parallel" : "sequential";
}

function detectParallelPairs(root: TraceHeirarchySpan): Set<string> {
	const parallelPairs = new Set<string>();
	function walk(span: TraceHeirarchySpan) {
		if (span.children && span.children.length > 1) {
			for (let i = 0; i < span.children.length; i++) {
				for (let j = i + 1; j < span.children.length; j++) {
					if (
						classifySiblingRelationship(
							span.children[i],
							span.children[j]
						) === "parallel"
					) {
						parallelPairs.add(
							[span.children[i].SpanId, span.children[j].SpanId]
								.sort()
								.join("|")
						);
					}
				}
			}
		}
		span.children?.forEach(walk);
	}
	walk(root);
	return parallelPairs;
}

function isParallelSpan(
	span: TraceHeirarchySpan,
	siblings: TraceHeirarchySpan[],
	parallelPairs: Set<string>
): boolean {
	for (const sib of siblings) {
		if (sib.SpanId === span.SpanId) continue;
		const key = [span.SpanId, sib.SpanId].sort().join("|");
		if (parallelPairs.has(key)) return true;
	}
	return false;
}

function layoutTree(root: TraceHeirarchySpan): NodeLayout[] {
	const nodes: NodeLayout[] = [];
	let leafCounter = 0;

	function assignPositions(
		span: TraceHeirarchySpan,
		level: number
	): { centerX: number } {
		const y = level * (NODE_HEIGHT + V_GAP);
		if (!span.children || span.children.length === 0) {
			const x = leafCounter * (NODE_WIDTH + H_GAP);
			leafCounter++;
			nodes.push({ span, x, y });
			return { centerX: x + NODE_WIDTH / 2 };
		}
		const childCenters: number[] = [];
		for (const child of span.children) {
			const { centerX } = assignPositions(child, level + 1);
			childCenters.push(centerX);
		}
		const leftmost = childCenters[0];
		const rightmost = childCenters[childCenters.length - 1];
		const center = (leftmost + rightmost) / 2;
		nodes.push({ span, x: center - NODE_WIDTH / 2, y });
		return { centerX: center };
	}

	assignPositions(root, 0);
	return nodes;
}

function truncate(text: string, maxLen: number): string {
	return text.length > maxLen ? text.slice(0, maxLen - 1) + "\u2026" : text;
}

const ZOOM_STEP = 0.05;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3;

export default function NodeGraph({ record }: { record: TraceHeirarchySpan }) {
	const [request, updateRequest] = useRequest();
	const containerRef = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState(false);
	const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

	const nodes = layoutTree(record);
	const parallelPairs = detectParallelPairs(record);

	const nodeMap = new Map<string, NodeLayout>();
	for (const n of nodes) {
		nodeMap.set(n.span.SpanId, n);
	}

	const minX = Math.min(...nodes.map((n) => n.x));
	const maxX = Math.max(...nodes.map((n) => n.x + NODE_WIDTH));
	const maxY = Math.max(...nodes.map((n) => n.y + NODE_HEIGHT));
	const PADDING = 20;
	const svgWidth = maxX - minX + PADDING * 2;
	const svgHeight = maxY + PADDING * 2;
	const offsetX = -minX + PADDING;
	const offsetY = PADDING;

	const edges: {
		from: NodeLayout;
		to: NodeLayout;
		type: "parallel" | "sequential";
	}[] = [];
	function collectEdges(span: TraceHeirarchySpan) {
		const fromLayout = nodeMap.get(span.SpanId);
		if (!fromLayout) return;
		if (span.children) {
			const siblings = span.children;
			for (const child of span.children) {
				const toLayout = nodeMap.get(child.SpanId);
				if (toLayout) {
					edges.push({
						from: fromLayout,
						to: toLayout,
						type: isParallelSpan(child, siblings, parallelPairs)
							? "parallel"
							: "sequential",
					});
				}
				collectEdges(child);
			}
		}
	}
	collectEdges(record);

	const fitToView = useCallback(() => {
		if (!containerRef.current) return;
		const cw = containerRef.current.clientWidth;
		const ch = containerRef.current.clientHeight;
		if (cw === 0 || ch === 0) return;
		const scaleX = cw / svgWidth;
		const scaleY = ch / svgHeight;
		const newZoom = Math.max(
			MIN_ZOOM,
			Math.min(MAX_ZOOM, Math.min(scaleX, scaleY, 1) * 0.85)
		);
		const scaledW = svgWidth * newZoom;
		const scaledH = svgHeight * newZoom;
		setPan({
			x: (cw - scaledW) / 2,
			y: (ch - scaledH) / 2,
		});
		setZoom(newZoom);
	}, [svgWidth, svgHeight]);

	// Auto-fit on mount (key={record.SpanId} in parent ensures fresh mount)
	useEffect(() => {
		const timer = setTimeout(fitToView, 60);
		return () => clearTimeout(timer);
	}, [fitToView]);

	// Also re-fit when the container resizes (e.g. panel drag)
	useEffect(() => {
		if (!containerRef.current) return;
		const ro = new ResizeObserver(() => fitToView());
		ro.observe(containerRef.current);
		return () => ro.disconnect();
	}, [fitToView]);

	const handleWheel = useCallback(
		(e: React.WheelEvent) => {
			e.preventDefault();
			if (!containerRef.current) return;
			const rect = containerRef.current.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;
			const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
			const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));
			const scale = newZoom / zoom;
			setPan((p) => ({
				x: mouseX - scale * (mouseX - p.x),
				y: mouseY - scale * (mouseY - p.y),
			}));
			setZoom(newZoom);
		},
		[zoom]
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (e.button !== 0) return;
			setIsPanning(true);
			panStart.current = {
				x: e.clientX,
				y: e.clientY,
				panX: pan.x,
				panY: pan.y,
			};
		},
		[pan]
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (!isPanning) return;
			setPan({
				x: panStart.current.panX + (e.clientX - panStart.current.x),
				y: panStart.current.panY + (e.clientY - panStart.current.y),
			});
		},
		[isPanning]
	);

	const handleMouseUp = useCallback(() => setIsPanning(false), []);

	return (
		<div className="relative flex-1 w-full min-h-0 h-full">
			{/* Controls — top-right */}
			<div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-white/90 dark:bg-stone-900/90 rounded-md border border-stone-200 dark:border-stone-700 p-0.5 shadow-sm">
				<button
					onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
					className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
					title="Zoom in"
				>
					<Plus className="h-3.5 w-3.5 text-stone-600 dark:text-stone-300" />
				</button>
				<span className="text-[10px] tabular-nums text-stone-500 dark:text-stone-400 min-w-[32px] text-center select-none">
					{Math.round(zoom * 100)}%
				</span>
				<button
					onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
					className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
					title="Zoom out"
				>
					<Minus className="h-3.5 w-3.5 text-stone-600 dark:text-stone-300" />
				</button>
				<div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />
				<button
					onClick={fitToView}
					className="p-1 rounded hover:bg-primary/10 transition-colors"
					title="Fit to view"
				>
					<Maximize className="h-3.5 w-3.5 text-primary" />
				</button>
			</div>

			{/* Legend — bottom-left, above the canvas */}
			<div className="absolute bottom-2 left-2 z-20 flex items-center gap-3 text-[10px] text-stone-500 dark:text-stone-400 bg-white/90 dark:bg-stone-900/90 rounded px-2 py-1 border border-stone-200 dark:border-stone-700 shadow-sm">
				<span className="flex items-center gap-1">
					<svg width="16" height="6">
						<line
							x1="0"
							y1="3"
							x2="16"
							y2="3"
							stroke="#6366f1"
							strokeWidth="1.5"
							strokeDasharray="4 2"
						/>
					</svg>
					Parallel
				</span>
				<span className="flex items-center gap-1">
					<svg width="16" height="6">
						<line
							x1="0"
							y1="3"
							x2="16"
							y2="3"
							stroke="rgba(120,113,108,0.5)"
							strokeWidth="1.5"
						/>
					</svg>
					Sequential
				</span>
			</div>

			{/* Pan/zoom canvas — fills all available space */}
			<div
				ref={containerRef}
				className="absolute inset-0"
				style={{ cursor: isPanning ? "grabbing" : "grab" }}
				onWheel={handleWheel}
				onMouseDown={handleMouseDown}
				onMouseMove={handleMouseMove}
				onMouseUp={handleMouseUp}
				onMouseLeave={handleMouseUp}
			>
				<svg
					width={svgWidth}
					height={svgHeight}
					viewBox={`0 0 ${svgWidth} ${svgHeight}`}
					className="block"
					style={{
						transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
						transformOrigin: "0 0",
					}}
				>
					{/* Edges */}
					{edges.map(({ from, to, type }, i) => {
						const x1 = from.x + offsetX + NODE_WIDTH / 2;
						const y1 = from.y + offsetY + NODE_HEIGHT;
						const x2 = to.x + offsetX + NODE_WIDTH / 2;
						const y2 = to.y + offsetY;
						const midY = (y1 + y2) / 2;
						const isParallel = type === "parallel";
						return (
							<path
								key={i}
								d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
								fill="none"
								stroke={
									isParallel
										? "#6366f1"
										: "rgba(120,113,108,0.5)"
								}
								strokeWidth={1.5}
								strokeDasharray={isParallel ? "6 3" : undefined}
							/>
						);
					})}

					{/* Edge labels */}
					{edges.map(({ from, to, type }, i) => {
						const x1 = from.x + offsetX + NODE_WIDTH / 2;
						const y1 = from.y + offsetY + NODE_HEIGHT;
						const x2 = to.x + offsetX + NODE_WIDTH / 2;
						const y2 = to.y + offsetY;
						const isParallel = type === "parallel";
						return (
							<text
								key={`label-${i}`}
								x={(x1 + x2) / 2 + 8}
								y={(y1 + y2) / 2}
								fontSize={8}
								fill={
									isParallel
										? "#6366f1"
										: "rgba(120,113,108,0.6)"
								}
								textAnchor="start"
								dominantBaseline="middle"
							>
								{isParallel ? "parallel" : "seq"}
							</text>
						);
					})}

					{/* Nodes */}
					{nodes.map(({ span, x, y }) => {
						const isSelected =
							request?.spanId === span.SpanId;
						const nx = x + offsetX;
						const ny = y + offsetY;
						const stroke = getNodeStroke(
							span.Duration,
							isSelected
						);
						const fill = getNodeFill(
							span.Duration,
							isSelected
						);
						const durationDisplay =
							getSpanDurationDisplay(span);
						const costDisplay = getSpanCostFormatted(
							span,
							10
						);
						const tooltipText = getSpanTooltipText(span);

						return (
							<g
								key={span.SpanId}
								onClick={(e) => {
									e.stopPropagation();
									updateRequest({
										spanId: span.SpanId,
									});
								}}
								style={{ cursor: "pointer" }}
							>
								<title>{tooltipText}</title>
								<rect
									x={nx}
									y={ny}
									width={NODE_WIDTH}
									height={NODE_HEIGHT}
									rx={6}
									fill={fill}
									stroke={stroke}
									strokeWidth={
										isSelected ? 2 : 1.5
									}
								/>
								<text
									x={nx + NODE_WIDTH / 2}
									y={ny + 18}
									textAnchor="middle"
									fontSize={10}
									fontWeight={
										isSelected ? 600 : 400
									}
									fill={
										isSelected
											? "#6366f1"
											: "currentColor"
									}
									className="fill-stone-700 dark:fill-stone-300"
								>
									{truncate(span.SpanName, 20)}
								</text>
								<text
									x={nx + NODE_WIDTH / 2}
									y={ny + 34}
									textAnchor="middle"
									fontSize={9}
									fill={stroke}
									opacity={0.9}
								>
									{costDisplay
										? `${durationDisplay} \u2022 ${costDisplay}`
										: durationDisplay}
								</text>
							</g>
						);
					})}
				</svg>
			</div>
		</div>
	);
}
