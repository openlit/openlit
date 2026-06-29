/**
 * Aggregate per-version DAG helpers.
 *
 * The full `getAggregateGraph()` is exercised end-to-end against a live
 * ClickHouse via the E2E suite; here we cover the pure topology helper
 * (`assignDepths`) that drives the canvas layout. Putting it under tests
 * means future canvas tweaks can't silently regress parent-above-child
 * ordering.
 */

jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
	OTEL_LOGS_TABLE_NAME: "otel_logs",
}));

import {
	assignDepths,
	getAggregateGraph,
	type AggregateEdge,
	type AggregateNode,
} from "@/lib/platform/agents/aggregate-graph";
import { dataCollector } from "@/lib/platform/common";

const mockDataCollector = jest.mocked(dataCollector);

function node(id: string): AggregateNode {
	return {
		id,
		spanName: id,
		spanCount: 1,
		p50Ms: 0,
		errorRate: 0,
		depth: 0,
		kind: "span",
	};
}

function edge(from: string, to: string): AggregateEdge {
	return { from, to, count: 1, p50Ms: 0, errorRate: 0 };
}

describe("assignDepths", () => {
	it("assigns depth 0 to a single root node", () => {
		const nodes = [node("a")];
		assignDepths(nodes, []);
		expect(nodes[0].depth).toBe(0);
	});

	it("places children one level below the parent", () => {
		const nodes = [node("root"), node("child")];
		assignDepths(nodes, [edge("root", "child")]);
		expect(nodes.find((n) => n.id === "root")!.depth).toBe(0);
		expect(nodes.find((n) => n.id === "child")!.depth).toBe(1);
	});

	it("uses the longest path when a node has multiple parents", () => {
		// root -> mid -> leaf
		//   \-----------> leaf  (still depth=2 because mid is the longer path)
		const nodes = [node("root"), node("mid"), node("leaf")];
		const edges = [edge("root", "mid"), edge("mid", "leaf"), edge("root", "leaf")];
		assignDepths(nodes, edges);
		expect(nodes.find((n) => n.id === "root")!.depth).toBe(0);
		expect(nodes.find((n) => n.id === "mid")!.depth).toBe(1);
		expect(nodes.find((n) => n.id === "leaf")!.depth).toBe(2);
	});

	it("places independent roots at depth 0", () => {
		const nodes = [node("a"), node("b"), node("c")];
		assignDepths(nodes, [edge("a", "c"), edge("b", "c")]);
		expect(nodes.find((n) => n.id === "a")!.depth).toBe(0);
		expect(nodes.find((n) => n.id === "b")!.depth).toBe(0);
		expect(nodes.find((n) => n.id === "c")!.depth).toBe(1);
	});

	it("clamps cycles to depth 0 instead of looping forever", () => {
		// Real production traces shouldn't contain cycles; guard anyway.
		const nodes = [node("a"), node("b")];
		assignDepths(nodes, [edge("a", "b"), edge("b", "a")]);
		expect(Number.isFinite(nodes[0].depth)).toBe(true);
		expect(Number.isFinite(nodes[1].depth)).toBe(true);
	});

	it("ignores edges that reference missing nodes", () => {
		const nodes = [node("root")];
		// `phantom` doesn't exist in nodes — depth assignment should ignore it.
		assignDepths(nodes, [edge("root", "phantom"), edge("phantom", "root")]);
		expect(nodes[0].depth).toBe(0);
	});

	it("handles a fan-out tree (1 -> N) deterministically", () => {
		const nodes = [
			node("router"),
			node("tool_a"),
			node("tool_b"),
			node("tool_c"),
		];
		const edges = [
			edge("router", "tool_a"),
			edge("router", "tool_b"),
			edge("router", "tool_c"),
		];
		assignDepths(nodes, edges);
		expect(nodes.find((n) => n.id === "router")!.depth).toBe(0);
		expect(nodes.find((n) => n.id === "tool_a")!.depth).toBe(1);
		expect(nodes.find((n) => n.id === "tool_b")!.depth).toBe(1);
		expect(nodes.find((n) => n.id === "tool_c")!.depth).toBe(1);
	});
});

describe("getAggregateGraph", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockDataCollector.mockResolvedValue({ err: null, data: [] });
	});

	it("normalizes span, edge, tool, and trace-count rows", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: null,
			data: [
				{
					kind: "node",
					source: "agent.request",
					target: "",
					edge_count: "4",
					p50_ms: "12.5",
					error_rate: "0.25",
				},
				{
					kind: "node",
					source: "agent.child",
					target: "",
					edge_count: "2",
					p50_ms: "8",
					error_rate: "0",
				},
				{
					kind: "edge",
					source: "agent.request",
					target: "agent.child",
					edge_count: "2",
					p50_ms: "8",
					error_rate: "0",
				},
				{
					kind: "edge",
					source: "agent.child",
					target: "agent.child",
					edge_count: "1",
					p50_ms: "1",
					error_rate: "1",
				},
				{
					kind: "tool_edge",
					source: "agent.request",
					target: "lookup_docs",
					edge_count: "3",
					p50_ms: "6",
					error_rate: "0.1",
				},
				{
					kind: "tool_edge",
					source: "agent.child",
					target: "lookup_docs",
					edge_count: "1",
					p50_ms: "10",
					error_rate: "0.2",
				},
				{
					kind: "tool_edge",
					source: "agent.child",
					target: "   ",
					edge_count: "99",
					p50_ms: "99",
					error_rate: "1",
				},
				{
					kind: "trace_count",
					source: "",
					target: "",
					edge_count: "7",
					p50_ms: 0,
					error_rate: 0,
				},
			],
		});

		await expect(
			getAggregateGraph({
				serviceName: "api",
				environment: "production",
				maxTraces: 10,
				versionFilter: {
					versionHash: "v1",
					firstSeen: "2026-01-01T00:00:00Z",
					lastSeen: "2026-01-02T00:00:00Z",
					hasAttributeSpans: true,
				},
				dbConfigId: "db-1",
			})
		).resolves.toEqual({
			traceCount: 7,
			spanCount: 6,
			nodes: expect.arrayContaining([
				expect.objectContaining({
					id: "agent.request",
					spanCount: 4,
					p50Ms: 12.5,
					errorRate: 0.25,
					depth: 0,
					kind: "span",
				}),
				expect.objectContaining({
					id: "agent.child",
					depth: 1,
					kind: "span",
				}),
				expect.objectContaining({
					id: "tool:lookup_docs",
					spanName: "lookup_docs",
					spanCount: 4,
					p50Ms: 7,
					errorRate: 0.125,
					depth: 2,
					kind: "tool",
				}),
			]),
			edges: expect.arrayContaining([
				{
					from: "agent.request",
					to: "agent.child",
					count: 2,
					p50Ms: 8,
					errorRate: 0,
				},
				{
					from: "agent.request",
					to: "tool:lookup_docs",
					count: 3,
					p50Ms: 6,
					errorRate: 0.1,
				},
			]),
		});

		const { query } = mockDataCollector.mock.calls[0][0] as { query: string };
		expect(query).toContain("ServiceName = 'api'");
		expect(query).toContain("ResourceAttributes['deployment.environment'] = 'production'");
		expect(query).toContain("LIMIT 50");
		expect(mockDataCollector).toHaveBeenCalledWith(
			{ query: expect.any(String) },
			"query",
			"db-1"
		);
	});

	it("uses default environment and 24h fallback without a version filter", async () => {
		await getAggregateGraph({ serviceName: "api" });

		const { query } = mockDataCollector.mock.calls[0][0] as { query: string };
		expect(query).toContain(
			"ResourceAttributes['deployment.environment'] = 'default'"
		);
		expect(query).toContain("Timestamp >= now() - INTERVAL 24 HOUR");
		expect(query).toContain("LIMIT 500");
	});

	it("logs query failures and returns an empty graph", async () => {
		const errorSpy = jest.spyOn(console, "error").mockImplementation();
		mockDataCollector.mockResolvedValueOnce({ err: "boom", data: [] });

		await expect(getAggregateGraph({ serviceName: "api" })).resolves.toEqual({
			nodes: [],
			edges: [],
			traceCount: 0,
			spanCount: 0,
		});

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("aggregate_graph_query_failed")
		);
		errorSpy.mockRestore();
	});
});
