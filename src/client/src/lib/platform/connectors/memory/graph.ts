/**
 * Pure helpers that turn memory records into page stats and a graph model.
 * Kept free of Prisma/adapters so the Memory page and Otter tools share one
 * classification without pulling connector runtime into client bundles.
 */

import type { MemoryRecord } from "./types";
import { MEMORY_UNKNOWN_USER } from "@/constants/messages/en";

export type MemoryKind = "temporal" | "profile" | "summary";

export interface MemoryStats {
	total: number;
	connections: number;
	users: number;
	sessions: number;
	temporal: number;
	profile: number;
	summary: number;
}

export interface MemoryGraphNode {
	id: string;
	type: "user" | "session" | "memory";
	label: string;
	memoryId?: string;
	kind?: MemoryKind;
}

export interface MemoryGraphEdge {
	from: string;
	to: string;
}

export interface MemoryGraphModel {
	nodes: MemoryGraphNode[];
	edges: MemoryGraphEdge[];
}

export interface LaidOutMemoryNode extends MemoryGraphNode {
	x: number;
	y: number;
}

const MAX_GRAPH_MEMORIES = 80;

export function emptyMemoryStats(): MemoryStats {
	return {
		total: 0,
		connections: 0,
		users: 0,
		sessions: 0,
		temporal: 0,
		profile: 0,
		summary: 0,
	};
}

function metaString(record: MemoryRecord, keys: string[]): string {
	const metadata = record.metadata || {};
	for (const key of keys) {
		const value = metadata[key];
		if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
	}
	return "";
}

export function classifyMemoryKind(record: MemoryRecord): MemoryKind {
	const type = metaString(record, [
		"memory_type",
		"memoryType",
		"category",
		"type",
		"kind",
	]);
	if (/(temporal|episodic|event)/.test(type)) return "temporal";
	if (/(profile|identity|preference|user)/.test(type)) return "profile";
	if (/(summary|semantic|general)/.test(type)) return "summary";

	const content = String(record.content || "").toLowerCase();
	if (/\b(yesterday|today|last week|on \d{4}|at \d{1,2}:\d{2})\b/.test(content)) {
		return "temporal";
	}
	if (/\b(is a|likes|prefers|works at|name is)\b/.test(content)) {
		return "profile";
	}
	return "summary";
}

export function summarizeMemoryStats(records: MemoryRecord[]): MemoryStats {
	const users = new Set<string>();
	const sessions = new Set<string>();
	const links = new Set<string>();
	const stats = emptyMemoryStats();
	stats.total = records.length;
	for (const record of records) {
		const kind = classifyMemoryKind(record);
		stats[kind] += 1;
		if (record.userId) users.add(record.userId);
		if (record.sessionId) sessions.add(record.sessionId);
		if (record.userId || record.sessionId) {
			links.add(`${record.userId || "_"}:${record.sessionId || "_"}`);
		}
	}
	stats.users = users.size;
	stats.sessions = sessions.size;
	stats.connections = links.size;
	return stats;
}

function titleFromContent(content: string, fallback: string): string {
	const line = content.split(/\n/)[0]?.trim() || fallback;
	return line.length > 48 ? `${line.slice(0, 45).trimEnd()}…` : line;
}

export function buildMemoryGraph(
	records: MemoryRecord[],
	options?: { maxMemories?: number }
): MemoryGraphModel {
	const maxMemories = options?.maxMemories ?? MAX_GRAPH_MEMORIES;
	const nodes: MemoryGraphNode[] = [];
	const edges: MemoryGraphEdge[] = [];
	const seen = new Set<string>();

	const pushNode = (node: MemoryGraphNode) => {
		if (seen.has(node.id)) return;
		seen.add(node.id);
		nodes.push(node);
	};

	for (const record of records.slice(0, maxMemories)) {
		const userKey = record.userId?.trim() || "";
		const sessionKey = record.sessionId?.trim() || "";
		const userId = userKey ? `user:${userKey}` : "user:unknown";
		pushNode({
			id: userId,
			type: "user",
			label: userKey || MEMORY_UNKNOWN_USER,
		});

		let parentId = userId;
		if (sessionKey) {
			const sessionId = `session:${sessionKey}`;
			pushNode({
				id: sessionId,
				type: "session",
				label: sessionKey,
			});
			edges.push({ from: userId, to: sessionId });
			parentId = sessionId;
		}

		const memoryId = `memory:${record.id}`;
		pushNode({
			id: memoryId,
			type: "memory",
			label: titleFromContent(record.content, record.id),
			memoryId: record.id,
			kind: classifyMemoryKind(record),
		});
		edges.push({ from: parentId, to: memoryId });
	}

	return { nodes, edges };
}

/**
 * Superopen-style radial tree: roots near the origin, children on equal
 * angular slots, so memories fan out instead of collapsing into a cluster.
 */
export function layoutMemoryGraph(
	model: MemoryGraphModel,
	width = 800,
	height = 480
): LaidOutMemoryNode[] {
	const cx = width / 2;
	const cy = height / 2;
	if (model.nodes.length === 0) return [];

	const byId = new Map(model.nodes.map((node) => [node.id, node]));
	const parentByChild = new Map<string, string>();
	const childrenByParent = new Map<string, string[]>();
	for (const edge of model.edges) {
		parentByChild.set(edge.to, edge.from);
		const siblings = childrenByParent.get(edge.from) || [];
		siblings.push(edge.to);
		childrenByParent.set(edge.from, siblings);
	}
	for (const siblings of childrenByParent.values()) siblings.sort();

	const users = model.nodes.filter((node) => node.type === "user");
	const roots = model.nodes.filter((node) => !parentByChild.has(node.id));
	const startNodes = users.length ? users : roots;

	const leafCountCache = new Map<string, number>();
	const leafCount = (id: string): number => {
		const cached = leafCountCache.get(id);
		if (cached !== undefined) return cached;
		const kids = childrenByParent.get(id) || [];
		const count = kids.length ? kids.reduce((sum, kid) => sum + leafCount(kid), 0) : 1;
		leafCountCache.set(id, count);
		return count;
	};

	const totalLeaves = Math.max(
		startNodes.reduce((sum, node) => sum + leafCount(node.id), 0),
		1
	);
	let maxDepth = 1;
	const walkDepth = (id: string, depth: number) => {
		maxDepth = Math.max(maxDepth, depth);
		for (const kid of childrenByParent.get(id) || []) walkDepth(kid, depth + 1);
	};
	const rootDepth = startNodes.length <= 1 ? 0 : 1;
	for (const node of startNodes) walkDepth(node.id, rootDepth);
	maxDepth = Math.max(maxDepth, 1);

	const radius = Math.max(180, Math.sqrt(totalLeaves) * 42);
	const step = radius / maxDepth;
	const slotAngle = (Math.PI * 2) / totalLeaves;
	const laid = new Map<string, LaidOutMemoryNode>();
	let cursor = 0;

	const polar = (r: number, angle: number) => ({
		x: cx + r * Math.cos(angle),
		y: cy + r * Math.sin(angle),
	});

	const place = (node: MemoryGraphNode, depth: number) => {
		const leaves = leafCount(node.id);
		const angle = (cursor + leaves / 2) * slotAngle;
		const pos = polar(depth === 0 ? 0 : depth * step, angle);
		laid.set(node.id, { ...node, x: pos.x, y: pos.y });
		const kids = childrenByParent.get(node.id) || [];
		for (const kidId of kids) {
			const kid = byId.get(kidId);
			if (kid) place(kid, depth + 1);
		}
		if (!kids.length) cursor += 1;
	};

	for (const node of startNodes) place(node, rootDepth);
	for (const node of model.nodes) {
		if (laid.has(node.id)) continue;
		const pos = polar(step, cursor * slotAngle);
		laid.set(node.id, { ...node, x: pos.x, y: pos.y });
		cursor += 1;
	}

	return Array.from(laid.values());
}

export function radialEdgePoints(
	from: { x: number; y: number },
	to: { x: number; y: number },
	origin: { x: number; y: number },
	segments = 8
): { x: number; y: number }[] {
	const r1 = Math.hypot(from.x - origin.x, from.y - origin.y);
	const r2 = Math.hypot(to.x - origin.x, to.y - origin.y);
	const a1 = Math.atan2(from.y - origin.y, from.x - origin.x);
	const a2 = Math.atan2(to.y - origin.y, to.x - origin.x);
	const startAngle = r1 < 1e-6 ? a2 : a1;
	let delta = a2 - startAngle;
	while (delta > Math.PI) delta -= Math.PI * 2;
	while (delta < -Math.PI) delta += Math.PI * 2;
	const points: { x: number; y: number }[] = [];
	for (let step = 0; step <= segments; step += 1) {
		const t = step / segments;
		const ease = t * t * (3 - 2 * t);
		const radius = r1 + (r2 - r1) * t;
		const angle = startAngle + delta * ease;
		points.push({
			x: origin.x + radius * Math.cos(angle),
			y: origin.y + radius * Math.sin(angle),
		});
	}
	return points;
}
