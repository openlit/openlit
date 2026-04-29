import { transformTracesToGraph, getParallelPairs } from "@/lib/platform/graph-transform";

const span = (
	SpanId: string,
	Timestamp: string,
	Duration: number,
	children = []
) => ({
	SpanId,
	SpanName: SpanId,
	Timestamp,
	Duration,
	children,
});

describe("graph transform", () => {
	it("builds a sequential execution chain for non-overlapping children", () => {
		const root = span("root", "2026-01-01T00:00:00.000Z", 200_000_000, [
			span("a", "2026-01-01T00:00:00.000Z", 100_000_000),
			span("b", "2026-01-01T00:00:00.100Z", 50_000_000),
			span("c", "2026-01-01T00:00:00.120Z", 20_000_000),
		]);

		const graph = transformTracesToGraph(root);
		const edgeKeys = graph.edges.map((edge) => `${edge.kind}:${edge.from}->${edge.to}`);

		expect(edgeKeys).toEqual(expect.arrayContaining([
			"SEQUENTIAL:root->a",
			"SEQUENTIAL:a->b",
			"PARALLEL:b->c",
		]));
		expect(edgeKeys).not.toContain("DELEGATED:root->a");
		expect(edgeKeys).not.toContain("DELEGATED:root->b");
		expect(getParallelPairs(root)).toEqual(new Set(["b|c"]));

		expect(graph.nodes.get("root")!.y).toBeLessThan(graph.nodes.get("a")!.y);
		expect(graph.nodes.get("a")!.y).toBeLessThan(graph.nodes.get("b")!.y);
		expect(graph.nodes.get("b")!.y).toBe(graph.nodes.get("c")!.y);
	});

	it("links parent to first child then child one to child two for nested tool spans", () => {
		const root = span("tool", "2026-04-28 09:20:28.191000000", "12280349416" as any, [
			span("blocked", "2026-04-28 09:20:28.192000000", "2186599875" as any),
			span("execution", "2026-04-28 09:20:30.405000000", "10066277083" as any),
		]);

		const graph = transformTracesToGraph(root);
		const edgeKeys = graph.edges.map((edge) => `${edge.kind}:${edge.from}->${edge.to}`);

		expect(edgeKeys).toEqual([
			"SEQUENTIAL:tool->blocked",
			"SEQUENTIAL:blocked->execution",
		]);
	});

	it("treats late tail overlap as sequential handoff, not parallel", () => {
		const root = span("interaction", "2026-04-28 09:20:09.276000000", "355460816917" as any, [
			span("llm", "2026-04-28 09:20:17.804000000", "12724790542" as any),
			span("tool", "2026-04-28 09:20:28.191000000", "12280349416" as any),
		]);

		const graph = transformTracesToGraph(root);
		const edgeKeys = graph.edges.map((edge) => `${edge.kind}:${edge.from}->${edge.to}`);

		expect(edgeKeys).toEqual([
			"SEQUENTIAL:interaction->llm",
			"SEQUENTIAL:llm->tool",
		]);
	});

	it("lays out execution vertically with child spans indented", () => {
		const root = span("root", "2026-01-01T00:00:00.000Z", 300_000_000, [
			span("left", "2026-01-01T00:00:00.000Z", 50_000_000, [
				span("left-child", "2026-01-01T00:00:00.010Z", 10_000_000),
			]),
			span("right", "2026-01-01T00:00:00.080Z", 20_000_000),
		]);

		const graph = transformTracesToGraph(root);
		const rootNode = graph.nodes.get("root")!;
		const leftNode = graph.nodes.get("left")!;
		const leftChildNode = graph.nodes.get("left-child")!;
		const rightNode = graph.nodes.get("right")!;

		expect(leftNode.x).toBeGreaterThan(rootNode.x);
		expect(leftChildNode.x).toBeGreaterThan(leftNode.x);
		expect(leftNode.y).toBeGreaterThan(rootNode.y);
		expect(leftChildNode.y).toBeGreaterThan(leftNode.y);
		expect(rightNode.y).toBeGreaterThan(leftChildNode.y);
	});
});
