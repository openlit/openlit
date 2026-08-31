/**
 * Pure helpers that turn memory records into page stats and a graph model.
 * Kept free of Prisma/adapters so the Memory page and Otter tools share one
 * classification without pulling connector runtime into client bundles.
 */

import type { MemoryRecord } from "./types";
import { MEMORY_UNKNOWN_USER } from "@/constants/messages/en";

export type MemoryKind = "temporal" | "profile" | "summary";

export const MEMORY_ENTITY_TYPES = [
	"user",
	"entity",
	"event",
	"location",
	"object",
	"preference",
	"topic",
] as const;

export type MemoryEntityType = (typeof MEMORY_ENTITY_TYPES)[number];

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
	type: "user" | "session" | "memory" | "entity";
	label: string;
	memoryId?: string;
	kind?: MemoryKind;
	entityType?: MemoryEntityType;
}

export interface MemoryGraphEdge {
	from: string;
	to: string;
	memoryId?: string;
	label?: string;
}

export interface MemoryGraphModel {
	nodes: MemoryGraphNode[];
	edges: MemoryGraphEdge[];
	kind?: "knowledge" | "tree";
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
	const type = [
		metaString(record, [
			"memory_type",
			"memoryType",
			"category",
			"domain",
			"type",
			"kind",
		]),
		...(record.categories || []),
	]
		.join(" ")
		.toLowerCase();
	if (/(temporal|episodic|event)/.test(type)) return "temporal";
	if (/(profile|identity|preference|user)/.test(type)) return "profile";
	if (/(summary|semantic|general|original)/.test(type)) return "summary";

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

export function classifyEntityType(types?: string[]): MemoryEntityType {
	const labels = (types || [])
		.map((value) => value.trim().toLowerCase())
		.filter((value) => value && value !== "node");
	for (const type of MEMORY_ENTITY_TYPES) {
		if (type === "entity") continue;
		if (labels.includes(type)) return type;
	}
	return "entity";
}

export function buildMemoryGraph(
	records: MemoryRecord[],
	options?: { maxMemories?: number }
): MemoryGraphModel {
	const maxMemories = options?.maxMemories ?? MAX_GRAPH_MEMORIES;
	const facts = records.filter((record) => !record.graphOnly).slice(0, maxMemories);
	const extras = records.filter((record) => record.graphOnly);
	if (facts.some((record) => record.relation?.source && record.relation?.target)) {
		return buildKnowledgeGraph(facts, extras);
	}
	return buildSessionTreeGraph(facts);
}

function buildKnowledgeGraph(
	facts: MemoryRecord[],
	extras: MemoryRecord[]
): MemoryGraphModel {
	const nodes: MemoryGraphNode[] = [];
	const edges: MemoryGraphEdge[] = [];
	const seen = new Set<string>();

	const pushEndpoint = (endpoint: {
		id: string;
		label: string;
		types?: string[];
	}) => {
		const id = endpoint.id.trim();
		if (!id || seen.has(id)) return;
		seen.add(id);
		const entityType = classifyEntityType(endpoint.types);
		nodes.push({
			id,
			type: entityType === "user" ? "user" : "entity",
			entityType,
			label: endpoint.label.trim() || id,
			memoryId: id,
		});
	};

	for (const record of facts) {
		const relation = record.relation;
		if (!relation?.source?.id || !relation.target?.id) continue;
		pushEndpoint(relation.source);
		pushEndpoint(relation.target);
		edges.push({
			from: relation.source.id,
			to: relation.target.id,
			memoryId: record.id,
			label: relation.name,
		});
	}

	for (const record of extras) {
		pushEndpoint({
			id: record.id,
			label:
				(typeof record.metadata?.name === "string" && record.metadata.name) ||
				titleFromContent(record.content, record.id),
			types: record.categories,
		});
	}

	return { nodes, edges, kind: "knowledge" };
}

function buildSessionTreeGraph(records: MemoryRecord[]): MemoryGraphModel {
	const nodes: MemoryGraphNode[] = [];
	const edges: MemoryGraphEdge[] = [];
	const seen = new Set<string>();

	const pushNode = (node: MemoryGraphNode) => {
		if (seen.has(node.id)) return;
		seen.add(node.id);
		nodes.push(node);
	};

	for (const record of records) {
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
		edges.push({ from: parentId, to: memoryId, memoryId: record.id });
	}

	return { nodes, edges };
}

function hashUnit(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) / 4294967295;
}

function layoutKnowledgeGraph(
	model: MemoryGraphModel,
	width: number,
	height: number
): LaidOutMemoryNode[] {
	if (model.nodes.length === 0) return [];
	const cx = width / 2;
	const cy = height / 2;
	const users = model.nodes.filter(
		(node) => node.entityType === "user" || node.type === "user"
	);
	const pinned = new Set(users.slice(0, 1).map((node) => node.id));
	const pos = new Map<string, { x: number; y: number }>();
	for (const node of model.nodes) {
		if (pinned.has(node.id)) {
			pos.set(node.id, { x: cx, y: cy });
			continue;
		}
		const angle = hashUnit(node.id) * Math.PI * 2;
		const radius = 90 + hashUnit(`${node.id}:r`) * 220;
		pos.set(node.id, {
			x: cx + radius * Math.cos(angle),
			y: cy + radius * Math.sin(angle),
		});
	}

	const ids = model.nodes.map((node) => node.id);
	const iterations = Math.min(90, 40 + ids.length);
	for (let iter = 0; iter < iterations; iter += 1) {
		const disp = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
		for (let i = 0; i < ids.length; i += 1) {
			for (let j = i + 1; j < ids.length; j += 1) {
				const a = pos.get(ids[i]);
				const b = pos.get(ids[j]);
				if (!a || !b) continue;
				let dx = a.x - b.x;
				let dy = a.y - b.y;
				const dist = Math.hypot(dx, dy) || 0.01;
				const force = 2800 / dist;
				dx /= dist;
				dy /= dist;
				const da = disp.get(ids[i]);
				const db = disp.get(ids[j]);
				if (da) {
					da.x += dx * force;
					da.y += dy * force;
				}
				if (db) {
					db.x -= dx * force;
					db.y -= dy * force;
				}
			}
		}
		for (const edge of model.edges) {
			const a = pos.get(edge.from);
			const b = pos.get(edge.to);
			if (!a || !b) continue;
			let dx = b.x - a.x;
			let dy = b.y - a.y;
			const dist = Math.hypot(dx, dy) || 0.01;
			const force = (dist - 118) * 0.06;
			dx /= dist;
			dy /= dist;
			const da = disp.get(edge.from);
			const db = disp.get(edge.to);
			if (da) {
				da.x += dx * force;
				da.y += dy * force;
			}
			if (db) {
				db.x -= dx * force;
				db.y -= dy * force;
			}
		}
		const cooling = 0.55 * (1 - iter / iterations);
		for (const id of ids) {
			if (pinned.has(id)) continue;
			const current = pos.get(id);
			const delta = disp.get(id);
			if (!current || !delta) continue;
			const mag = Math.hypot(delta.x, delta.y) || 1;
			const step = Math.min(mag, 28) * cooling;
			current.x += (delta.x / mag) * step;
			current.y += (delta.y / mag) * step;
		}
	}

	return model.nodes.map((node) => {
		const point = pos.get(node.id) || { x: cx, y: cy };
		return { ...node, x: point.x, y: point.y };
	});
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
	if (model.kind === "knowledge") {
		return layoutKnowledgeGraph(model, width, height);
	}
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
	for (const siblings of Array.from(childrenByParent.values())) siblings.sort();

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
