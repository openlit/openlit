"use client";

import { TraceHeirarchySpan } from "@/types/trace";
import { useRequest } from "../request-context";
import {
	getSpanDurationDisplay,
	getSpanCostFormatted,
	getSpanTooltipText,
} from "@/helpers/client/trace";

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
	return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}

export default function NodeGraph({ record }: { record: TraceHeirarchySpan }) {
	const [request, updateRequest] = useRequest();

	const nodes = layoutTree(record);

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

	// Build edges
	const edges: { from: NodeLayout; to: NodeLayout }[] = [];
	function collectEdges(span: TraceHeirarchySpan) {
		const fromLayout = nodeMap.get(span.SpanId);
		if (!fromLayout) return;
		if (span.children) {
			for (const child of span.children) {
				const toLayout = nodeMap.get(child.SpanId);
				if (toLayout) edges.push({ from: fromLayout, to: toLayout });
				collectEdges(child);
			}
		}
	}
	collectEdges(record);

	return (
		<div>
			<svg
				width={svgWidth}
				height={svgHeight}
				viewBox={`0 0 ${svgWidth} ${svgHeight}`}
				className="block"
			>
				{/* Edges */}
				{edges.map(({ from, to }, i) => {
					const x1 = from.x + offsetX + NODE_WIDTH / 2;
					const y1 = from.y + offsetY + NODE_HEIGHT;
					const x2 = to.x + offsetX + NODE_WIDTH / 2;
					const y2 = to.y + offsetY;
					const midY = (y1 + y2) / 2;
					const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
					return (
						<path
							key={i}
							d={d}
							fill="none"
							stroke="rgba(120,113,108,0.4)"
							strokeWidth={1.5}
						/>
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
					const costDisplay = getSpanCostFormatted(span, 4);
					const tooltipText = getSpanTooltipText(span);

					return (
						<g
							key={span.SpanId}
							onClick={() => updateRequest({ spanId: span.SpanId })}
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
									? `${durationDisplay} • ${costDisplay}`
									: durationDisplay}
							</text>
						</g>
					);
				})}
			</svg>
		</div>
	);
}
