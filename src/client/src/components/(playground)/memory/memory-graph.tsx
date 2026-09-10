"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Minus, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import getMessage from "@/constants/messages";
import type {
	LaidOutMemoryNode,
	MemoryEntityType,
	MemoryGraphModel,
	MemoryKind,
} from "@/lib/platform/connectors/memory/graph";
import {
	MEMORY_ENTITY_TYPES,
	layoutMemoryGraph,
	radialEdgePoints,
} from "@/lib/platform/connectors/memory/graph";

const KIND_FILL: Record<MemoryKind, string> = {
	temporal: "#14b8a6",
	profile: "#f97316",
	summary: "#84cc16",
};

const ENTITY_FILL: Record<MemoryEntityType, string> = {
	entity: "#f472b6",
	event: "#818cf8",
	location: "#86efac",
	object: "#facc15",
	preference: "#c084fc",
	topic: "#fb923c",
	user: "#2dd4bf",
};

const WIDTH = 840;
const HEIGHT = 520;
const MIN_SPAN = 420;
const PAD = 88;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.6;

type MemoryGraphProps = {
	graph: MemoryGraphModel;
	selectedId?: string | null;
	onSelect?: (memoryId: string) => void;
};

export default function MemoryGraph({ graph, selectedId, onSelect }: MemoryGraphProps) {
	const messages = getMessage();
	const knowledge = graph.kind === "knowledge";
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
	const [query, setQuery] = useState("");
	const [entityFilter, setEntityFilter] = useState("all");
	const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
	const svgRef = useRef<SVGSVGElement | null>(null);
	const entityTypes = useMemo(() => {
		const present = new Set<MemoryEntityType>();
		for (const node of graph.nodes) {
			if (node.entityType) present.add(node.entityType);
		}
		return MEMORY_ENTITY_TYPES.filter((type) => present.has(type));
	}, [graph.nodes]);

	useEffect(() => {
		setCamera({ x: 0, y: 0, k: 1 });
		setQuery("");
		setEntityFilter("all");
	}, [graph]);

	useEffect(() => {
		const node = svgRef.current;
		if (!node) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			setCamera((current) => ({
				...current,
				k: clampZoom(current.k * (event.deltaY > 0 ? 0.92 : 1.08)),
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

	const search = query.trim().toLowerCase();
	const nodeVisible = (node: LaidOutMemoryNode) => {
		if (entityFilter !== "all" && node.entityType && node.entityType !== entityFilter) {
			return false;
		}
		if (!search) return true;
		return node.label.toLowerCase().includes(search);
	};

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

	const zoomBy = (factor: number) => {
		setCamera((current) => ({ ...current, k: clampZoom(current.k * factor) }));
	};

	return (
		<div className="relative h-full min-h-[280px] overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
			{knowledge ? (
				<div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
					<div className="relative">
						<Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={messages.MEMORY_GRAPH_SEARCH}
							className="h-7 w-[160px] bg-white/90 pl-7 text-xs dark:bg-stone-950/90"
						/>
					</div>
					{entityTypes.length > 1 ? (
						<Select value={entityFilter} onValueChange={setEntityFilter}>
							<SelectTrigger
								className="h-7 w-[108px] bg-white/90 text-xs dark:bg-stone-950/90"
								aria-label={messages.MEMORY_GRAPH_TYPE_FILTER}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">{messages.MEMORY_GRAPH_TYPE_ALL}</SelectItem>
								{entityTypes.map((type) => (
									<SelectItem key={type} value={type}>
										{entityTypeLabel(type, messages)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : null}
				</div>
			) : null}
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
						const selected = !!edge.memoryId && edge.memoryId === selectedId;
						const dimmed = knowledge && (!nodeVisible(from) || !nodeVisible(to));
						const points = knowledge
							? `${from.x},${from.y} ${to.x},${to.y}`
							: radialEdgePoints(from, to, origin)
									.map((point) => `${point.x},${point.y}`)
									.join(" ");
						return (
							<polyline
								key={`${edge.from}-${edge.to}-${index}`}
								fill="none"
								points={points}
								className={`cursor-pointer ${
									selected
										? "stroke-stone-900 dark:stroke-stone-100"
										: "stroke-stone-300 dark:stroke-stone-600"
								}`}
								strokeWidth={selected ? 2.2 : 1.35}
								strokeLinecap="round"
								strokeLinejoin="round"
								opacity={dimmed ? 0.12 : selected ? 1 : 0.85}
								onPointerDown={(event) => {
									if (!edge.memoryId) return;
									event.stopPropagation();
								}}
								onClick={(event) => {
									event.stopPropagation();
									if (edge.memoryId) onSelect?.(edge.memoryId);
								}}
							>
								<title>{edge.label || from.label}</title>
							</polyline>
						);
					})}
					{laidOut.map((node) => {
						const selected =
							(node.memoryId && node.memoryId === selectedId) ||
							graph.edges.some(
								(edge) =>
									edge.memoryId === selectedId &&
									(edge.from === node.id || edge.to === node.id)
							);
						const visible = !knowledge || nodeVisible(node);
						const fill = nodeFill(node);
						const radius =
							node.entityType === "user" || node.type === "user"
								? 13
								: node.type === "memory"
									? 9
									: node.type === "session"
										? 7
										: 8;
						return (
							<g
								key={node.id}
								transform={`translate(${node.x} ${node.y})`}
								className={node.memoryId ? "cursor-pointer" : "cursor-default"}
								filter={selected ? "url(#memory-node-glow)" : undefined}
								opacity={visible ? 1 : 0.12}
								role={node.memoryId ? "button" : undefined}
								tabIndex={node.memoryId ? 0 : undefined}
								onPointerDown={(event) => {
									if (!node.memoryId) return;
									event.stopPropagation();
								}}
								onClick={(event) => {
									event.stopPropagation();
									if (node.memoryId) onSelect?.(node.memoryId);
								}}
								onKeyDown={(event) => {
									if (!node.memoryId) return;
									if (event.key !== "Enter" && event.key !== " ") return;
									event.preventDefault();
									onSelect?.(node.memoryId);
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
								{node.type === "memory" && !knowledge ? (
									<polygon
										points={hexPoints(radius + (selected ? 1 : 0))}
										fill={fill}
										className="stroke-white dark:stroke-stone-950"
										strokeWidth={1.25}
									>
										<title>{node.label}</title>
									</polygon>
								) : (
									<circle
										r={radius}
										fill={fill}
										className="stroke-white dark:stroke-stone-950"
										strokeWidth={1.25}
									>
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
			<div className="absolute bottom-2 left-2 flex max-w-[70%] flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-white/90 px-2 py-1 text-[10px] text-stone-600 dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-300">
				<span className="uppercase tracking-wide">
					{knowledge ? messages.MEMORY_GRAPH_ENTITY_TYPES : messages.MEMORY_LEGEND}
				</span>
				{knowledge
					? (entityTypes.length ? entityTypes : MEMORY_ENTITY_TYPES).map((type) => (
							<LegendDot
								key={type}
								color={ENTITY_FILL[type]}
								label={entityTypeLabel(type, messages)}
							/>
						))
					: (
							<>
								<LegendDot color={KIND_FILL.temporal} label={messages.MEMORY_TEMPORAL} />
								<LegendDot color={KIND_FILL.profile} label={messages.MEMORY_PROFILE} />
								<LegendDot color={KIND_FILL.summary} label={messages.MEMORY_SUMMARY} />
							</>
						)}
			</div>
			<div className="absolute bottom-2 right-2 flex flex-col overflow-hidden rounded-md border border-stone-200 bg-white/90 dark:border-stone-700 dark:bg-stone-900/90">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 w-7 rounded-none p-0"
					onClick={() => zoomBy(1.15)}
					title={messages.MEMORY_GRAPH_ZOOM_IN}
				>
					<Plus className="h-3.5 w-3.5" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 w-7 rounded-none p-0"
					onClick={() => zoomBy(0.87)}
					title={messages.MEMORY_GRAPH_ZOOM_OUT}
				>
					<Minus className="h-3.5 w-3.5" />
				</Button>
			</div>
		</div>
	);
}

function clampZoom(value: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function nodeFill(node: LaidOutMemoryNode): string {
	if (node.entityType) return ENTITY_FILL[node.entityType];
	if (node.type === "memory") return KIND_FILL[node.kind || "summary"];
	if (node.type === "session") return "#a8a29e";
	return ENTITY_FILL.user;
}

function entityTypeLabel(
	type: MemoryEntityType,
	messages: ReturnType<typeof getMessage>
): string {
	if (type === "user") return messages.MEMORY_USER;
	if (type === "event") return messages.MEMORY_EVENT;
	if (type === "location") return messages.MEMORY_LOCATION;
	if (type === "object") return messages.MEMORY_OBJECT;
	if (type === "preference") return messages.MEMORY_PREFERENCE;
	if (type === "topic") return messages.MEMORY_TOPIC;
	return messages.MEMORY_ENTITY;
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
