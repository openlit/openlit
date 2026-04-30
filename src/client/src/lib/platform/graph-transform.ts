/**
 * Transform an OpenTelemetry span tree into renderable graph nodes and edges.
 *
 * Edges model execution flow, not raw parent_id structure:
 * - parent -> first child is sequential execution entry.
 * - child siblings are sequential when one wave finishes before the next starts.
 * - child siblings are parallel when their time windows overlap.
 */

export interface GraphNode {
	id: string;
	spanId: string;
	spanName: string;
	timestamp?: string;
	duration: number;
	cost?: number;
	x: number;
	y: number;
	depth: number;
}

export type EdgeKind = "DELEGATED" | "SEQUENTIAL" | "PARALLEL";

export interface GraphEdgeData {
	from: string;
	to: string;
	kind: EdgeKind;
}

export interface DAG {
	nodes: Map<string, GraphNode>;
	edges: GraphEdgeData[];
}

interface Span {
	SpanId: string;
	SpanName: string;
	Timestamp?: string;
	Duration: number | string;
	Cost?: number;
	children?: Span[];
}

interface TimedSpan {
	span: Span;
	order: number;
	start: number | null;
	end: number | null;
	duration: number;
}

interface SiblingAnalysis {
	groups: Span[][];
	parallelEdges: GraphEdgeData[];
	sequentialEdges: GraphEdgeData[];
}

const NODE_WIDTH = 160;
const X_GAP = 220;
export const PARALLEL_X_GAP = NODE_WIDTH + 72;
const V_GAP = 112;
const EPSILON_MS = 0.001;

function timestampMs(timestamp?: string): number | null {
	if (!timestamp) return null;

	const ms = Date.parse(timestamp.endsWith("Z") ? timestamp : `${timestamp}Z`);
	return Number.isFinite(ms) ? ms : null;
}

function timed(span: Span, order: number): TimedSpan {
	const start = timestampMs(span.Timestamp);
	const durationMs = Number(span.Duration || 0) / 1e6;
	const end = start == null ? null : start + Math.max(0, durationMs);

	return { span, order, start, end, duration: Math.max(0, durationMs) };
}

function overlaps(a: TimedSpan, b: TimedSpan): boolean {
	if (a.start == null || a.end == null || b.start == null || b.end == null) {
		return false;
	}

	return a.start < b.end - EPSILON_MS && b.start < a.end - EPSILON_MS;
}

function startsInSameExecutionWindow(a: TimedSpan, b: TimedSpan): boolean {
	if (a.start == null || b.start == null) return false;

	const startDelta = Math.abs(b.start - a.start);
	const shortestDuration = Math.min(a.duration, b.duration);
	const windowMs = Math.max(50, Math.min(1000, shortestDuration * 0.2));

	return startDelta <= windowMs;
}

function runsInParallel(a: TimedSpan, b: TimedSpan): boolean {
	return overlaps(a, b) && startsInSameExecutionWindow(a, b);
}

function sortTimedSiblings(children: Span[]): TimedSpan[] {
	return children
		.map(timed)
		.sort((a, b) => {
			if (a.start == null && b.start == null) return a.order - b.order;
			if (a.start == null) return 1;
			if (b.start == null) return -1;
			if (a.start !== b.start) return a.start - b.start;
			return a.order - b.order;
		});
}

function pickLatestEnding(group: TimedSpan[]): TimedSpan {
	return group.reduce((latest, item) => {
		if (latest.end == null) return item;
		if (item.end == null) return latest;
		if (item.end !== latest.end) return item.end > latest.end ? item : latest;
		return item.order > latest.order ? item : latest;
	}, group[0]);
}

function pickEarliestStarting(group: TimedSpan[]): TimedSpan {
	return group.reduce((earliest, item) => {
		if (earliest.start == null) return item;
		if (item.start == null) return earliest;
		if (item.start !== earliest.start) {
			return item.start < earliest.start ? item : earliest;
		}
		return item.order < earliest.order ? item : earliest;
	}, group[0]);
}

function analyzeSiblings(children: Span[] = []): SiblingAnalysis {
	if (children.length < 2) {
		return { groups: children.length ? [children] : [], parallelEdges: [], sequentialEdges: [] };
	}

	const sorted = sortTimedSiblings(children);
	const timedGroups: TimedSpan[][] = [];
	let activeGroup: TimedSpan[] = [];

	for (const child of sorted) {
		const startsInActiveGroup =
			activeGroup.some((activeChild) => runsInParallel(activeChild, child));

		if (!activeGroup.length || startsInActiveGroup) {
			activeGroup.push(child);
			continue;
		}

		timedGroups.push(activeGroup);
		activeGroup = [child];
	}

	if (activeGroup.length) {
		timedGroups.push(activeGroup);
	}

	const parallelEdges: GraphEdgeData[] = [];
	for (const group of timedGroups) {
		if (group.length < 2) continue;

		for (let i = 0; i < group.length; i++) {
			for (let j = i + 1; j < group.length; j++) {
				if (!runsInParallel(group[i], group[j])) continue;

				parallelEdges.push({
					from: group[i].span.SpanId,
					to: group[j].span.SpanId,
					kind: "PARALLEL",
				});
			}
		}
	}

	const sequentialEdges: GraphEdgeData[] = [];
	for (let i = 0; i < timedGroups.length - 1; i++) {
		const from = pickLatestEnding(timedGroups[i]).span.SpanId;
		const to = pickEarliestStarting(timedGroups[i + 1]).span.SpanId;

		if (from !== to) {
			sequentialEdges.push({ from, to, kind: "SEQUENTIAL" });
		}
	}

	return {
		groups: timedGroups.map((group) => group.map((child) => child.span)),
		parallelEdges,
		sequentialEdges,
	};
}

function collectNodesAndEdges(span: Span, nodes: Map<string, GraphNode>, edges: GraphEdgeData[], depth = 0) {
	nodes.set(span.SpanId, {
		id: span.SpanId,
		spanId: span.SpanId,
		spanName: span.SpanName,
		timestamp: span.Timestamp,
		duration: Number(span.Duration || 0),
		cost: span.Cost,
		x: 0,
		y: depth * V_GAP,
		depth,
	});

	if (!span.children?.length) return;

	const siblingAnalysis = analyzeSiblings(span.children);
	const firstGroup = siblingAnalysis.groups[0];
	if (firstGroup?.length) {
		edges.push({
			from: span.SpanId,
			to: firstGroup[0].SpanId,
			kind: "SEQUENTIAL",
		});
	}

	edges.push(...siblingAnalysis.sequentialEdges, ...siblingAnalysis.parallelEdges);

	for (const child of span.children) {
		collectNodesAndEdges(child, nodes, edges, depth + 1);
	}
}

function layoutVerticalFlow(root: Span, nodes: Map<string, GraphNode>) {
	function place(span: Span, y: number, x: number): number {
		const node = nodes.get(span.SpanId);
		if (node) {
			node.x = x;
			node.y = y;
		}

		if (!span.children?.length) {
			return y;
		}

		const analysis = analyzeSiblings(span.children);
		let nextY = y + V_GAP;
		let subtreeBottom = y;

		for (const group of analysis.groups) {
			if (group.length === 1) {
				subtreeBottom = place(group[0], nextY, x + X_GAP);
				nextY = subtreeBottom + V_GAP;
				continue;
			}

			const startX = x + X_GAP - ((group.length - 1) * PARALLEL_X_GAP) / 2;
			let groupBottom = nextY;
			for (let i = 0; i < group.length; i++) {
				groupBottom = Math.max(
					groupBottom,
					place(group[i], nextY, startX + i * PARALLEL_X_GAP)
				);
			}
			subtreeBottom = groupBottom;
			nextY = groupBottom + V_GAP;
		}

		return subtreeBottom;
	}

	place(root, 0, 0);
}

export function transformTracesToGraph(root: Span): DAG {
	const nodes = new Map<string, GraphNode>();
	const edges: GraphEdgeData[] = [];

	collectNodesAndEdges(root, nodes, edges);
	layoutVerticalFlow(root, nodes);

	return { nodes, edges };
}

export function getParallelPairs(root: Span): Set<string> {
	const pairs = new Set<string>();

	function walk(span: Span) {
		const analysis = analyzeSiblings(span.children);
		for (const edge of analysis.parallelEdges) {
			pairs.add([edge.from, edge.to].sort().join("|"));
		}
		span.children?.forEach(walk);
	}

	walk(root);
	return pairs;
}
