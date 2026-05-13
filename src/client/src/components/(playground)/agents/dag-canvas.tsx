"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

/**
 * Reusable SVG primitive that lays out and renders a directed acyclic graph
 * (nodes positioned by their `depth`, edges drawn as cubic curves).
 *
 * Used by:
 *  - The aggregated per-version DAG in the Overview tab (this file's
 *    primary consumer — `<AgentDag/>`).
 *
 * Single-trace DAGs continue to use the existing `<NodeGraph/>` in
 * components/(playground)/request/components/node-graph.tsx because that
 * surface needs span-selection wiring and execution-order layout
 * (parallel/sequential edge types) that the aggregate view does not.
 */

const NODE_W = 180;
const NODE_H = 56;
const COL_GAP = 240;
const ROW_GAP = 110;
const PAD = 48;
const ZOOM_STEP = 0.05;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3;

export type DagNodeKind = "span" | "tool";

export interface DagNodeInput {
	id: string;
	label: string;
	subLabel?: string;
	tooltip?: string;
	depth: number;
	highlight?: boolean;
	/** Visual variant. `tool` renders with an amber/wrench style. */
	kind?: DagNodeKind;
}

export interface DagEdgeInput {
	from: string;
	to: string;
	label?: string;
	tooltip?: string;
	weight?: number;
	highlight?: boolean;
}

interface DagCanvasProps {
	nodes: DagNodeInput[];
	edges: DagEdgeInput[];
	minHeightPx?: number;
	emptyMessage?: string;
	onNodeClick?: (id: string) => void;
}

interface LaidOutNode extends DagNodeInput {
	x: number;
	y: number;
}

function layout(
	nodes: DagNodeInput[],
	edges: DagEdgeInput[]
): LaidOutNode[] {
	const byDepth = new Map<number, DagNodeInput[]>();
	for (const n of nodes) {
		const arr = byDepth.get(n.depth) || [];
		arr.push(n);
		byDepth.set(n.depth, arr);
	}
	const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
	const laid: LaidOutNode[] = [];
	const posById = new Map<string, LaidOutNode>();

	// 1. Initial placement: stack nodes within a depth row.
	for (const depth of depths) {
		const cohort = byDepth.get(depth)!;
		// Sort stable by id so layout is deterministic between renders.
		cohort.sort((a, b) => a.id.localeCompare(b.id));
		cohort.forEach((n, i) => {
			const laidNode: LaidOutNode = {
				...n,
				x: depth * COL_GAP,
				y: i * ROW_GAP,
			};
			laid.push(laidNode);
			posById.set(laidNode.id, laidNode);
		});
	}

	// 2. Barycenter pass: walk depths from right to left and pull each parent
	// toward the median y of its children. Keeps the arrow geometry sane when
	// a node has children at very different rows (e.g. chat -> POST sibling
	// at row 0 plus chat -> tool:lookup_weather sibling at row 1) — without
	// this, the cubic edge to the lower child takes a sharp diagonal and the
	// label lands between rows.
	const childrenOf = new Map<string, string[]>();
	for (const e of edges) {
		if (!posById.has(e.from) || !posById.has(e.to)) continue;
		const list = childrenOf.get(e.from) || [];
		list.push(e.to);
		childrenOf.set(e.from, list);
	}
	for (let i = depths.length - 2; i >= 0; i--) {
		const cohort = byDepth.get(depths[i])!;
		for (const n of cohort) {
			const node = posById.get(n.id);
			if (!node) continue;
			const kids = (childrenOf.get(n.id) || [])
				.map((id) => posById.get(id))
				.filter((p): p is LaidOutNode => Boolean(p));
			if (kids.length === 0) continue;
			const ys = kids.map((k) => k.y).sort((a, b) => a - b);
			const mid = Math.floor(ys.length / 2);
			const median =
				ys.length % 2 === 1 ? ys[mid] : (ys[mid - 1] + ys[mid]) / 2;
			// Don't let two siblings collide: clamp toward median but stay at
			// least one row apart from peers in the same depth.
			node.y = median;
		}
		// Re-sort the cohort by computed y and re-stack to remove overlaps.
		cohort.sort((a, b) => {
			const aY = posById.get(a.id)?.y ?? 0;
			const bY = posById.get(b.id)?.y ?? 0;
			return aY - bY || a.id.localeCompare(b.id);
		});
		// Resolve overlaps: walk top-down and ensure ROW_GAP minimum spacing
		// while keeping the cohort's "anchor" at the barycenter midpoint.
		let cursor = -Infinity;
		for (const n of cohort) {
			const node = posById.get(n.id);
			if (!node) continue;
			node.y = Math.max(node.y, cursor);
			cursor = node.y + ROW_GAP;
		}
	}
	return laid;
}

function trunc(s: string, n: number): string {
	return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default function DagCanvas({
	nodes,
	edges,
	minHeightPx = 520,
	emptyMessage,
	onNodeClick,
}: DagCanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [panning, setPanning] = useState(false);
	const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 });

	const laidOut = useMemo(() => layout(nodes, edges), [nodes, edges]);
	const nodeById = useMemo(() => {
		const m = new Map<string, LaidOutNode>();
		for (const n of laidOut) m.set(n.id, n);
		return m;
	}, [laidOut]);

	const { svgW, svgH, ox, oy } = useMemo(() => {
		if (laidOut.length === 0) {
			return { svgW: 1, svgH: 1, ox: 0, oy: 0 };
		}
		const xs = laidOut.map((n) => n.x);
		const ys = laidOut.map((n) => n.y);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		return {
			svgW: maxX - minX + NODE_W + PAD * 2,
			svgH: maxY - minY + NODE_H + PAD * 2,
			ox: -minX + PAD,
			oy: -minY + PAD,
		};
	}, [laidOut]);

	const fitToView = useCallback(() => {
		const el = containerRef.current;
		if (!el) return;
		const { clientWidth: cw, clientHeight: ch } = el;
		if (!cw || !ch) return;
		const z = Math.max(
			MIN_ZOOM,
			Math.min(MAX_ZOOM, Math.min(cw / svgW, ch / svgH) * 0.92)
		);
		setPan({ x: (cw - svgW * z) / 2, y: (ch - svgH * z) / 2 });
		setZoom(z);
	}, [svgW, svgH]);

	useEffect(() => {
		const t = setTimeout(fitToView, 60);
		return () => clearTimeout(t);
	}, [fitToView]);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver(fitToView);
		ro.observe(el);
		return () => ro.disconnect();
	}, [fitToView]);

	const onWheel = useCallback(
		(e: React.WheelEvent) => {
			e.preventDefault();
			const el = containerRef.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			const mx = e.clientX - r.left;
			const my = e.clientY - r.top;
			const nz = Math.max(
				MIN_ZOOM,
				Math.min(MAX_ZOOM, zoom + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP))
			);
			const sc = nz / zoom;
			setPan((p) => ({ x: mx - sc * (mx - p.x), y: my - sc * (my - p.y) }));
			setZoom(nz);
		},
		[zoom]
	);

	const onMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (e.button !== 0) return;
			setPanning(true);
			dragStart.current = {
				mx: e.clientX,
				my: e.clientY,
				px: pan.x,
				py: pan.y,
			};
		},
		[pan]
	);

	const onMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (!panning) return;
			setPan({
				x: dragStart.current.px + e.clientX - dragStart.current.mx,
				y: dragStart.current.py + e.clientY - dragStart.current.my,
			});
		},
		[panning]
	);

	const onMouseUp = useCallback(() => setPanning(false), []);

	if (laidOut.length === 0) {
		return (
			<div
				className="flex items-center justify-center text-sm text-stone-500 dark:text-stone-400 border border-stone-200 dark:border-stone-800 rounded-md bg-white dark:bg-stone-950"
				style={{ minHeight: minHeightPx }}
			>
				{emptyMessage || "No graph data to display."}
			</div>
		);
	}

	return (
		<div
			className="relative w-full border border-stone-200 dark:border-stone-800 rounded-md overflow-hidden bg-white dark:bg-stone-950"
			style={{ minHeight: minHeightPx }}
		>
			<div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-white/90 dark:bg-stone-900/90 rounded-md border border-stone-200 dark:border-stone-700 p-0.5 shadow-sm">
				<button
					onClick={() =>
						setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))
					}
					className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-700"
					title="Zoom in"
				>
					<Plus className="h-3.5 w-3.5 text-stone-600 dark:text-stone-300" />
				</button>
				<span className="text-[10px] tabular-nums text-stone-500 dark:text-stone-400 min-w-[32px] text-center select-none">
					{Math.round(zoom * 100)}%
				</span>
				<button
					onClick={() =>
						setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))
					}
					className="p-1 rounded hover:bg-stone-100 dark:hover:bg-stone-700"
					title="Zoom out"
				>
					<Minus className="h-3.5 w-3.5 text-stone-600 dark:text-stone-300" />
				</button>
				<div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />
				<button
					onClick={fitToView}
					className="p-1 rounded hover:bg-primary/10"
					title="Fit to view"
				>
					<Maximize className="h-3.5 w-3.5 text-primary" />
				</button>
			</div>

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
					width={svgW}
					height={svgH}
					viewBox={`0 0 ${svgW} ${svgH}`}
					className="block"
					style={{
						transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
						transformOrigin: "0 0",
					}}
				>
					<defs>
						<marker
							id="dag-arrow"
							markerWidth="8"
							markerHeight="8"
							refX="7"
							refY="4"
							orient="auto"
						>
							<path d="M 0 1 L 7 4 L 0 7 Z" fill="#3b82f6" />
						</marker>
					</defs>

					{edges.map((edge, i) => {
						const fromNode = nodeById.get(edge.from);
						const toNode = nodeById.get(edge.to);
						if (!fromNode || !toNode) return null;
						const x1 = fromNode.x + ox + NODE_W;
						const y1 = fromNode.y + oy + NODE_H / 2;
						const x2 = toNode.x + ox;
						const y2 = toNode.y + oy + NODE_H / 2;
						// Directional control points: leave the parent horizontally
						// and enter the child horizontally. Eliminates the diagonal
						// "S" curve that shared-midX caused when |y2 - y1| > 0.
						const dx = Math.max(40, (x2 - x1) * 0.45);
						const cx1 = x1 + dx;
						const cx2 = x2 - dx;
						const weight = edge.weight ?? 1;
						const sw = Math.min(3, Math.max(0.8, 0.6 + Math.log10(weight + 1)));
						const stroke = edge.highlight ? "#6366f1" : "#3b82f6";

						// Sample the cubic at t=0.5 for a true mid-curve label
						// position: B(0.5) = (P0 + 3·P1 + 3·P2 + P3) / 8.
						const labelX = (x1 + 3 * cx1 + 3 * cx2 + x2) / 8;
						const labelY = (y1 + 3 * y1 + 3 * y2 + y2) / 8 - 6;

						return (
							<g key={`edge-${i}-${edge.from}-${edge.to}`}>
								<title>{edge.tooltip || edge.label || ""}</title>
								<path
									d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
									fill="none"
									stroke={stroke}
									strokeWidth={sw}
									markerEnd="url(#dag-arrow)"
									opacity={0.85}
								/>
								{edge.label && (
									<text
										x={labelX}
										y={labelY}
										textAnchor="middle"
										fontSize={10}
										className="fill-stone-600 dark:fill-stone-300"
									>
										{edge.label}
									</text>
								)}
							</g>
						);
					})}

					{laidOut.map((node) => {
						const nx = node.x + ox;
						const ny = node.y + oy;
						const isTool = node.kind === "tool";
						const stroke = node.highlight
							? "#6366f1"
							: isTool
								? "#c2410c"
								: "#0f766e";
						const fill = node.highlight
							? "rgba(99,102,241,0.10)"
							: isTool
								? "rgba(243,108,6,0.10)"
								: "rgba(15,118,110,0.06)";
						const labelPrefix = isTool ? "⚒ " : "";
						return (
							<g
								key={node.id}
								onClick={() => onNodeClick?.(node.id)}
								style={{ cursor: onNodeClick ? "pointer" : "default" }}
							>
								<title>{node.tooltip || node.label}</title>
								<rect
									x={nx}
									y={ny}
									width={NODE_W}
									height={NODE_H}
									rx={8}
									fill={fill}
									stroke={stroke}
									strokeWidth={1.6}
									strokeDasharray={isTool ? "5 3" : undefined}
								/>
								<text
									x={nx + NODE_W / 2}
									y={ny + 22}
									textAnchor="middle"
									fontSize={11}
									fontWeight={500}
									className="fill-stone-800 dark:fill-stone-200"
								>
									{labelPrefix}
									{trunc(node.label, isTool ? 24 : 26)}
								</text>
								{node.subLabel && (
									<text
										x={nx + NODE_W / 2}
										y={ny + 40}
										textAnchor="middle"
										fontSize={10}
										className="fill-stone-500 dark:fill-stone-400"
									>
										{trunc(node.subLabel, 32)}
									</text>
								)}
							</g>
						);
					})}
				</svg>
			</div>
		</div>
	);
}
