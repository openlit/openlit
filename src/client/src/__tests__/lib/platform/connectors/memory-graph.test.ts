import {
	MEMORY_CLUSTER_COLORS,
	MEMORY_EDGE_TIER_MINIMUM,
	buildMemoryGraph,
	classifyEntityType,
	classifyMemoryKind,
	layoutMemoryGraph,
	memoryClusterColor,
	memoryEdgeDashPattern,
	memoryEdgeTier,
	radialEdgePoints,
	summarizeMemoryStats,
	type MemoryGraphModel,
} from "@/lib/platform/connectors/memory/graph";
import { MEMORY_UNKNOWN_USER } from "@/constants/messages/en";
import type { MemoryRecord } from "@/lib/platform/connectors/memory/types";

function record(over: Partial<MemoryRecord> = {}): MemoryRecord {
	return {
		id: "m1",
		content: "Presenting a report on tracing coverage",
		...over,
	};
}

describe("memory graph helpers", () => {
	it("classifies from metadata and content heuristics", () => {
		expect(
			classifyMemoryKind(record({ metadata: { memory_type: "episodic" } }))
		).toBe("temporal");
		expect(
			classifyMemoryKind(record({ metadata: { type: "identity" } }))
		).toBe("profile");
		expect(classifyMemoryKind(record({ content: "Alex likes dark mode" }))).toBe(
			"profile"
		);
		expect(
			classifyMemoryKind(record({ categories: ["profile"], metadata: { domain: "profile" } }))
		).toBe("profile");
		expect(classifyMemoryKind(record())).toBe("summary");
	});

	it("classifies summary from metadata and temporal from content when metadata is silent", () => {
		expect(
			classifyMemoryKind(record({ metadata: { category: "semantic" } }))
		).toBe("summary");
		expect(classifyMemoryKind(record({ content: "" }))).toBe("summary");
		expect(
			classifyMemoryKind(record({ content: "We met yesterday for coffee" }))
		).toBe("temporal");
	});

	it("summarizes counts and unique connections", () => {
		const stats = summarizeMemoryStats([
			record({
				id: "1",
				userId: "u1",
				sessionId: "s1",
				metadata: { memory_type: "temporal" },
			}),
			record({
				id: "2",
				userId: "u1",
				sessionId: "s2",
				metadata: { type: "profile" },
			}),
			record({ id: "3", content: "Weekly summary of tracing work" }),
		]);
		expect(stats).toEqual(
			expect.objectContaining({
				total: 3,
				users: 1,
				sessions: 2,
				connections: 2,
				temporal: 1,
				profile: 1,
				summary: 1,
			})
		);
	});

	it("keys connections with a placeholder when only one side of the pair is known", () => {
		const stats = summarizeMemoryStats([
			record({ id: "1", userId: "ada" }),
			record({ id: "2", sessionId: "s1" }),
		]);
		expect(stats.connections).toBe(2);
		expect(stats.users).toBe(1);
		expect(stats.sessions).toBe(1);
	});

	it("builds user → session → memory edges", () => {
		const graph = buildMemoryGraph([
			record({ id: "mem-1", userId: "ada", sessionId: "run-9" }),
		]);
		expect(graph.nodes.map((node) => node.id)).toEqual([
			"user:ada",
			"session:run-9",
			"memory:mem-1",
		]);
		expect(graph.edges).toEqual([
			{ from: "user:ada", to: "session:run-9" },
			{ from: "session:run-9", to: "memory:mem-1", memoryId: "mem-1" },
		]);
	});

	it("falls back to the record id as the memory label when content has no first line", () => {
		const graph = buildMemoryGraph([record({ id: "mem-empty", content: "" })]);
		const memoryNode = graph.nodes.find((node) => node.type === "memory");
		expect(memoryNode?.label).toBe("mem-empty");
	});

	it("truncates long memory titles to 48 characters with an ellipsis", () => {
		const longLine =
			"This first line of the memory content is deliberately long enough to be truncated";
		const graph = buildMemoryGraph([record({ id: "mem-long", content: longLine })]);
		const memoryNode = graph.nodes.find((node) => node.type === "memory");
		expect(memoryNode?.label).toHaveLength(46);
		expect(memoryNode?.label?.endsWith("…")).toBe(true);
	});

	it("groups memories under an unknown-user placeholder when userId is missing", () => {
		const graph = buildMemoryGraph([record({ id: "mem-1" })]);
		expect(graph.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "user:unknown", label: MEMORY_UNKNOWN_USER }),
			])
		);
		expect(graph.edges).toEqual(
			expect.arrayContaining([{ from: "user:unknown", to: "memory:mem-1", memoryId: "mem-1" }])
		);
	});

	it("respects a custom maxMemories option", () => {
		const graph = buildMemoryGraph(
			[
				record({ id: "a", userId: "u1" }),
				record({ id: "b", userId: "u1" }),
				record({ id: "c", userId: "u1" }),
			],
			{ maxMemories: 1 }
		);
		const memoryNodes = graph.nodes.filter((node) => node.type === "memory");
		expect(memoryNodes).toHaveLength(1);
	});

	it("lays out nodes with coordinates", () => {
		const laid = layoutMemoryGraph(
			buildMemoryGraph([
				record({ id: "a", userId: "u1" }),
				record({ id: "b", userId: "u2" }),
			])
		);
		expect(laid.length).toBeGreaterThan(2);
		expect(laid.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
			true
		);
	});

	it("fans memories out instead of stacking them on the parent", () => {
		const laid = layoutMemoryGraph(
			buildMemoryGraph([
				record({ id: "a", userId: "ada", sessionId: "s1", content: "one" }),
				record({ id: "b", userId: "ada", sessionId: "s1", content: "two" }),
				record({ id: "c", userId: "ada", sessionId: "s2", content: "three" }),
			])
		);
		const memories = laid.filter((node) => node.type === "memory");
		const user = laid.find((node) => node.type === "user");
		expect(memories).toHaveLength(3);
		expect(user).toBeDefined();
		const spread = Math.max(
			...memories.map((node) => Math.hypot(node.x - memories[0].x, node.y - memories[0].y))
		);
		expect(spread).toBeGreaterThan(40);
		expect(
			memories.every(
				(node) => Math.hypot(node.x - (user?.x || 0), node.y - (user?.y || 0)) > 40
			)
		).toBe(true);
	});

	it("classifies unknown or missing entity type labels as a generic entity", () => {
		expect(classifyEntityType(undefined)).toBe("entity");
		expect(classifyEntityType(["mystery-type", "Node"])).toBe("entity");
	});

	it("skips relation facts missing a source or target id", () => {
		const graph = buildMemoryGraph([
			record({
				id: "broken",
				relation: {
					source: { id: "", label: "No id" },
					target: { id: "n-loc", label: "Austin" },
				},
			}),
			record({
				id: "ok",
				relation: {
					source: { id: "n-user", label: "Sarah", types: ["User"] },
					target: { id: "n-loc-2", label: "Berlin", types: ["Location"] },
				},
			}),
		]);
		expect(graph.kind).toBe("knowledge");
		expect(graph.nodes.some((node) => node.id === "n-loc")).toBe(false);
		expect(graph.edges).toEqual([
			{ from: "n-user", to: "n-loc-2", memoryId: "ok", label: undefined },
		]);
	});

	it("dedupes relation endpoints shared across facts and falls back to the id for blank labels", () => {
		const graph = buildMemoryGraph([
			record({
				id: "e1",
				relation: {
					source: { id: "n-user", label: "  ", types: ["User"] },
					target: { id: "n-topic", label: "Tracing", types: ["Topic"] },
				},
			}),
			record({
				id: "e2",
				relation: {
					source: { id: "n-user", label: "Sarah", types: ["User"] },
					target: { id: "n-loc", label: "Austin", types: ["Location"] },
				},
			}),
		]);
		const userNodes = graph.nodes.filter((node) => node.id === "n-user");
		expect(userNodes).toHaveLength(1);
		expect(userNodes[0].label).toBe("n-user");
	});

	it("falls back to titleFromContent for graph-only nodes without a string metadata name", () => {
		const graph = buildMemoryGraph([
			record({
				id: "e1",
				relation: {
					source: { id: "n-user", label: "Sarah", types: ["User"] },
					target: { id: "n-loc", label: "Austin", types: ["Location"] },
				},
			}),
			record({
				id: "n-extra",
				content: "Observability platform notes",
				graphOnly: true,
				metadata: { name: 42 },
			}),
		]);
		const extraNode = graph.nodes.find((node) => node.id === "n-extra");
		expect(extraNode?.label).toBe("Observability platform notes");
	});

	it("builds an entity knowledge graph from relation endpoints", () => {
		const graph = buildMemoryGraph([
			record({
				id: "e1",
				content: "Sarah lives in Austin",
				relation: {
					source: {
						id: "n-user",
						label: "Sarah Smith",
						types: ["User", "Node"],
					},
					target: {
						id: "n-loc",
						label: "Austin",
						types: ["Location", "Node"],
					},
					name: "LIVES_IN",
				},
			}),
			record({
				id: "n-topic",
				content: "Observability",
				graphOnly: true,
				categories: ["Topic", "Node"],
				metadata: { name: "Observability" },
			}),
		]);
		expect(graph.kind).toBe("knowledge");
		expect(graph.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "n-user",
					type: "user",
					entityType: "user",
					label: "Sarah Smith",
				}),
				expect.objectContaining({
					id: "n-loc",
					entityType: "location",
					label: "Austin",
				}),
				expect.objectContaining({
					id: "n-topic",
					entityType: "topic",
					label: "Observability",
				}),
			])
		);
		expect(graph.edges).toEqual([
			{
				from: "n-user",
				to: "n-loc",
				memoryId: "e1",
				label: "LIVES_IN",
			},
		]);
		const laid = layoutMemoryGraph(graph);
		const hub = laid.find((node) => node.id === "n-user");
		expect(hub).toBeDefined();
		expect(laid.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
			true
		);
	});

	it("returns an empty layout for an empty knowledge graph", () => {
		expect(layoutMemoryGraph({ nodes: [], edges: [], kind: "knowledge" })).toEqual([]);
	});

	it("returns an empty layout for an empty session-tree graph", () => {
		expect(layoutMemoryGraph({ nodes: [], edges: [] })).toEqual([]);
	});

	it("skips knowledge-graph edges that reference a node outside the model", () => {
		const model: MemoryGraphModel = {
			kind: "knowledge",
			nodes: [
				{ id: "n-a", type: "entity", entityType: "topic", label: "A" },
				{ id: "n-b", type: "entity", entityType: "topic", label: "B" },
			],
			edges: [{ from: "n-a", to: "missing-node" }],
		};
		const laid = layoutMemoryGraph(model);
		expect(laid).toHaveLength(2);
		expect(laid.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
			true
		);
	});

	it("keeps a stable layout when nodes coincide and Math.hypot reports zero distance", () => {
		const hypotSpy = jest.spyOn(Math, "hypot").mockReturnValue(0);
		try {
			const model: MemoryGraphModel = {
				kind: "knowledge",
				nodes: [
					{ id: "n-a", type: "entity", entityType: "topic", label: "A" },
					{ id: "n-b", type: "entity", entityType: "topic", label: "B" },
				],
				edges: [{ from: "n-a", to: "n-b" }],
			};
			const laid = layoutMemoryGraph(model);
			expect(laid).toHaveLength(2);
			expect(
				laid.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))
			).toBe(true);
		} finally {
			hypotSpy.mockRestore();
		}
	});

	it("falls back to root nodes for tree layout when no user node exists", () => {
		const model: MemoryGraphModel = {
			nodes: [
				{ id: "memory:only", type: "memory", label: "Standalone note" },
			],
			edges: [],
		};
		const laid = layoutMemoryGraph(model);
		expect(laid).toHaveLength(1);
		expect(laid[0].id).toBe("memory:only");
	});

	it("places orphan nodes that are not reachable from any root", () => {
		const model: MemoryGraphModel = {
			nodes: [
				{ id: "user:ada", type: "user", label: "ada" },
				{ id: "memory:m1", type: "memory", label: "one", memoryId: "m1" },
				{ id: "memory:orphan", type: "memory", label: "orphan", memoryId: "orphan" },
			],
			edges: [{ from: "user:ada", to: "memory:m1", memoryId: "m1" }],
		};
		const laid = layoutMemoryGraph(model);
		expect(laid).toHaveLength(3);
		const orphan = laid.find((node) => node.id === "memory:orphan");
		expect(orphan).toBeDefined();
		expect(Number.isFinite(orphan?.x)).toBe(true);
		expect(Number.isFinite(orphan?.y)).toBe(true);
	});
});

describe("radialEdgePoints", () => {
	const origin = { x: 0, y: 0 };

	it("interpolates points along an arc between two radii", () => {
		const points = radialEdgePoints({ x: 100, y: 0 }, { x: 0, y: 100 }, origin);
		expect(points).toHaveLength(9);
		expect(points[0].x).toBeCloseTo(100);
		expect(points[0].y).toBeCloseTo(0);
		expect(points[points.length - 1].x).toBeCloseTo(0);
		expect(points[points.length - 1].y).toBeCloseTo(100);
	});

	it("uses the target angle when the origin point sits on the origin", () => {
		const points = radialEdgePoints(origin, { x: 0, y: 100 }, origin);
		expect(points[0].x).toBeCloseTo(0);
		expect(points[0].y).toBeCloseTo(0);
		expect(points[points.length - 1].y).toBeCloseTo(100);
	});

	it("wraps a large positive angular delta into the shortest path", () => {
		const angleFrom = -3;
		const angleTo = 3;
		const from = { x: 100 * Math.cos(angleFrom), y: 100 * Math.sin(angleFrom) };
		const to = { x: 100 * Math.cos(angleTo), y: 100 * Math.sin(angleTo) };
		const points = radialEdgePoints(from, to, origin, 4);
		expect(points).toHaveLength(5);
		expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
			true
		);
	});

	it("wraps a large negative angular delta into the shortest path", () => {
		const angleFrom = 3;
		const angleTo = -3;
		const from = { x: 100 * Math.cos(angleFrom), y: 100 * Math.sin(angleFrom) };
		const to = { x: 100 * Math.cos(angleTo), y: 100 * Math.sin(angleTo) };
		const points = radialEdgePoints(from, to, origin, 4);
		expect(points).toHaveLength(5);
		expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
			true
		);
	});
});

describe("memoryEdgeTier", () => {
	it("buckets a weight the way the MemCode dashboard does", () => {
		expect(memoryEdgeTier(0.95)).toBe("strong");
		expect(memoryEdgeTier(0.81)).toBe("strong");
		// 0.8 itself is medium: upstream uses an exclusive bound for strong.
		expect(memoryEdgeTier(0.8)).toBe("medium");
		expect(memoryEdgeTier(0.6)).toBe("medium");
		expect(memoryEdgeTier(0.59)).toBe("weak");
		expect(memoryEdgeTier(0.51)).toBe("weak");
		expect(memoryEdgeTier(0.5)).toBe("faint");
		expect(memoryEdgeTier(0.3)).toBe("faint");
	});

	it("treats anything below the faint floor as noise", () => {
		expect(memoryEdgeTier(0.29)).toBeNull();
		expect(memoryEdgeTier(0)).toBeNull();
	});

	it("returns null for an unscored edge", () => {
		expect(memoryEdgeTier(undefined)).toBeNull();
		expect(memoryEdgeTier(Number.NaN)).toBeNull();
		expect(memoryEdgeTier(Number.POSITIVE_INFINITY)).toBeNull();
	});

	it("keeps only edges at or above the selected threshold", () => {
		const weights = [0.35, 0.55, 0.62, 0.91];
		expect(
			weights.filter((weight) => weight >= MEMORY_EDGE_TIER_MINIMUM.strong)
		).toEqual([0.91]);
		expect(
			weights.filter((weight) => weight >= MEMORY_EDGE_TIER_MINIMUM.medium)
		).toEqual([0.62, 0.91]);
		expect(
			weights.filter((weight) => weight >= MEMORY_EDGE_TIER_MINIMUM.weak)
		).toEqual([0.55, 0.62, 0.91]);
		expect(
			weights.filter((weight) => weight >= MEMORY_EDGE_TIER_MINIMUM.faint)
		).toEqual(weights);
	});
});

describe("MemCode constellation styling", () => {
	it("dashes edges the way the dashboard does", () => {
		expect(memoryEdgeDashPattern("strong")).toBeUndefined();
		expect(memoryEdgeDashPattern("medium")).toBe("7 4");
		expect(memoryEdgeDashPattern("weak")).toBe("4 6");
		expect(memoryEdgeDashPattern("faint")).toBe("2 6");
	});

	it("maps a domain onto a stable cluster colour", () => {
		const profile = memoryClusterColor("profile");
		expect(MEMORY_CLUSTER_COLORS).toContain(profile);
		expect(memoryClusterColor("profile")).toBe(profile);
		expect(memoryClusterColor("temporal")).not.toBe(profile);
		// An unknown or missing domain still resolves rather than throwing.
		expect(MEMORY_CLUSTER_COLORS).toContain(memoryClusterColor(undefined));
	});

	it("lays a weighted graph out as a golden-angle constellation", () => {
		const model: MemoryGraphModel = {
			kind: "knowledge",
			weighted: true,
			nodes: Array.from({ length: 400 }, (_, index) => ({
				id: `memory_${index}`,
				type: "memory" as const,
				label: `Memory ${index}`,
				memoryId: `memory_${index}`,
			})),
			edges: [],
		};
		const laidOut = layoutMemoryGraph(model, 800, 480);
		expect(laidOut).toHaveLength(400);
		expect(laidOut.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
			true
		);
		// Phyllotaxis: distance from centre grows as sqrt(index), so later nodes
		// sit strictly further out and nothing collapses onto one point.
		const radius = (index: number) =>
			Math.hypot(laidOut[index].x - 400, laidOut[index].y - 240);
		expect(radius(0)).toBeLessThan(radius(50));
		expect(radius(50)).toBeLessThan(radius(399));
		expect(new Set(laidOut.map((node) => `${node.x},${node.y}`)).size).toBe(400);
	});
});
