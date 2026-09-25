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
	MemoryEdgeTier,
	MemoryEntityType,
	MemoryGraphEdge,
	MemoryGraphModel,
	MemoryKind,
} from "@/lib/platform/connectors/memory/graph";
import {
	MEMORY_EDGE_TIERS,
	MEMORY_EDGE_TIER_MINIMUM,
	MEMORY_ENTITY_TYPES,
	layoutMemoryGraph,
	memoryClusterColor,
	memoryEdgeDashPattern,
	memoryEdgeTier,
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

const STRENGTH_FILTERS = ["all", "faint", "weak", "medium", "strong"] as const;

type StrengthFilter = (typeof STRENGTH_FILTERS)[number];

/**
 * Connection styling ported from the MemCode dashboard so the same edge reads
 * the same in both products: colour and dash by tier, thickness and opacity
 * from `edgeVisualProps`. Strong is solid blue, medium dashed white, weak and
 * faint dashed red.
 */
const EDGE_TIER_COLOR: Record<MemoryEdgeTier, string> = {
	strong: "#3B82F6",
	medium: "#FFFFFF",
	weak: "#FF4D5E",
	faint: "#FF4D5E",
};

function edgeTierStroke(tier: MemoryEdgeTier, weight: number) {
	if (tier === "strong") {
		return { opacity: 0.48 + weight * 0.28, width: 1.45 + weight * 0.7 };
	}
	if (tier === "medium") {
		return { opacity: 0.34 + weight * 0.24, width: 1.05 + weight * 0.4 };
	}
	// Weak connections stay legible at the fitted overview zoom; selection may
	// emphasise them but is never required to find them.
	return { opacity: 0.57 + weight * 0.27, width: 1.35 + weight * 0.5 };
}

/** Dark canvas from the dashboard: white and red edges need it to read. */
const CONSTELLATION_BG = "#0f1419";
const CONSTELLATION_NODE_FILL = "#0D2034";
const CONSTELLATION_ACCENT = "#3B73B8";
const CONSTELLATION_NODE_SIZE = 36;

function mixHex(base: string, tint: string, amount: number): string {
	const parse = (hex: string) => [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
	const [br, bg, bb] = parse(base);
	const [tr, tg, tb] = parse(tint);
	const channel = (from: number, to: number) =>
		Math.round(from + (to - from) * amount)
			.toString(16)
			.padStart(2, "0");
	return `#${channel(br, tr)}${channel(bg, tg)}${channel(bb, tb)}`;
}

const WIDTH = 840;
const HEIGHT = 520;
const MIN_SPAN = 420;
const PAD = 88;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 16;

type MemoryGraphProps = {
	graph: MemoryGraphModel;
	selectedId?: string | null;
	onSelect?: (memoryId: string) => void;
};

export default function MemoryGraph({ graph, selectedId, onSelect }: MemoryGraphProps) {
	const messages = getMessage();
	const knowledge = graph.kind === "knowledge";
	// Only backends that score their connections (MemCode today) can be tiered;
	// everything else keeps the flat edges it has always drawn.
	const weighted = graph.weighted === true;
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
	const [strengthFilter, setStrengthFilter] = useState<StrengthFilter>("all");
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
		setStrengthFilter("all");
	}, [graph]);

	// At constellation scale most labels are unreadable and only cost DOM. The
	// dashboard draws a bare square below a size threshold; the SVG equivalent is
	// to label the memories a connection actually points at.
	const connectedIds = useMemo(() => {
		if (!weighted) return null;
		const ids = new Set<string>();
		for (const edge of graph.edges) {
			ids.add(edge.from);
			ids.add(edge.to);
		}
		return ids;
	}, [graph.edges, weighted]);

	const visibleEdges = useMemo(() => {
		if (!weighted || strengthFilter === "all") return graph.edges;
		const minimum = MEMORY_EDGE_TIER_MINIMUM[strengthFilter];
		return graph.edges.filter(
			(edge) => typeof edge.weight === "number" && edge.weight >= minimum
		);
	}, [graph.edges, strengthFilter, weighted]);

	useEffect(() => {
		const node = svgRef.current;
		if (!node) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			setCamera((current) => ({
				...current,
				k: clampZoom(current.k * (event.deltaY > 0 ? 0.88 : 1.14)),
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
		<div
			className="relative h-full min-h-[280px] overflow-hidden rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
			style={
				weighted
					? { backgroundColor: CONSTELLATION_BG, borderColor: "#1f2933" }
					: undefined
			}
		>
			{knowledge ? (
				<div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
					<div className="relative">
						<Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={messages.MEMORY_GRAPH_SEARCH}
							className={`h-7 w-[160px] pl-7 text-xs ${
								weighted
									? "border-[#2A2F36] bg-[#1a1f29]/90 text-[#e2e8f0] placeholder:text-[#64748b]"
									: "bg-white/90 dark:bg-stone-950/90"
							}`}
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
					{weighted ? (
						<Select
							value={strengthFilter}
							onValueChange={(value) => setStrengthFilter(value as StrengthFilter)}
						>
							<SelectTrigger
								className={`h-7 w-[176px] text-xs ${
									weighted
										? "border-[#2A2F36] bg-[#1a1f29]/90 text-[#e2e8f0]"
										: "bg-white/90 dark:bg-stone-950/90"
								}`}
								aria-label={messages.MEMORY_GRAPH_STRENGTH_FILTER}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent
								className={
									weighted
										? "border-[#2A2F36] bg-[#1a1f29] text-[#e2e8f0]"
										: undefined
								}
							>
								{STRENGTH_FILTERS.map((tier) => (
									<SelectItem
										key={tier}
										value={tier}
										className={
											weighted
												? "text-[#e2e8f0] focus:bg-[#243044] focus:text-white"
												: undefined
										}
									>
										{strengthLabel(tier, messages)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : null}
				</div>
			) : null}
			{weighted ? (
				<div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[55%] truncate rounded bg-[#1a1f29]/85 px-2 py-1 text-[11px] text-[#94a3b8]">
					{messages.MEMORY_GRAPH_COUNTS(graph.nodes.length, visibleEdges.length)}
					{graph.truncated ? ` · ${messages.MEMORY_GRAPH_TRUNCATED(graph.nodes.length)}` : ""}
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
					{visibleEdges.map((edge, index) => {
						const from = nodeById.get(edge.from);
						const to = nodeById.get(edge.to);
						if (!from || !to) return null;
						const selected = edgeTouchesSelection(edge, selectedId);
						const dimmed = knowledge && (!nodeVisible(from) || !nodeVisible(to));
						const points = knowledge
							? `${from.x},${from.y} ${to.x},${to.y}`
							: radialEdgePoints(from, to, origin)
									.map((point) => `${point.x},${point.y}`)
									.join(" ");
						// A scored edge takes its tier's colour, dash and weight; an
						// unscored one keeps the flat stroke every other connector draws.
						const tier = weighted ? memoryEdgeTier(edge.weight) : null;
						const stroke = tier
							? edgeTierStroke(tier, edge.weight ?? 0)
							: null;
						const target = edge.memoryId || (weighted ? edge.to : undefined);
						return (
							<polyline
								key={`${edge.from}-${edge.to}-${index}`}
								fill="none"
								points={points}
								className={
									tier
										? "cursor-pointer"
										: `cursor-pointer ${
												selected
													? "stroke-stone-900 dark:stroke-stone-100"
													: "stroke-stone-300 dark:stroke-stone-600"
											}`
								}
								stroke={
									tier
										? selected
											? CONSTELLATION_ACCENT
											: EDGE_TIER_COLOR[tier]
										: undefined
								}
								strokeDasharray={tier ? memoryEdgeDashPattern(tier) : undefined}
								strokeWidth={
									selected ? (stroke?.width ?? 1.35) + 0.8 : stroke?.width ?? 1.35
								}
								strokeLinecap="round"
								strokeLinejoin="round"
								// The constellation viewBox fits thousands of units into a few
								// hundred pixels, so a user-unit stroke lands far below one
								// pixel. Screen-space strokes match the dashboard's canvas.
								vectorEffect={tier ? "non-scaling-stroke" : undefined}
								opacity={
									dimmed
										? 0.12
										: selected
											? 1
											: Math.min(1, stroke?.opacity ?? 0.85)
								}
								onPointerDown={(event) => {
									if (!target) return;
									event.stopPropagation();
								}}
								onClick={(event) => {
									event.stopPropagation();
									if (target) onSelect?.(target);
								}}
							>
								<title>{edgeTooltip(edge, from.label, messages)}</title>
							</polyline>
						);
					})}
					{laidOut.map((node) => {
						const selected =
							(node.memoryId && node.memoryId === selectedId) ||
							visibleEdges.some(
								(edge) =>
									edge.memoryId === selectedId &&
									(edge.from === node.id || edge.to === node.id)
							);
						const visible = !knowledge || nodeVisible(node);
						const fill = nodeFill(node);
						// MemCode memories are drawn as the dashboard draws them: a
						// rounded square tinted by its domain cluster colour.
						const cluster = weighted ? memoryClusterColor(node.domain) : null;
						const side = CONSTELLATION_NODE_SIZE;
						const radius = cluster
							? side / 2
							: node.entityType === "user" || node.type === "user"
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
								{selected && cluster ? (
									<rect
										x={-(side + 12) / 2}
										y={-(side + 12) / 2}
										width={side + 12}
										height={side + 12}
										rx={Math.max(3, side * 0.15)}
										fill="none"
										stroke={CONSTELLATION_ACCENT}
										strokeWidth={1}
										vectorEffect="non-scaling-stroke"
										opacity={0.58}
									/>
								) : selected ? (
									<circle
										r={radius + 7}
										fill="none"
										className="stroke-stone-900 dark:stroke-stone-100"
										strokeWidth={1.5}
									/>
								) : null}
								{cluster ? (
									<rect
										x={-side / 2}
										y={-side / 2}
										width={side}
										height={side}
										rx={Math.max(2, side * 0.12)}
										fill={mixHex(CONSTELLATION_NODE_FILL, cluster, 0.32)}
										stroke={selected ? CONSTELLATION_ACCENT : cluster}
										strokeWidth={selected ? 2.5 : 1.5}
										vectorEffect="non-scaling-stroke"
									>
										<title>{node.content || node.label}</title>
									</rect>
								) : node.type === "memory" && !knowledge ? (
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
								{!connectedIds || connectedIds.has(node.id) || selected ? (
									<text
										y={radius + 14}
										textAnchor="middle"
										className={
											cluster ? undefined : "fill-stone-600 dark:fill-stone-300"
										}
										fill={cluster ? "#94a3b8" : undefined}
										fontSize={cluster ? 10 : 9}
									>
										{truncateLabel(node.label)}
									</text>
								) : null}
							</g>
						);
					})}
				</g>
			</svg>
			<div
				className={`absolute bottom-2 left-2 flex max-w-[70%] flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-[10px] ${
					weighted
						? "border-[#2A2F36] bg-[#1a1f29]/90 text-[#e2e8f0]"
						: "border-stone-200 bg-white/90 text-stone-600 dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-300"
				}`}
			>
				{weighted ? null : (
					<>
						<span className="uppercase tracking-wide">
							{entityTypes.length
								? messages.MEMORY_GRAPH_ENTITY_TYPES
								: messages.MEMORY_LEGEND}
						</span>
						{entityTypes.length ? (
							entityTypes.map((type) => (
								<LegendDot
									key={type}
									color={ENTITY_FILL[type]}
									label={entityTypeLabel(type, messages)}
								/>
							))
						) : (
							<>
								<LegendDot color={KIND_FILL.temporal} label={messages.MEMORY_TEMPORAL} />
								<LegendDot color={KIND_FILL.profile} label={messages.MEMORY_PROFILE} />
								<LegendDot color={KIND_FILL.summary} label={messages.MEMORY_SUMMARY} />
							</>
						)}
					</>
				)}
				{weighted ? (
					<>
						<span className="uppercase tracking-wide">
							{messages.MEMORY_GRAPH_CONNECTIONS_LEGEND}
						</span>
						{MEMORY_EDGE_TIERS.map((tier) => (
							<LegendLine key={tier} tier={tier} label={tierLabel(tier, messages)} />
						))}
					</>
				) : null}
			</div>
			<div
				className={`absolute bottom-2 right-2 flex flex-col overflow-hidden rounded-md border ${
					weighted
						? "border-[#2A2F36] bg-[#1a1f29]/90 text-[#e2e8f0]"
						: "border-stone-200 bg-white/90 dark:border-stone-700 dark:bg-stone-900/90"
				}`}
			>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 w-7 rounded-none p-0"
					onClick={() => zoomBy(1.4)}
					title={messages.MEMORY_GRAPH_ZOOM_IN}
				>
					<Plus className="h-3.5 w-3.5" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-7 w-7 rounded-none p-0"
					onClick={() => zoomBy(0.72)}
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

function strengthLabel(
	tier: StrengthFilter,
	messages: ReturnType<typeof getMessage>
): string {
	if (tier === "strong") return messages.MEMORY_GRAPH_STRENGTH_STRONG;
	if (tier === "medium") return messages.MEMORY_GRAPH_STRENGTH_MEDIUM;
	if (tier === "weak") return messages.MEMORY_GRAPH_STRENGTH_WEAK;
	if (tier === "faint") return messages.MEMORY_GRAPH_STRENGTH_FAINT;
	return messages.MEMORY_GRAPH_STRENGTH_ALL;
}

function tierLabel(
	tier: MemoryEdgeTier,
	messages: ReturnType<typeof getMessage>
): string {
	if (tier === "strong") return messages.MEMORY_GRAPH_TIER_STRONG;
	if (tier === "medium") return messages.MEMORY_GRAPH_TIER_MEDIUM;
	if (tier === "weak") return messages.MEMORY_GRAPH_TIER_WEAK;
	return messages.MEMORY_GRAPH_TIER_FAINT;
}

function edgeTouchesSelection(
	edge: MemoryGraphEdge,
	selectedId?: string | null
): boolean {
	if (!selectedId) return false;
	if (edge.memoryId === selectedId) return true;
	return edge.from === selectedId || edge.to === selectedId;
}

function edgeTooltip(
	edge: MemoryGraphEdge,
	fallback: string,
	messages: ReturnType<typeof getMessage>
): string {
	const label = edge.label || edge.domain || fallback;
	const tier = memoryEdgeTier(edge.weight);
	if (typeof edge.weight !== "number" || !tier) return label;
	return messages.MEMORY_GRAPH_EDGE_TOOLTIP(
		label,
		`${Math.round(edge.weight * 100)}%`,
		tierLabel(tier, messages)
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

function LegendLine({ tier, label }: { tier: MemoryEdgeTier; label: string }) {
	const stroke = edgeTierStroke(tier, 0.6);
	const dash = memoryEdgeDashPattern(tier);
	return (
		<span className="inline-flex items-center gap-1">
			<svg width="16" height="6" aria-hidden="true" className="shrink-0">
				<line
					x1="0"
					y1="3"
					x2="16"
					y2="3"
					stroke={EDGE_TIER_COLOR[tier]}
					strokeWidth={stroke.width}
					strokeDasharray={dash}
					opacity={Math.min(1, stroke.opacity)}
				/>
			</svg>
			{label}
		</span>
	);
}

function LegendDot({ color, label }: { color: string; label: string }) {
	return (
		<span className="inline-flex items-center gap-1">
			<span className="size-2 rounded-full" style={{ backgroundColor: color }} />
			{label}
		</span>
	);
}
