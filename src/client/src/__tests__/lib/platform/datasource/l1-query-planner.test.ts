import { mapPool } from "@/lib/platform/datasource/graph/map-pool";
import {
	aggregateSpansInProcess,
	bucketSpansByInterval,
	distinctFromSpans,
	looksLikeRootsOnly,
	spanFieldValue,
} from "@/lib/platform/datasource/graph/sample-aggregate";
import { fetchSpansForAggregation } from "@/lib/platform/datasource/graph/sample-fetch";
import {
	computeAggregateSpansL1,
	computeSpanTimeSeriesL1,
} from "@/lib/platform/datasource/l1-compute";
import {
	intervalFromTimeRange,
	planAndAggregateSpans,
	planAndSpanTimeSeries,
} from "@/lib/platform/datasource/query-planner";
import { __clearCache } from "@/lib/platform/datasource/http/cache";
import {
	UnsupportedCapabilityError,
	type DataSourceAdapter,
	type NormalizedSpan,
	type OpenLITQuery,
	type SourceCapabilities,
} from "@/lib/platform/datasource/types";

function span(partial: Partial<NormalizedSpan> & Pick<NormalizedSpan, "spanId">): NormalizedSpan {
	return {
		traceId: partial.traceId || "t1",
		spanId: partial.spanId,
		parentSpanId: partial.parentSpanId ?? "",
		name: partial.name || "chat",
		serviceName: partial.serviceName ?? "api",
		timestamp: partial.timestamp || "2026-07-11T12:30:00.000Z",
		durationNs: partial.durationNs ?? 1_500_000_000,
		statusCode: partial.statusCode || "STATUS_CODE_OK",
		spanAttributes: partial.spanAttributes || {},
		resourceAttributes: partial.resourceAttributes || {},
		cost: partial.cost,
	};
}

const windowQuery: OpenLITQuery = {
	signal: "traces",
	timeRange: {
		start: new Date("2026-07-11T00:00:00.000Z"),
		end: new Date("2026-07-11T23:59:59.000Z"),
	},
	limit: 50,
};

beforeEach(() => {
	__clearCache();
});

describe("mapPool", () => {
	it("preserves order under concurrency cap", async () => {
		const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
			await new Promise((r) => setTimeout(r, 5 - n));
			return n * 10;
		});
		expect(out).toEqual([10, 20, 30, 40, 50]);
	});
});

describe("spanFieldValue", () => {
	it("converts duration ns to seconds", () => {
		const s = span({ spanId: "a", durationNs: 2_000_000_000 });
		expect(spanFieldValue(s, "duration")).toBe(2);
	});

	it("resolves cost and tokens from attributes", () => {
		const s = span({
			spanId: "a",
			spanAttributes: {
				"gen_ai.usage.cost": "0.42",
				"gen_ai.usage.total_tokens": "120",
			},
		});
		expect(spanFieldValue(s, "cost")).toBe(0.42);
		expect(spanFieldValue(s, "tokens")).toBe(120);
	});

	it("resolves service.name and SpanName", () => {
		const s = span({
			spanId: "a",
			name: "openai.chat",
			serviceName: "",
			resourceAttributes: { "service.name": "worker" },
		});
		expect(spanFieldValue(s, "SpanName")).toBe("openai.chat");
		expect(spanFieldValue(s, "service.name")).toBe("worker");
	});
});

describe("sample-aggregate", () => {
	const spans = [
		span({
			spanId: "1",
			traceId: "t1",
			timestamp: "2026-07-11T10:15:00.000Z",
			durationNs: 1e9,
			spanAttributes: { "gen_ai.usage.cost": "1", "gen_ai.request.model": "gpt-4" },
		}),
		span({
			spanId: "2",
			traceId: "t1",
			timestamp: "2026-07-11T10:45:00.000Z",
			durationNs: 3e9,
			spanAttributes: { "gen_ai.usage.cost": "2", "gen_ai.request.model": "gpt-4" },
		}),
		span({
			spanId: "3",
			traceId: "t2",
			timestamp: "2026-07-11T11:10:00.000Z",
			durationNs: 2e9,
			spanAttributes: { "gen_ai.usage.cost": "3", "gen_ai.request.model": "gpt-3.5" },
		}),
	];

	it("bucketSpansByInterval groups by hour with request_time ISO", () => {
		const frame = bucketSpansByInterval(spans, "1h", [
			{ fn: "count", as: "total" },
			{ fn: "sum", field: "cost", as: "cost" },
		]);
		expect(frame.rows).toHaveLength(2);
		expect(frame.rows[0]).toMatchObject({
			bucket: "2026-07-11T10:00:00.000Z",
			request_time: "2026-07-11T10:00:00.000Z",
			total: 2,
			cost: 3,
		});
		expect(frame.rows[1]).toMatchObject({ total: 1, cost: 3 });
	});

	it("bucketSpansByInterval zero-fills the requested time range", () => {
		const frame = bucketSpansByInterval(
			[
				span({
					spanId: "1",
					timestamp: "2026-07-11T10:15:00.000Z",
				}),
			],
			"1h",
			[{ fn: "count", as: "total" }],
			{
				start: new Date("2026-07-11T09:00:00.000Z"),
				end: new Date("2026-07-11T11:00:00.000Z"),
			}
		);
		expect(frame.rows).toHaveLength(3);
		expect(frame.rows.map((r) => (r as { total: number }).total)).toEqual([
			0, 1, 0,
		]);
	});

	it("aggregateSpansInProcess groups and exposes group_value", () => {
		const frame = aggregateSpansInProcess(
			spans,
			["gen_ai.request.model"],
			[{ fn: "count", as: "n" }, { fn: "p50", field: "duration", as: "p50" }]
		);
		expect(frame.rows).toHaveLength(2);
		const gpt4 = frame.rows.find(
			(r) => (r as { group_value: string }).group_value === "gpt-4"
		) as { n: number; p50: number };
		expect(gpt4.n).toBe(2);
		expect(gpt4.p50).toBe(1);
	});

	it("aggregateSpansInProcess returns one row when groupBy empty", () => {
		const frame = aggregateSpansInProcess(spans, [], [{ fn: "count", as: "n" }]);
		expect(frame.rows).toEqual([{ n: 3 }]);
	});

	it("distinctFromSpans returns sorted unique values", () => {
		expect(distinctFromSpans(spans, "gen_ai.request.model")).toEqual([
			"gpt-3.5",
			"gpt-4",
		]);
	});

	it("looksLikeRootsOnly detects one root per trace", () => {
		expect(
			looksLikeRootsOnly([
				span({ spanId: "a", traceId: "t1", parentSpanId: "" }),
				span({ spanId: "b", traceId: "t2", parentSpanId: "0".repeat(16) }),
			])
		).toBe(true);
		expect(
			looksLikeRootsOnly([
				span({ spanId: "a", traceId: "t1", parentSpanId: "" }),
				span({ spanId: "b", traceId: "t1", parentSpanId: "a" }),
			])
		).toBe(false);
	});
});

describe("fetchSpansForAggregation", () => {
	it("prefers sampleTracesForGraph", async () => {
		const spans = [span({ spanId: "1" })];
		const result = await fetchSpansForAggregation(
			{
				sampleTracesForGraph: async () => spans,
				listSpans: async () => {
					throw new Error("should not list");
				},
			},
			windowQuery,
			{ skipCache: true }
		);
		expect(result.spans).toBe(spans);
	});

	it("expands roots-only listSpans via getTraceSpans", async () => {
		const root = span({ spanId: "root", traceId: "t1", parentSpanId: "" });
		const child = span({ spanId: "child", traceId: "t1", parentSpanId: "root" });
		const result = await fetchSpansForAggregation(
			{
				listSpans: async () => ({ fields: [], rows: [root] }),
				getTraceSpans: async () => [root, child],
			},
			windowQuery,
			{ skipCache: true }
		);
		expect(result.spans).toHaveLength(2);
	});

	it("stratifies across discovered services", async () => {
		const calls: string[] = [];
		const result = await fetchSpansForAggregation(
			{
				discoverServices: async () => [
					{ serviceName: "demo-openai-app", environment: "default", clusterId: "default" },
					{ serviceName: "demo-anthropic-app", environment: "default", clusterId: "default" },
				],
				sampleTracesForGraph: async (query) => {
					const service = String(
						query.filters?.find((f) => f.key === "service.name")?.value || ""
					);
					calls.push(service);
					return [
						span({
							spanId: `${service}-1`,
							traceId: `${service}-t`,
							serviceName: service,
						}),
					];
				},
			},
			windowQuery,
			{ skipCache: true }
		);
		expect(calls.sort()).toEqual(["demo-anthropic-app", "demo-openai-app"]);
		expect(result.spans.map((s) => s.serviceName).sort()).toEqual([
			"demo-anthropic-app",
			"demo-openai-app",
		]);
		expect(result.truncated).toBe(true);
	});

	it("does not re-stratify adapters that already fan out per service", async () => {
		let calls = 0;
		const spans = [span({ spanId: "1", serviceName: "a" })];
		const result = await fetchSpansForAggregation(
			{
				samplesAreServiceStratified: true,
				discoverServices: async () => [
					{ serviceName: "a", environment: "default", clusterId: "default" },
					{ serviceName: "b", environment: "default", clusterId: "default" },
				],
				sampleTracesForGraph: async () => {
					calls += 1;
					return spans;
				},
			},
			windowQuery,
			{ skipCache: true }
		);
		expect(calls).toBe(1);
		expect(result.spans).toBe(spans);
	});
});

describe("l1-compute", () => {
	it("sets degraded serverAggregation meta", async () => {
		const spans = [
			span({
				spanId: "1",
				timestamp: "2026-07-11T10:00:00.000Z",
				spanAttributes: { "gen_ai.usage.cost": "1" },
			}),
		];
		const source = {
			sampleTracesForGraph: async () => spans,
		};
		const agg = await computeAggregateSpansL1(source, {
			...windowQuery,
			aggregations: [{ fn: "sum", field: "cost", as: "cost" }],
		});
		expect(agg.meta?.degraded).toEqual(["serverAggregation"]);
		expect(agg.meta?.rowsScanned).toBe(1);
		expect(agg.rows[0]).toMatchObject({ cost: 1 });

		const ts = await computeSpanTimeSeriesL1(source, {
			...windowQuery,
			interval: "1h",
			aggregations: [{ fn: "count", as: "total" }],
		});
		expect(ts.meta?.degraded).toContain("serverAggregation");
		const nonEmpty = ts.rows.find((r) => Number((r as any).total) > 0);
		expect(nonEmpty).toMatchObject({ total: 1 });
		expect(ts.rows.length).toBeGreaterThan(1);
	});
});

describe("query-planner", () => {
	it("intervalFromTimeRange maps dateTrunc units", () => {
		expect(
			intervalFromTimeRange(
				new Date("2026-07-11T00:00:00.000Z"),
				new Date("2026-07-11T12:00:00.000Z")
			)
		).toBe("1h");
		expect(
			intervalFromTimeRange(
				new Date("2026-07-01T00:00:00.000Z"),
				new Date("2026-07-10T00:00:00.000Z")
			)
		).toBe("1d");
	});

	it("preferRollup uses readRollup when present", async () => {
		const frame = await planAndAggregateSpans(
			{} as DataSourceAdapter,
			windowQuery,
			{
				preferRollup: true,
				readRollup: async () => ({
					fields: [],
					rows: [{ n: 9 }],
				}),
			}
		);
		expect(frame.rows).toEqual([{ n: 9 }]);
		expect(frame.meta?.degraded).toContain("rollup");
	});

	it("falls back to L1 on UnsupportedCapabilityError", async () => {
		const spans = [span({ spanId: "1", spanAttributes: { "gen_ai.usage.cost": "5" } })];
		const adapter = {
			capabilities: (): SourceCapabilities => ({
				signals: ["traces"],
				traceTree: true,
				spanEvents: true,
				serverAggregation: false,
				spanMutation: false,
				distinctValues: false,
				crossTraceSession: false,
				rawQuery: false,
			}),
			aggregateSpans: async () => {
				throw new UnsupportedCapabilityError("tempo", "aggregateSpans");
			},
			spanTimeSeries: async () => {
				throw new UnsupportedCapabilityError("tempo", "spanTimeSeries");
			},
			sampleTracesForGraph: async () => spans,
		} as unknown as DataSourceAdapter;

		const agg = await planAndAggregateSpans(adapter, {
			...windowQuery,
			aggregations: [{ fn: "sum", field: "cost", as: "cost" }],
		});
		expect(agg.rows[0]).toMatchObject({ cost: 5 });
		expect(agg.meta?.degraded).toContain("serverAggregation");

		const ts = await planAndSpanTimeSeries(adapter, {
			...windowQuery,
			interval: "1h",
			aggregations: [{ fn: "count", as: "total" }],
		});
		const nonEmpty = ts.rows.find((r) => Number((r as { total?: number }).total) > 0);
		expect(nonEmpty).toMatchObject({ total: 1 });
		expect(ts.rows.length).toBeGreaterThan(1);
	});

	it("uses native adapter method when serverAggregation is true", async () => {
		const adapter = {
			capabilities: (): SourceCapabilities => ({
				signals: ["traces"],
				traceTree: true,
				spanEvents: true,
				serverAggregation: true,
				spanMutation: false,
				distinctValues: true,
				crossTraceSession: false,
				rawQuery: false,
			}),
			aggregateSpans: async () => ({
				fields: [],
				rows: [{ native: true }],
			}),
		} as unknown as DataSourceAdapter;

		const frame = await planAndAggregateSpans(adapter, windowQuery);
		expect(frame.rows).toEqual([{ native: true }]);
	});
});
