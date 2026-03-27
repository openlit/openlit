"use client";

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
	if (isSelected) return "#6366f1"; // primary
	const seconds = durationNs * 1e-9;
	if (seconds > 10) return "#ef4444"; // red
	if (seconds > 5) return "#eab308"; // yellow
	if (seconds > 1) return "#3b82f6"; // blue
	return "#22c55e"; // green
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

/** Detect whether sibling spans are parallel (overlapping in time) or sequential */
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
	// Overlapping if one starts before the other ends
	const overlap = aStart < bEnd && bStart < aEnd;
	return overlap ? "parallel" : "sequential";
}

/** Build a set of SpanId pairs that are parallel siblings */
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

/** Check if a span has any parallel sibling */
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
		const x = center - NODE_WIDTH / 2;

		nodes.push({ span, x, y });
		return { centerX: center };
	}

	assignPositions(root, 0);
	return nodes;
}

function truncate(text: string, maxLen: number): string {
	return text.length > maxLen ? text.slice(0, maxLen - 1) + "\u2026" : text;
}

const ZOOM_STEP = 0.15;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;

export default function NodeGraph({ record }: { record: TraceHeirarchySpan }) {
	const [request, updateRequest] = useRequest();
	const containerRef = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState(false);
	const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
	const [hasFitted, setHasFitted] = useState(false);

	const nodes = layoutTree(record);
	const parallelPairs = detectParallelPairs(record);

	// Build parent->children map for sibling lookups
	const childrenMap = new Map<string, TraceHeirarchySpan[]>();
	function buildChildrenMap(span: TraceHeirarchySpan) {
		if (span.children && span.children.length > 0) {
			childrenMap.set(
				span.SpanId,
				span.children
			);
			span.children.forEach(buildChildrenMap);
		}
	}
	buildChildrenMap(record);

	// Build a map for edge drawing
	const nodeMap = new Map<string, NodeLayout>();
	for (const n of nodes) {
		nodeMap.set(n.span.SpanId, n);
	}

	// Compute canvas dimensions
	const minX = Math.min(...nodes.map((n) => n.x));
	const maxX = Math.max(...nodes.map((n) => n.x + NODE_WIDTH));
	const maxY = Math.max(...nodes.map((n) => n.y + NODE_HEIGHT));
	const PADDING = 20;
	const svgWidth = maxX - minX + PADDING * 2;
	const svgHeight = maxY + PADDING * 2;
	const offsetX = -minX + PADDING;
	const offsetY = PADDING;

	// Build edges with parallel/sequential classification
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
					const isParallel = isParallelSpan(
						child,
						siblings,
						parallelPairs
					);
					edges.push({
						from: fromLayout,
						to: toLayout,
						type: isParallel ? "parallel" : "sequential",
					});
				}
				collectEdges(child);
			}
		}
	}
	collectEdges(record);

	// Fit to window on first render
	const fitToWindow = useCallback(() => {
		if (!containerRef.current) return;
		const container = containerRef.current;
		const cw = container.clientWidth;
		const ch = container.clientHeight;
		if (cw === 0 || ch === 0) return;
		const scaleX = cw / svgWidth;
		const scaleY = ch / svgHeight;
		const newZoom = Math.min(scaleX, scaleY, 1) * 0.9; // 90% to add some margin
		const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
		const scaledW = svgWidth * clampedZoom;
		const scaledH = svgHeight * clampedZoom;
		setPan({
			x: (cw - scaledW) / 2,
			y: (ch - scaledH) / 2,
		});
		setZoom(clampedZoom);
	}, [svgWidth, svgHeight]);

	useEffect(() => {
		if (!hasFitted && containerRef.current) {
			fitToWindow();
			setHasFitted(true);
		}
	}, [hasFitted, fitToWindow]);

	// Mouse wheel zoom
	const handleWheel = useCallback(
		(e: React.WheelEvent) => {
			e.preventDefault();
			const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
			setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)));
		},
		[]
	);

	// Pan handlers
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
			const dx = e.clientX - panStart.current.x;
			const dy = e.clientY - panStart.current.y;
			setPan({
				x: panStart.current.panX + dx,
				y: panStart.current.panY + dy,
			});
		},
		[isPanning]
	);

	const handleMouseUp = useCallback(() => {
		setIsPanning(false);
	}, []);

	const zoomIn = () =>
		setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
	const zoomOut = () =>
		setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));

	return (
		<div className="relative w-full h-full min-h-[300px]">
			{/* Zoom controls */}
			<div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
				<button
					onClick={zoomIn}
					className="p-1 rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
					title="Zoom in"
				>
					<Plus className="h-3.5 w-3.5 text-stone-600 dark:text-stone-300" />
				</button>
				<button
					onClick={zoomOut}
					className="p-1 rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
					title="Zoom out"
				>
					<Minus className="h-3.5 w-3.5 text-stone-600 dark:text-stone-300" />
				</button>
				<button
					onClick={fitToWindow}
					className="p-1 rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
					title="Fit to window"
				>
					<Maximize className="h-3.5 w-3.5 text-stone-600 dark:text-stone-300" />
				</button>
			</div>

			{/* Legend */}
			<div className="absolute bottom-2 left-2 z-10 flex items-center gap-3 text-[10px] text-stone-500 dark:text-stone-400 bg-white/80 dark:bg-stone-900/80 rounded px-2 py-1 border border-stone-200 dark:border-stone-700">
				<span className="flex items-center gap-1">
					<svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
					Parallel
				</span>
				<span className="flex items-center gap-1">
					<svg width="16" height="6"><line x1="0" y1="3" x2="16" y2="3" stroke="rgba(120,113,108,0.5)" strokeWidth="1.5" /></svg>
					Sequential
				</span>
				<span className="tabular-nums">{Math.round(zoom * 100)}%</span>
			</div>

			{/* Pan/zoom canvas */}
			<div
				ref={containerRef}
				className="w-full h-full overflow-hidden"
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
						const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
						const isParallel = type === "parallel";
						return (
							<path
								key={i}
								d={d}
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

					{/* Parallel/sequential group labels on edges */}
					{edges.map(({ from, to, type }, i) => {
						const x1 = from.x + offsetX + NODE_WIDTH / 2;
						const y1 = from.y + offsetY + NODE_HEIGHT;
						const x2 = to.x + offsetX + NODE_WIDTH / 2;
						const y2 = to.y + offsetY;
						const midX = (x1 + x2) / 2;
						const midY = (y1 + y2) / 2;
						const isParallel = type === "parallel";
						return (
							<text
								key={`label-${i}`}
								x={midX + 8}
								y={midY}
								fontSize={8}
								fill={isParallel ? "#6366f1" : "rgba(120,113,108,0.6)"}
								textAnchor="start"
								dominantBaseline="middle"
							>
								{isParallel ? "parallel" : "seq"}
							</text>
						);
					})}

					{/* Nodes */}
					{nodes.map(({ span, x, y }) => {
						const isSelected = request?.spanId === span.SpanId;
						const nx = x + offsetX;
						const ny = y + offsetY;
						const stroke = getNodeStroke(span.Duration, isSelected);
						const fill = getNodeFill(span.Duration, isSelected);
						const durationDisplay = getSpanDurationDisplay(span);
						const costDisplay = getSpanCostFormatted(span, 10);
						const tooltipText = getSpanTooltipText(span);

						return (
							<g
								key={span.SpanId}
								onClick={(e) => {
									e.stopPropagation();
									updateRequest({ spanId: span.SpanId });
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
									strokeWidth={isSelected ? 2 : 1.5}
								/>
								<text
									x={nx + NODE_WIDTH / 2}
									y={ny + 18}
									textAnchor="middle"
									fontSize={10}
									fontWeight={isSelected ? 600 : 400}
									fill={isSelected ? "#6366f1" : "currentColor"}
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
