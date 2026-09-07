import {
	collapseToRootSpans,
	fetchSpansForAggregation,
	fetchSpansForList,
	pickRootSpan,
} from "@/lib/platform/connectors/datasource/graph/sample-fetch";
import { __clearCache } from "@/lib/platform/connectors/datasource/http/cache";
import type { NormalizedSpan, OpenLITQuery } from "@/lib/platform/connectors/datasource/types";

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

beforeEach(() => {
	__clearCache();
});

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

	it("does not use AI-only service discovery for a flat trace list", async () => {
		let discovered = false;
		let sampled = false;
		const source = {
			discoverServices: async () => {
				discovered = true;
				return [];
			},
			sampleTracesForGraph: async () => {
				sampled = true;
				return [span({ traceId: "flat-list-trace" })];
			},
		};

		const result = await fetchSpansForList(
			source,
			{ ...windowQuery, aiSelector: false },
			{ maxRows: 10, skipCache: true }
		);

		expect(discovered).toBe(false);
		expect(sampled).toBe(true);
		expect(result.spans).toHaveLength(1);
	});

	it("extracts service names from array-valued and scalar service.name filters", async () => {
		const calls: string[] = [];
		const source = {
			discoverServices: async () => {
				throw new Error("should not discover when filters already scope services");
			},
			sampleTracesForGraph: async (q: OpenLITQuery) => {
				const value = (q.filters || []).find((f) => f.key === "service.name")
					?.value;
				calls.push(String(value));
				return [
					span({
						spanId: `s-${value}`,
						traceId: `t-${value}`,
						serviceName: String(value),
					}),
				];
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
						key: "http.method",
						op: "eq",
						value: "GET",
					},
					{
						target: "attribute",
						scope: "resource",
						key: "service.name",
						op: "in",
						value: ["svc-a", "", "svc-b"],
					},
				],
			},
			{ maxRows: 10, skipCache: true }
		);

		expect(calls.sort()).toEqual(["svc-a", "svc-b"]);
		expect(result.spans).toHaveLength(2);
	});

	it("returns null from stratification when discoverServices throws with no service filter", async () => {
		let sampleCalls = 0;
		const source = {
			discoverServices: async () => {
				throw new Error("discovery unavailable");
			},
			sampleTracesForGraph: async () => {
				sampleCalls += 1;
				return [span({ spanId: "1" })];
			},
		};

		const result = await fetchSpansForAggregation(source, windowQuery, {
			skipCache: true,
		});

		expect(sampleCalls).toBe(1);
		expect(result.spans).toHaveLength(1);
	});

	it("returns empty spans when the source has neither sampleTracesForGraph nor listSpans", async () => {
		const result = await fetchSpansForAggregation(
			{},
			windowQuery,
			{ skipCache: true }
		);
		expect(result).toEqual({ spans: [], truncated: false });
	});

	it("returns flat listSpans rows unchanged when they are not roots-only", async () => {
		const child = span({
			spanId: "child",
			traceId: "t1",
			parentSpanId: "root-not-included",
		});
		const source = {
			listSpans: async () => ({ fields: [], rows: [child] }),
			getTraceSpans: async () => {
				throw new Error("should not expand a non-roots-only list");
			},
		};

		const result = await fetchSpansForAggregation(source, windowQuery, {
			skipCache: true,
		});

		expect(result.spans).toEqual([child]);
	});

	it("uses the cache path for fetchSpansForAggregation when skipCache is not set", async () => {
		let calls = 0;
		const source = {
			sampleCacheKey: "agg-cache-test-source",
			sampleTracesForGraph: async () => {
				calls += 1;
				return [span({ spanId: "1" })];
			},
		};

		const first = await fetchSpansForAggregation(source, windowQuery);
		const second = await fetchSpansForAggregation(source, windowQuery);

		expect(first.spans).toEqual(second.spans);
		expect(calls).toBe(1);
	});

	it("uses the cache path when skipCache is not set", async () => {
		let calls = 0;
		const source = {
			sampleCacheKey: "cache-test-source",
			sampleTracesForGraph: async () => {
				calls += 1;
				return [span({ spanId: "1" })];
			},
		};

		const first = await fetchSpansForList(source, windowQuery, { maxRows: 5 });
		const second = await fetchSpansForList(source, windowQuery, { maxRows: 5 });

		expect(first.spans).toEqual(second.spans);
		expect(calls).toBe(1);
	});

	it("dedupes repeated trace ids from a full-trace stratified sample", async () => {
		const source = {
			discoverServices: async () => [
				{ serviceName: "a", environment: "default", clusterId: "default" },
				{ serviceName: "b", environment: "default", clusterId: "default" },
			],
			sampleTracesForGraph: async (q: OpenLITQuery) => {
				const value = String(
					(q.filters || []).find((f) => f.key === "service.name")?.value || ""
				);
				// Simulate a full trace: multiple spans share the same traceId.
				return [
					span({ spanId: `${value}-root`, traceId: `t-${value}` }),
					span({
						spanId: `${value}-child`,
						traceId: `t-${value}`,
						parentSpanId: `${value}-root`,
					}),
				];
			},
		};

		const result = await fetchSpansForAggregation(source, windowQuery, {
			maxTraces: 10,
			skipCache: true,
		});

		const traceIds = new Set(result.spans.map((s) => s.traceId));
		expect(traceIds.size).toBe(2);
		expect(result.spans).toHaveLength(4);
	});

	it("returns null from stratification when discovery resolves to a single service", async () => {
		let sampleCalls = 0;
		const source = {
			discoverServices: async () => [
				{ serviceName: "only-service", environment: "default", clusterId: "default" },
			],
			sampleTracesForGraph: async () => {
				sampleCalls += 1;
				return [span({ spanId: "1" })];
			},
		};

		const result = await fetchSpansForAggregation(source, windowQuery, {
			skipCache: true,
		});

		expect(sampleCalls).toBe(1);
		expect(result.spans).toHaveLength(1);
	});

	it("distributes an uneven trace budget so the first services get the remainder", async () => {
		const requested: Record<string, number> = {};
		const source = {
			discoverServices: async () => [
				{ serviceName: "a", environment: "default", clusterId: "default" },
				{ serviceName: "b", environment: "default", clusterId: "default" },
				{ serviceName: "c", environment: "default", clusterId: "default" },
			],
			sampleTracesForGraph: async (q: OpenLITQuery, limit: number) => {
				const value = String(
					(q.filters || []).find((f) => f.key === "service.name")?.value || ""
				);
				requested[value] = limit;
				return [];
			},
		};

		await fetchSpansForAggregation(source, windowQuery, {
			maxTraces: 10,
			skipCache: true,
		});

		expect(requested).toEqual({ a: 4, b: 3, c: 3 });
	});

	it("treats an explicit meta.truncated flag as truncated regardless of row count", async () => {
		const source = {
			listSpans: async () => ({
				fields: [],
				rows: [span({ spanId: "1", parentSpanId: "not-a-root" })],
				meta: { truncated: true },
			}),
		};

		const result = await fetchSpansForAggregation(source, windowQuery, {
			skipCache: true,
		});

		expect(result.truncated).toBe(true);
	});

	it("defaults listSpans rows to [] when the frame omits rows", async () => {
		const source = {
			listSpans: async () => ({ fields: [] }) as unknown as {
				fields: never[];
				rows: NormalizedSpan[];
			},
		};

		const result = await fetchSpansForAggregation(source, windowQuery, {
			skipCache: true,
		});

		expect(result.spans).toEqual([]);
	});

	it("falls back to AGGREGATE_SAMPLE_TRACE_CAP when neither opts.maxTraces nor query.limit is set", async () => {
		let receivedLimit: number | undefined;
		const source = {
			sampleTracesForGraph: async (_q: OpenLITQuery, limit: number) => {
				receivedLimit = limit;
				return [];
			},
		};
		const { limit: _omit, ...queryWithoutLimit } = windowQuery;

		await fetchSpansForAggregation(source, queryWithoutLimit, { skipCache: true });

		expect(receivedLimit).toBe(200);
	});

	it("falls back to DEFAULT_SAMPLE_TRACE_CAP for fetchSpansForList when nothing else is set", async () => {
		const source = {
			sampleTracesForGraph: async () => [span({ spanId: "1" })],
		};
		const { limit: _omit, ...queryWithoutLimit } = windowQuery;

		const result = await fetchSpansForList(source, queryWithoutLimit, {
			skipCache: true,
		});

		expect(result.spans).toHaveLength(1);
	});

	it("uses query.limit for fetchSpansForList maxRows when opts.maxRows is not set", async () => {
		const source = {
			sampleTracesForGraph: async () => [
				span({ spanId: "1" }),
				span({ spanId: "2", traceId: "t2" }),
			],
		};

		const result = await fetchSpansForList(
			source,
			{ ...windowQuery, limit: 1 },
			{ skipCache: true }
		);

		expect(result.spans.length).toBeLessThanOrEqual(1);
	});
});

describe("pickRootSpan", () => {
	it("returns undefined for an empty span list", () => {
		expect(pickRootSpan([])).toBeUndefined();
	});

	it("falls back to the first span when none matches the root parent condition", () => {
		const a = span({ spanId: "a", parentSpanId: "not-a-root" });
		const b = span({ spanId: "b", parentSpanId: "also-not-a-root" });
		expect(pickRootSpan([a, b])).toBe(a);
	});

	it("matches the all-zero root parent id", () => {
		const zeroParent = span({
			spanId: "z",
			parentSpanId: "0".repeat(16),
		});
		const other = span({ spanId: "o", parentSpanId: "not-a-root" });
		expect(pickRootSpan([other, zeroParent])).toBe(zeroParent);
	});
});

describe("collapseToRootSpans", () => {
	it("skips spans without a traceId and sorts missing timestamps last", () => {
		const noTraceId = { ...span({ spanId: "no-trace" }), traceId: "" };
		const noTimestamp = {
			...span({ spanId: "no-ts", traceId: "t-no-ts" }),
			timestamp: "",
		};
		const withTimestamp = span({
			spanId: "with-ts",
			traceId: "t-with-ts",
			timestamp: "2026-07-11T12:00:00.000Z",
		});

		const roots = collapseToRootSpans([noTraceId, noTimestamp, withTimestamp]);

		expect(roots.map((r) => r.spanId)).toEqual(["with-ts", "no-ts"]);
	});

	it("sorts consistently when the missing-timestamp span is compared first", () => {
		const noTimestampFirst = {
			...span({ spanId: "no-ts-1", traceId: "t-a" }),
			timestamp: "",
		};
		const noTimestampSecond = {
			...span({ spanId: "no-ts-2", traceId: "t-b" }),
			timestamp: "",
		};

		const roots = collapseToRootSpans([noTimestampFirst, noTimestampSecond]);

		expect(roots.map((r) => r.spanId).sort()).toEqual(["no-ts-1", "no-ts-2"]);
	});
});
