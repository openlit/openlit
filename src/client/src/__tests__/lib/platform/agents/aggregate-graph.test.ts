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
	type AggregateEdge,
	type AggregateNode,
} from "@/lib/platform/agents/aggregate-graph";

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
