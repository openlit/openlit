import {
	buildMemoryGraph,
	classifyMemoryKind,
	layoutMemoryGraph,
	summarizeMemoryStats,
} from "@/lib/platform/connectors/memory/graph";
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
});
