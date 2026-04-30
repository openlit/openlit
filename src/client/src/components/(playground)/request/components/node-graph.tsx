"use client";

/**
 * Graph view for the span hierarchy.
 *
 * The transform creates three edge kinds:
 * - SEQUENTIAL: parent enters first child, or one execution wave follows another.
 * - PARALLEL: two sibling spans overlap in time.
 * - DELEGATED: supported as a fallback structural edge.
 *
 * Y position is execution order. X position is hierarchy indentation, with
 * parallel spans spread into temporary side-by-side lanes.
 */

import { TraceHeirarchySpan } from "@/types/trace";
import { useRequest } from "../request-context";
import {
	getSpanDurationDisplay,
	getSpanCostFormatted,
	getSpanTooltipText,
} from "@/helpers/client/trace";
import { transformTracesToGraph } from "@/lib/platform/graph-transform";
import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

const NODE_W = 160;
const NODE_H = 52;
const ZOOM_STEP = 0.05;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3;

function nodeStroke(ns: number, sel: boolean): string {
	if (sel) return "#6366f1";
	const s = ns * 1e-9;
	if (s > 10) return "#ef4444";
	if (s > 5) return "#eab308";
	if (s > 1) return "#3b82f6";
	return "#22c55e";
}

function nodeFill(ns: number, sel: boolean): string {
	if (sel) return "rgba(99,102,241,0.09)";
	const s = ns * 1e-9;
	if (s > 10) return "rgba(239,68,68,0.06)";
	if (s > 5) return "rgba(234,179,8,0.06)";
	if (s > 1) return "rgba(59,130,246,0.06)";
	return "rgba(34,197,94,0.06)";
}

function trunc(s: string, n: number): string {
	return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default function NodeGraph({ record }: { record: TraceHeirarchySpan }) {
	const [request, updateRequest] = useRequest();
	const containerRef = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [panning, setPanning] = useState(false);
	const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

	const graph = useMemo(() => transformTracesToGraph(record), [record]);
	const nodeById = useMemo(() => graph.nodes, [graph.nodes]);
	const seqMarkerId = useMemo(
		() => `arr-seq-${record.SpanId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
		[record.SpanId]
	);

	const PAD = 40;
	const xs = Array.from(nodeById.values()).map(n => n.x);
	const ys = Array.from(nodeById.values()).map(n => n.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const svgW = (maxX - minX) + NODE_W + PAD * 2;
	const svgH = (maxY - minY) + NODE_H + PAD * 2;
	const ox = -minX + PAD;
	const oy = -minY + PAD;

	const fitToView = useCallback(() => {
		const el = containerRef.current;
		if (!el) return;
		const { clientWidth: cw, clientHeight: ch } = el;
		if (!cw || !ch) return;
		const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(cw / svgW, ch / svgH) * 0.9));
		setPan({ x: (cw - svgW * z) / 2, y: (ch - svgH * z) / 2 });
		setZoom(z);
	}, [svgW, svgH]);

	useEffect(() => { const t = setTimeout(fitToView, 60); return () => clearTimeout(t); }, [fitToView]);
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver(fitToView);
		ro.observe(el);
		return () => ro.disconnect();
	}, [fitToView]);

	const onWheel = useCallback((e: React.WheelEvent) => {
		e.preventDefault();
		const el = containerRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		const mx = e.clientX - r.left;
		const my = e.clientY - r.top;
		const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP)));
		const sc = nz / zoom;
		setPan(p => ({ x: mx - sc * (mx - p.x), y: my - sc * (my - p.y) }));
		setZoom(nz);
	}, [zoom]);

	const onMouseDown = useCallback((e: React.MouseEvent) => {
		if (e.button !== 0) return;
		setPanning(true);
		dragStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
	}, [pan]);

	const onMouseMove = useCallback((e: React.MouseEvent) => {
		if (!panning) return;
		setPan({ x: dragStart.current.px + e.clientX - dragStart.current.mx, y: dragStart.current.py + e.clientY - dragStart.current.my });
	}, [panning]);

	const onMouseUp = useCallback(() => setPanning(false), []);

	return (
		<div className="relative flex-1 w-full min-h-0 h-full">

			{/* Zoom controls */}
			<div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-white/90 dark:bg-stone-900/90 rounded-md border border-stone-200 dark:border-stone-700 p-0.5 shadow-sm">
				<button onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP))} className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-700" title="Zoom in"><Plus className="h-3.5 w-3.5 text-stone-600 dark:text-stone-300" /></button>
				<span className="text-[10px] tabular-nums text-stone-500 dark:text-stone-400 min-w-[32px] text-center select-none">{Math.round(zoom * 100)}%</span>
				<button onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP))} className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-700" title="Zoom out"><Minus className="h-3.5 w-3.5 text-stone-600 dark:text-stone-300" /></button>
				<div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />
				<button onClick={fitToView} className="p-1 rounded hover:bg-primary/10" title="Fit to view"><Maximize className="h-3.5 w-3.5 text-primary" /></button>
			</div>

			{/* Legend */}
			<div className="absolute bottom-2 left-2 z-20 flex flex-col gap-1.5 text-[10px] text-stone-500 dark:text-stone-400 bg-white/90 dark:bg-stone-900/90 rounded px-2.5 py-2 border border-stone-200 dark:border-stone-700 shadow-sm">
				<div className="font-semibold text-stone-700 dark:text-stone-300 mb-0.5">Edge Types</div>
				<span className="flex items-center gap-2">
					<svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#3b82f6" strokeWidth="1.5" /></svg>
					Sequential
				</span>
				<span className="flex items-center gap-2">
					<svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#6366f1" strokeWidth="1.5" strokeDasharray="5 3" /></svg>
					Parallel
				</span>
			</div>

			{/* Canvas */}
			<div
				ref={containerRef}
				className="absolute inset-0"
				style={{ cursor: panning ? "grabbing" : "grab" }}
				onWheel={onWheel}
				onMouseDown={onMouseDown}
				onMouseMove={onMouseMove}
				onMouseUp={onMouseUp}
				onMouseLeave={onMouseUp}
			>
				<svg
					width={svgW} height={svgH}
					viewBox={`0 0 ${svgW} ${svgH}`}
					className="block"
					style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
				>
					<defs>
						<marker id={seqMarkerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
							<path d="M 0 1 L 7 4 L 0 7 Z" fill="#3b82f6" />
						</marker>
					</defs>

					{graph.edges.map((edge, i) => {
						const fromNode = nodeById.get(edge.from);
						const toNode = nodeById.get(edge.to);
						if (!fromNode || !toNode) return null;

						const isSeq = edge.kind === "SEQUENTIAL";
						const isPar = edge.kind === "PARALLEL";
						const isDelegate = edge.kind === "DELEGATED";

						const stroke = isDelegate ? "rgba(156,163,175,0.75)" : isSeq ? "#3b82f6" : "#6366f1";
						const dash = isPar ? "6 3" : undefined;
						const marker = isSeq ? `url(#${seqMarkerId})` : undefined;

						if (!isPar) {
							const x1 = fromNode.x + ox + NODE_W / 2;
							const y1 = fromNode.y + oy + NODE_H;
							const x2 = toNode.x + ox + NODE_W / 2;
							const y2 = toNode.y + oy;
							const midY = (y1 + y2) / 2;

							return (
								<path key={`e${i}`}
									d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
									fill="none"
									stroke={stroke}
									strokeWidth={isDelegate ? 1 : 1.5}
									markerEnd={marker}
									opacity={isDelegate ? 0.72 : 0.88}
								/>
							);
						}

						const leftToRight = fromNode.x <= toNode.x;
						const x1 = fromNode.x + ox + (leftToRight ? NODE_W : 0);
						const x2 = toNode.x + ox + (leftToRight ? 0 : NODE_W);
						const y1 = fromNode.y + oy + NODE_H / 2;
						const y2 = toNode.y + oy + NODE_H / 2;
						const midX = (x1 + x2) / 2;

						return (
							<path key={`e${i}`}
								d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
								fill="none"
								stroke={stroke}
								strokeWidth={1.4}
								strokeDasharray={dash}
								opacity={0.55}
							/>
						);
					})}

					{Array.from(nodeById.values()).map(node => {
						const sel = request?.spanId === node.spanId;
						const nx = node.x + ox;
						const ny = node.y + oy;
						const str = nodeStroke(node.duration, sel);
						const fil = nodeFill(node.duration, sel);
						const displaySpan = {
							SpanId: node.spanId,
							SpanName: node.spanName,
							Duration: node.duration,
							Timestamp: node.timestamp,
							Cost: node.cost,
						};
						const dur = getSpanDurationDisplay(displaySpan);
						const cost = getSpanCostFormatted(displaySpan, 4);
						const tooltipText = getSpanTooltipText(displaySpan);

						return (
							<g key={node.spanId}
								onClick={e => { e.stopPropagation(); updateRequest({ spanId: node.spanId }); }}
								style={{ cursor: "pointer" }}
							>
								<title>{tooltipText}</title>

								<rect x={nx} y={ny} width={NODE_W} height={NODE_H} rx={6}
									fill={fil} stroke={str} strokeWidth={sel ? 2 : 1.5} />

								<text x={nx + NODE_W / 2} y={ny + 18}
									textAnchor="middle" fontSize={10}
									fontWeight={sel ? 600 : 400}
									fill={sel ? "#6366f1" : "currentColor"}
									className="fill-stone-700 dark:fill-stone-300"
								>
									{trunc(node.spanName, 20)}
								</text>

								<text x={nx + NODE_W / 2} y={ny + 34}
									textAnchor="middle" fontSize={9}
									fill={str} opacity={0.85}
								>
									{cost ? `${dur} • ${cost}` : dur}
								</text>
							</g>
						);
					})}
				</svg>
			</div>
		</div>
	);
}
