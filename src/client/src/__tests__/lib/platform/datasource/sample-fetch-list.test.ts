import {
	collapseToRootSpans,
	fetchSpansForList,
	pickRootSpan,
} from "@/lib/platform/datasource/graph/sample-fetch";
import type { NormalizedSpan, OpenLITQuery } from "@/lib/platform/datasource/types";

function span(partial: Partial<NormalizedSpan>): NormalizedSpan {
	return {
		traceId: "t1",
		spanId: "s1",
		parentSpanId: "",
		name: "root",
		serviceName: "svc",
		timestamp: "2026-07-11T12:00:00.000Z",
		durationNs: 1,
		statusCode: "STATUS_CODE_OK",
		spanAttributes: {},
		resourceAttributes: {},
		...partial,
	};
}

const windowQuery: OpenLITQuery = {
	signal: "traces",
	timeRange: {
		start: new Date("2026-07-11T00:00:00.000Z"),
		end: new Date("2026-07-11T12:00:00.000Z"),
	},
	aiSelector: true,
};

describe("sample-fetch list stratification", () => {
	it("picks root span and collapses one root per trace", () => {
		const root = span({
			spanId: "root",
			parentSpanId: "",
			timestamp: "2026-07-11T12:00:00.000Z",
		});
		const child = span({
			spanId: "child",
			parentSpanId: "root",
			timestamp: "2026-07-11T12:00:01.000Z",
		});
		expect(pickRootSpan([child, root])?.spanId).toBe("root");
		expect(collapseToRootSpans([root, child, span({ traceId: "t2", spanId: "r2" })])).toHaveLength(
			2
		);
	});

	it("fans out across discoverServices when unscoped", async () => {
		const calls: string[] = [];
		const source = {
			discoverServices: async () => [
				{ serviceName: "demo-openai-app", environment: "default", clusterId: "default" },
				{ serviceName: "demo-anthropic-app", environment: "default", clusterId: "default" },
			],
			sampleTracesForGraph: async (q: OpenLITQuery) => {
				const svc =
					(q.filters || []).find((f) => f.key === "service.name")?.value ||
					"unknown";
				calls.push(String(svc));
				return [
					span({
						traceId: `t-${svc}`,
						spanId: `s-${svc}`,
						serviceName: String(svc),
					}),
				];
			},
		};
		const result = await fetchSpansForList(source, windowQuery, {
			maxRows: 10,
			skipCache: true,
		});
		expect(calls.sort()).toEqual(["demo-anthropic-app", "demo-openai-app"]);
		expect(result.spans.map((s) => s.serviceName).sort()).toEqual([
			"demo-anthropic-app",
			"demo-openai-app",
		]);
	});

	it("skips stratification when service.name filter is already set", async () => {
		let calls = 0;
		const source = {
			discoverServices: async () => {
				throw new Error("should not discover");
			},
			sampleTracesForGraph: async () => {
				calls += 1;
				return [span({ serviceName: "only-one" })];
			},
		};
		const result = await fetchSpansForList(
			source,
			{
				...windowQuery,
				filters: [
					{
						target: "attribute",
						scope: "resource",
						key: "service.name",
						op: "eq",
						value: "only-one",
					},
				],
			},
			{ maxRows: 10, skipCache: true }
		);
		expect(calls).toBe(1);
		expect(result.spans[0]?.serviceName).toBe("only-one");
	});
});
