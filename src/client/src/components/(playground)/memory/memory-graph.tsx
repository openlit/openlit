"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import getMessage from "@/constants/messages";
import type {
	LaidOutMemoryNode,
	MemoryGraphModel,
	MemoryKind,
} from "@/lib/platform/connectors/memory/graph";
import { layoutMemoryGraph, radialEdgePoints } from "@/lib/platform/connectors/memory/graph";

const KIND_FILL: Record<MemoryKind, string> = {
	temporal: "#14b8a6",
	profile: "#f97316",
	summary: "#84cc16",
};

const WIDTH = 840;
const HEIGHT = 520;
const MIN_SPAN = 420;
const PAD = 88;

type MemoryGraphProps = {
	graph: MemoryGraphModel;
	selectedId?: string | null;
	onSelect?: (memoryId: string) => void;
};

export default function MemoryGraph({ graph, selectedId, onSelect }: MemoryGraphProps) {
	const messages = getMessage();
	const laidOut = useMemo(() => layoutMemoryGraph(graph, WIDTH, HEIGHT), [graph]);
	const nodeById = useMemo(() => {
		const map = new Map<string, LaidOutMemoryNode>();
		for (const node of laidOut) map.set(node.id, node);
		return map;
	}, [laidOut]);
	const origin = useMemo(() => {
		const users = laidOut.filter((node) => node.type === "user");
		if (users.length === 1) return { x: users[0].x, y: users[0].y };
		return { x: WIDTH / 2, y: HEIGHT / 2 };
	}, [laidOut]);
	const [camera, setCamera] = useState({ x: 0, y: 0, k: 1 });
	const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
	const svgRef = useRef<SVGSVGElement | null>(null);

	useEffect(() => {
		setCamera({ x: 0, y: 0, k: 1 });
	}, [graph]);

	useEffect(() => {
		const node = svgRef.current;
		if (!node) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			setCamera((current) => ({
				...current,
				k: Math.min(2.4, Math.max(0.55, current.k * (event.deltaY > 0 ? 0.92 : 1.08))),
			}));
		};
		node.addEventListener("wheel", onWheel, { passive: false });
		return () => node.removeEventListener("wheel", onWheel);
	}, [laidOut.length]);

	const viewBox = useMemo(() => {
		if (!laidOut.length) return { minX: 0, minY: 0, width: WIDTH, height: HEIGHT };
		const xs = laidOut.map((node) => node.x);
		const ys = laidOut.map((node) => node.y);
		let minX = Math.min(...xs) - PAD;
		let maxX = Math.max(...xs) + PAD;
		let minY = Math.min(...ys) - PAD;
		let maxY = Math.max(...ys) + PAD;
		if (maxX - minX < MIN_SPAN) {
			const extra = (MIN_SPAN - (maxX - minX)) / 2;
			minX -= extra;
			maxX += extra;
		}
		if (maxY - minY < MIN_SPAN) {
			const extra = (MIN_SPAN - (maxY - minY)) / 2;
			minY -= extra;
			maxY += extra;
		}
		return { minX, minY, width: maxX - minX, height: maxY - minY };
	}, [laidOut]);

	if (laidOut.length === 0) {
		return (
			<div className="flex h-full min-h-[280px] items-center justify-center rounded-md border border-stone-200 bg-white text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400">
				{messages.MEMORY_GRAPH_EMPTY}
			</div>
		);
	}

	const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
	};

	const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
		if (!drag.current) return;
		const scale = viewBox.width / Math.max(event.currentTarget.clientWidth, 1);
		setCamera({
			...camera,
			x: drag.current.cx + (event.clientX - drag.current.x) * scale,
			y: drag.current.cy + (event.clientY - drag.current.y) * scale,
		});
	};

	const onPointerUp = () => {
		drag.current = null;
	};

	return (
		<div className="relative h-full min-h-[280px] overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
			<svg
				ref={svgRef}
				viewBox={`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`}
				className="h-full w-full cursor-grab active:cursor-grabbing"
				role="img"
				aria-label={messages.MEMORY_GRAPH_TITLE}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
			>
				<defs>
					<filter id="memory-node-glow" x="-50%" y="-50%" width="200%" height="200%">
						<feGaussianBlur stdDeviation="3.5" result="blur" />
						<feMerge>
							<feMergeNode in="blur" />
							<feMergeNode in="SourceGraphic" />
						</feMerge>
					</filter>
				</defs>
				<g transform={`translate(${camera.x} ${camera.y}) scale(${camera.k})`}>
					{graph.edges.map((edge, index) => {
						const from = nodeById.get(edge.from);
						const to = nodeById.get(edge.to);
						if (!from || !to) return null;
						const points = radialEdgePoints(from, to, origin);
						return (
							<polyline
								key={`${edge.from}-${edge.to}-${index}`}
								fill="none"
								points={points.map((point) => `${point.x},${point.y}`).join(" ")}
								className="stroke-stone-300 dark:stroke-stone-600"
								strokeWidth={1.4}
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						);
					})}
					{laidOut.map((node) => {
						const selected = node.memoryId && node.memoryId === selectedId;
						const fill =
							node.type === "memory"
								? KIND_FILL[node.kind || "summary"]
								: node.type === "session"
									? "#a8a29e"
									: "#57534e";
						const radius = node.type === "memory" ? 9 : node.type === "session" ? 7 : 11;
						return (
							<g
								key={node.id}
								transform={`translate(${node.x} ${node.y})`}
								className={node.memoryId ? "cursor-pointer" : "cursor-default"}
								filter={selected ? "url(#memory-node-glow)" : undefined}
								onClick={(event) => {
									event.stopPropagation();
									if (node.memoryId) onSelect?.(node.memoryId);
								}}
							>
								{selected ? (
									<circle
										r={radius + 7}
										fill="none"
										className="stroke-stone-900 dark:stroke-stone-100"
										strokeWidth={1.5}
									/>
								) : null}
								{node.type === "memory" ? (
									<polygon
										points={hexPoints(radius + (selected ? 1 : 0))}
										fill={fill}
										className="stroke-white dark:stroke-stone-950"
										strokeWidth={1.25}
									>
										<title>{node.label}</title>
									</polygon>
								) : (
									<circle r={radius} fill={fill} className="stroke-white dark:stroke-stone-950" strokeWidth={1.25}>
										<title>{node.label}</title>
									</circle>
								)}
								<text
									y={radius + 14}
									textAnchor="middle"
									className="fill-stone-600 dark:fill-stone-300"
									fontSize={9}
								>
									{truncateLabel(node.label)}
								</text>
							</g>
						);
					})}
				</g>
			</svg>
			<div className="absolute bottom-2 left-2 flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-white/90 px-2 py-1 text-[10px] text-stone-600 dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-300">
				<span className="uppercase tracking-wide">{messages.MEMORY_LEGEND}</span>
				<LegendDot color={KIND_FILL.temporal} label={messages.MEMORY_TEMPORAL} />
				<LegendDot color={KIND_FILL.profile} label={messages.MEMORY_PROFILE} />
				<LegendDot color={KIND_FILL.summary} label={messages.MEMORY_SUMMARY} />
			</div>
		</div>
	);
}

function truncateLabel(label: string): string {
	return label.length > 18 ? `${label.slice(0, 16).trimEnd()}…` : label;
}

function hexPoints(radius: number): string {
	return Array.from({ length: 6 }, (_, index) => {
		const angle = (Math.PI / 3) * index - Math.PI / 6;
		return `${radius * Math.cos(angle)},${radius * Math.sin(angle)}`;
	}).join(" ");
}

function LegendDot({ color, label }: { color: string; label: string }) {
	return (
		<span className="inline-flex items-center gap-1">
			<span className="size-2 rounded-full" style={{ backgroundColor: color }} />
			{label}
		</span>
	);
}
