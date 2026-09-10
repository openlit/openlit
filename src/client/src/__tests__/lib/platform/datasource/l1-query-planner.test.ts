import { mapPool } from "@/lib/platform/connectors/datasource/graph/map-pool";
import {
	aggregateSpansInProcess,
	bucketSpansByInterval,
	distinctFromSpans,
	looksLikeRootsOnly,
	spanFieldValue,
} from "@/lib/platform/connectors/datasource/graph/sample-aggregate";
import { fetchSpansForAggregation } from "@/lib/platform/connectors/datasource/graph/sample-fetch";
import {
	computeAggregateSpansL1,
	computeDistinctValuesL1,
	computeSpanTimeSeriesL1,
} from "@/lib/platform/connectors/datasource/l1-compute";
import {
	intervalFromTimeRange,
	planAndAggregateSpans,
	planAndDistinctValues,
	planAndSpanTimeSeries,
} from "@/lib/platform/connectors/datasource/query-planner";
import { __clearCache } from "@/lib/platform/connectors/datasource/http/cache";
import {
	UnsupportedCapabilityError,
	type DataSourceAdapter,
	type NormalizedSpan,
	type OpenLITQuery,
	type SourceCapabilities,
} from "@/lib/platform/connectors/datasource/types";

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

	it("bucketSpansByInterval preserves 90-day data in weekly buckets", () => {
		const frame = bucketSpansByInterval(
			[
				span({ spanId: "may", timestamp: "2026-05-10T10:00:00.000Z" }),
				span({ spanId: "jul", timestamp: "2026-07-29T10:00:00.000Z" }),
			],
			"1w",
			[{ fn: "count", as: "total" }],
			{
				start: new Date("2026-05-08T00:00:00.000Z"),
				end: new Date("2026-08-06T00:00:00.000Z"),
			}
		);

		expect(frame.rows).toHaveLength(14);
		expect(
			frame.rows.reduce<number>(
				(sum, row) => sum + Number((row as { total: number }).total),
				0
			)
		).toBe(2);
		expect(frame.rows[0]).toMatchObject({
			bucket: "2026-05-04T00:00:00.000Z",
			label: "2026/05/04",
		});
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

	it("aggregateSpansInProcess defaults groupBy to [] when undefined", () => {
		const frame = aggregateSpansInProcess(
			spans,
			undefined as unknown as string[],
			[{ fn: "count", as: "n" }]
		);
		expect(frame.rows).toEqual([{ n: 3 }]);
	});

	it("distinctFromSpans returns sorted unique values", () => {
		expect(distinctFromSpans(spans, "gen_ai.request.model")).toEqual([
			"gpt-3.5",
			"gpt-4",
		]);
	});

	it("distinctFromSpans skips spans where the field is undefined or empty", () => {
		const mixed = [
			span({ spanId: "a", spanAttributes: {} }),
			span({ spanId: "b", spanAttributes: { tag: "" } }),
			span({ spanId: "c", spanAttributes: { tag: "value" } }),
		];
		expect(distinctFromSpans(mixed, "tag")).toEqual(["value"]);
	});

	it("spanFieldValue resolves span:/resource: scoped attributes", () => {
		const s = span({
			spanId: "a",
			spanAttributes: { custom: "span-value" },
			resourceAttributes: { custom: "resource-value" },
		});
		expect(spanFieldValue(s, "span:custom")).toBe("span-value");
		expect(spanFieldValue(s, "resource:custom")).toBe("resource-value");
	});

	it("spanFieldValue returns undefined for a blank field", () => {
		expect(spanFieldValue(span({ spanId: "a" }), "   ")).toBeUndefined();
	});

	it("spanFieldValue prefers span.cost over attributes when numeric", () => {
		const s = span({
			spanId: "a",
			cost: 9.5,
			spanAttributes: { "gen_ai.usage.cost": "1" },
		});
		expect(spanFieldValue(s, "cost")).toBe(9.5);
	});

	it("spanFieldValue resolves cost via the raw attribute constant key", () => {
		const s = span({
			spanId: "a",
			spanAttributes: { "gen_ai.usage.cost": "3.5" },
		});
		expect(spanFieldValue(s, "gen_ai.usage.cost")).toBe(3.5);
	});

	it("spanFieldValue falls back through lookupAttr cost keys and resource attrs", () => {
		const s = span({
			spanId: "a",
			spanAttributes: { "coding_agent.session.cost_usd": "2.25" },
		});
		expect(spanFieldValue(s, "cost")).toBe(2.25);

		const resourceOnly = span({
			spanId: "b",
			resourceAttributes: { cost: "7" },
		});
		expect(spanFieldValue(resourceOnly, "cost")).toBe(7);
	});

	it("spanFieldValue returns undefined cost when nothing parses to a number", () => {
		const s = span({ spanId: "a", spanAttributes: {} });
		expect(spanFieldValue(s, "cost")).toBeUndefined();
	});

	it("spanFieldValue resolves tokens via the raw attribute constant key", () => {
		const s = span({
			spanId: "a",
			spanAttributes: { total_tokens: "42" },
		});
		expect(spanFieldValue(s, "total_tokens")).toBe(42);
	});

	it("spanFieldValue defaults duration to 0 when durationNs is falsy", () => {
		const s = span({ spanId: "a", durationNs: 0 });
		expect(spanFieldValue(s, "duration")).toBe(0);
	});

	it("spanFieldValue falls back to resourceAttributes for tokens when no attribute key matches", () => {
		const s = span({
			spanId: "a",
			spanAttributes: {},
			resourceAttributes: { tokens: "17" },
		});
		expect(spanFieldValue(s, "tokens")).toBe(17);
	});

	it("spanFieldValue resolves StatusCode/statusCode", () => {
		const s = span({ spanId: "a", statusCode: "STATUS_CODE_ERROR" });
		expect(spanFieldValue(s, "StatusCode")).toBe("STATUS_CODE_ERROR");
		expect(spanFieldValue(s, "statusCode")).toBe("STATUS_CODE_ERROR");
	});

	it("spanFieldValue resolves durationNs, ParentSpanId, TraceId, SpanId", () => {
		const s = span({
			spanId: "sid",
			traceId: "tid",
			parentSpanId: "pid",
			durationNs: 42,
		});
		expect(spanFieldValue(s, "durationNs")).toBe(42);
		expect(spanFieldValue(s, "ParentSpanId")).toBe("pid");
		expect(spanFieldValue(s, "TraceId")).toBe("tid");
		expect(spanFieldValue(s, "SpanId")).toBe("sid");
	});

	it("spanFieldValue falls back to raw span/resource attributes for unknown fields", () => {
		const s = span({
			spanId: "a",
			spanAttributes: { "custom.attr": "span-attr-value" },
			resourceAttributes: { "custom.resource.attr": "resource-attr-value" },
		});
		expect(spanFieldValue(s, "custom.attr")).toBe("span-attr-value");
		expect(spanFieldValue(s, "custom.resource.attr")).toBe(
			"resource-attr-value"
		);
		expect(spanFieldValue(s, "totally.unknown")).toBeUndefined();
	});

	it("applyAggregation supports cardinality, min/max/avg/p90/p95/p99, and unknown fns", () => {
		const spansForAgg = [
			span({ spanId: "1", spanAttributes: { "gen_ai.usage.cost": "1" } }),
			span({ spanId: "2", spanAttributes: { "gen_ai.usage.cost": "2" } }),
			span({ spanId: "3", spanAttributes: { "gen_ai.usage.cost": "3" } }),
			span({ spanId: "4", spanAttributes: { "gen_ai.request.model": "gpt-4" } }),
		];

		const cardinality = aggregateSpansInProcess(
			spansForAgg,
			[],
			[{ fn: "cardinality", field: "gen_ai.request.model", as: "distinctModels" }]
		);
		expect(cardinality.rows[0]).toEqual({ distinctModels: 1 });

		const stats = aggregateSpansInProcess(
			spansForAgg,
			[],
			[
				{ fn: "min", field: "cost", as: "min" },
				{ fn: "max", field: "cost", as: "max" },
				{ fn: "avg", field: "cost", as: "avg" },
				{ fn: "p90", field: "cost", as: "p90" },
				{ fn: "p95", field: "cost", as: "p95" },
				{ fn: "p99", field: "cost", as: "p99" },
				{ fn: "unknown" as unknown as "sum", field: "cost", as: "unknownFn" },
			]
		);
		expect(stats.rows[0]).toMatchObject({
			min: 1,
			max: 3,
			avg: 2,
			unknownFn: 0,
		});
	});

	it("applyAggregation cardinality ignores undefined/empty field values", () => {
		const spansForAgg = [
			span({ spanId: "1", spanAttributes: {} }),
			span({ spanId: "2", spanAttributes: { tag: "" } }),
		];
		const result = aggregateSpansInProcess(
			spansForAgg,
			[],
			[{ fn: "cardinality", field: "tag", as: "n" }]
		);
		expect(result.rows[0]).toEqual({ n: 0 });
	});

	it("applyAggregation cardinality defaults to an empty field when none is given", () => {
		const spansForAgg = [span({ spanId: "1" })];
		const result = aggregateSpansInProcess(
			spansForAgg,
			[],
			[{ fn: "cardinality", as: "n" }]
		);
		expect(result.rows[0]).toEqual({ n: 0 });
	});

	it("applyAggregation returns 0 for numeric aggregations with no numeric values", () => {
		const spansForAgg = [span({ spanId: "1", spanAttributes: {} })];
		const result = aggregateSpansInProcess(
			spansForAgg,
			[],
			[{ fn: "sum", field: "cost", as: "sum" }]
		);
		expect(result.rows[0]).toEqual({ sum: 0 });
	});

	it("applyAggregation returns 0 for sum/avg without a field (collectFieldNumbers short-circuits)", () => {
		const spansForAgg = [span({ spanId: "1" })];
		const result = aggregateSpansInProcess(
			spansForAgg,
			[],
			[{ fn: "sum", as: "sum" }]
		);
		expect(result.rows[0]).toEqual({ sum: 0 });
	});

	it("applyAggregations falls back to a default count aggregation for an explicitly empty list", () => {
		const spansForAgg = [span({ spanId: "1" }), span({ spanId: "2" })];
		const result = aggregateSpansInProcess(spansForAgg, [], []);
		expect(result.rows[0]).toEqual({ agg0: 2 });
	});

	it("aggAlias/safeGroupKey reject prototype-polluting or invalid identifiers", () => {
		const spansForAgg = [
			span({ spanId: "1", spanAttributes: { "gen_ai.request.model": "gpt-4" } }),
		];
		const result = aggregateSpansInProcess(
			spansForAgg,
			["__proto__"],
			[{ fn: "count", as: "__proto__" }]
		);
		expect(Object.keys(result.rows[0] as object)).toEqual(
			expect.arrayContaining(["agg0", "group_value", "group0"])
		);
	});

	it("bucketSpansByInterval treats an empty interval string as the 1h default", () => {
		const frame = bucketSpansByInterval(
			[span({ spanId: "1", timestamp: "2026-07-11T10:30:00.000Z" })],
			"",
			[{ fn: "count", as: "n" }]
		);
		expect(frame.rows[0]).toMatchObject({ label: "07/11 10:00" });
	});

	it("bucketSpansByInterval skips spans with a missing or unparsable timestamp", () => {
		const noTimestamp = { ...span({ spanId: "1" }), timestamp: "" };
		const badTimestamp = span({ spanId: "2", timestamp: "not-a-date" });
		const frame = bucketSpansByInterval(
			[noTimestamp, badTimestamp],
			"1h",
			[{ fn: "count", as: "n" }]
		);
		expect(frame.rows).toEqual([]);
	});

	it("bucketSpansByInterval formats month buckets and defaults unknown intervals to hourly", () => {
		const monthFrame = bucketSpansByInterval(
			[span({ spanId: "1", timestamp: "2026-03-15T10:00:00.000Z" })],
			"1M",
			[{ fn: "count", as: "n" }]
		);
		expect(monthFrame.rows[0]).toMatchObject({
			bucket: "2026-03-01T00:00:00.000Z",
			label: "2026/03",
		});

		const defaultFrame = bucketSpansByInterval(
			[span({ spanId: "1", timestamp: "2026-03-15T10:30:00.000Z" })],
			"not-a-real-interval",
			[{ fn: "count", as: "n" }]
		);
		expect(defaultFrame.rows[0]).toMatchObject({
			label: "03/15 10:00",
		});
	});

	it("bucketSpansByInterval zero-fills minute buckets across a short window", () => {
		const frame = bucketSpansByInterval(
			[span({ spanId: "1", timestamp: "2026-07-11T10:01:00.000Z" })],
			"1m",
			[{ fn: "count", as: "n" }],
			{
				start: new Date("2026-07-11T10:00:00.000Z"),
				end: new Date("2026-07-11T10:02:00.000Z"),
			}
		);
		expect(frame.rows).toHaveLength(3);
		expect(frame.rows.map((r) => (r as { n: number }).n)).toEqual([0, 1, 0]);
	});

	it("bucketSpansByInterval zero-fills day buckets across a short window", () => {
		const frame = bucketSpansByInterval(
			[span({ spanId: "1", timestamp: "2026-07-12T10:00:00.000Z" })],
			"1d",
			[{ fn: "count", as: "n" }],
			{
				start: new Date("2026-07-11T00:00:00.000Z"),
				end: new Date("2026-07-13T00:00:00.000Z"),
			}
		);
		expect(frame.rows).toHaveLength(3);
		expect(frame.rows.map((r) => (r as { n: number }).n)).toEqual([0, 1, 0]);
	});

	it("bucketSpansByInterval zero-fills across calendar months", () => {
		const frame = bucketSpansByInterval(
			[span({ spanId: "1", timestamp: "2026-03-15T10:00:00.000Z" })],
			"1M",
			[{ fn: "count", as: "n" }],
			{
				start: new Date("2026-01-01T00:00:00.000Z"),
				end: new Date("2026-03-01T00:00:00.000Z"),
			}
		);
		expect(frame.rows).toHaveLength(3);
		expect(frame.rows.map((r) => (r as { n: number }).n)).toEqual([0, 0, 1]);
	});

	it("looksLikeRootsOnly returns false for an empty span list", () => {
		expect(looksLikeRootsOnly([])).toBe(false);
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
		expect(result.truncated).toBe(false);
	});

	it("keeps service stratification within the global trace budget", async () => {
		const requested: number[] = [];
		const result = await fetchSpansForAggregation(
			{
				discoverServices: async () =>
					["a", "b", "c", "d"].map((serviceName) => ({
						serviceName,
						environment: "default",
						clusterId: "default",
					})),
				sampleTracesForGraph: async (query, limit) => {
					requested.push(limit);
					const service = String(
						query.filters?.find((f) => f.key === "service.name")?.value || ""
					);
					return Array.from({ length: limit }, (_, index) =>
						span({
							spanId: `${service}-${index}`,
							traceId: `${service}-trace-${index}`,
							serviceName: service,
						})
					);
				},
			},
			windowQuery,
			{ maxTraces: 3, skipCache: true }
		);

		expect(requested.reduce((sum, value) => sum + value, 0)).toBe(3);
		expect(result.spans).toHaveLength(3);
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

	it("defaults groupBy/aggregations/interval when the query omits them", async () => {
		const spans = [span({ spanId: "1" }), span({ spanId: "2", traceId: "t2" })];
		const source = { sampleTracesForGraph: async () => spans };

		const agg = await computeAggregateSpansL1(source, windowQuery);
		expect(agg.rows).toEqual([{ agg0: 2 }]);

		const ts = await computeSpanTimeSeriesL1(source, windowQuery);
		expect(ts.rows.length).toBeGreaterThan(0);
	});

	it("computeDistinctValuesL1 samples spans and returns distinct field values", async () => {
		const spans = [
			span({
				spanId: "1",
				spanAttributes: { "gen_ai.request.model": "gpt-4" },
			}),
			span({
				spanId: "2",
				spanAttributes: { "gen_ai.request.model": "gpt-3.5" },
			}),
			span({
				spanId: "3",
				spanAttributes: { "gen_ai.request.model": "gpt-4" },
			}),
		];
		const source = {
			sampleTracesForGraph: async () => spans,
		};
		const values = await computeDistinctValuesL1(
			source,
			"gen_ai.request.model",
			windowQuery
		);
		expect(values).toEqual(["gpt-3.5", "gpt-4"]);
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
		expect(
			intervalFromTimeRange(
				new Date("2023-01-01T00:00:00.000Z"),
				new Date("2026-07-11T00:00:00.000Z")
			)
		).toBe("1M");
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

	it("treats a throwing capabilities() as no server aggregation", async () => {
		const adapter = {
			capabilities: () => {
				throw new Error("capabilities unavailable");
			},
			aggregateSpans: async () => ({ fields: [], rows: [{ native: true }] }),
		} as unknown as DataSourceAdapter;

		const frame = await planAndAggregateSpans(adapter, windowQuery);
		expect(frame.rows).toEqual([{ native: true }]);
	});

	it("ignores a rollup read failure and falls through to the native adapter call", async () => {
		const adapter = {
			aggregateSpans: async () => ({ fields: [], rows: [{ native: true }] }),
		} as unknown as DataSourceAdapter;

		const frame = await planAndAggregateSpans(adapter, windowQuery, {
			preferRollup: true,
			readRollup: async () => {
				throw new Error("rollup store unavailable");
			},
		});
		expect(frame.rows).toEqual([{ native: true }]);
		expect(frame.meta?.degraded ?? []).not.toContain("rollup");
	});

	it("falls through to the native adapter call when readRollup resolves to null (rollup miss)", async () => {
		const adapter = {
			aggregateSpans: async () => ({ fields: [], rows: [{ native: true }] }),
		} as unknown as DataSourceAdapter;

		const frame = await planAndAggregateSpans(adapter, windowQuery, {
			preferRollup: true,
			readRollup: async () => null,
		});
		expect(frame.rows).toEqual([{ native: true }]);
		expect(frame.meta?.degraded ?? []).not.toContain("rollup");
	});

	it("planAndAggregateSpans rethrows non-UnsupportedCapabilityError failures", async () => {
		const adapter = {
			aggregateSpans: async () => {
				throw new Error("boom");
			},
		} as unknown as DataSourceAdapter;

		await expect(planAndAggregateSpans(adapter, windowQuery)).rejects.toThrow(
			"boom"
		);
	});

	it("planAndSpanTimeSeries uses native adapter method when serverAggregation is true", async () => {
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
			spanTimeSeries: async () => ({
				fields: [],
				rows: [{ native: true }],
			}),
		} as unknown as DataSourceAdapter;

		const frame = await planAndSpanTimeSeries(adapter, windowQuery);
		expect(frame.rows).toEqual([{ native: true }]);
		expect(frame.meta?.freshness).toBe("live");
	});

	it("planAndSpanTimeSeries uses readRollup when preferRollup is set", async () => {
		const frame = await planAndSpanTimeSeries(
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

	it("planAndSpanTimeSeries ignores a rollup read failure and falls through to native", async () => {
		const adapter = {
			spanTimeSeries: async () => ({ fields: [], rows: [{ native: true }] }),
		} as unknown as DataSourceAdapter;

		const frame = await planAndSpanTimeSeries(adapter, windowQuery, {
			preferRollup: true,
			readRollup: async () => {
				throw new Error("rollup store unavailable");
			},
		});
		expect(frame.rows).toEqual([{ native: true }]);
	});

	it("planAndSpanTimeSeries rethrows non-UnsupportedCapabilityError failures", async () => {
		const adapter = {
			spanTimeSeries: async () => {
				throw new Error("boom");
			},
		} as unknown as DataSourceAdapter;

		await expect(planAndSpanTimeSeries(adapter, windowQuery)).rejects.toThrow(
			"boom"
		);
	});

	it("planAndDistinctValues returns the adapter's native result when it succeeds", async () => {
		const adapter = {
			distinctValues: async () => ["a", "b"],
		} as unknown as DataSourceAdapter;

		const values = await planAndDistinctValues(adapter, "service.name", windowQuery);
		expect(values).toEqual(["a", "b"]);
	});

	it("planAndDistinctValues falls back to L1 sampling on UnsupportedCapabilityError", async () => {
		const spans = [
			span({ spanId: "1", spanAttributes: { "gen_ai.request.model": "gpt-4" } }),
			span({ spanId: "2", spanAttributes: { "gen_ai.request.model": "gpt-3.5" } }),
		];
		const adapter = {
			distinctValues: async () => {
				throw new UnsupportedCapabilityError("tempo", "distinctValues");
			},
			sampleTracesForGraph: async () => spans,
		} as unknown as DataSourceAdapter;

		const values = await planAndDistinctValues(
			adapter,
			"gen_ai.request.model",
			windowQuery
		);
		expect(values).toEqual(["gpt-3.5", "gpt-4"]);
	});

	it("planAndDistinctValues rethrows non-UnsupportedCapabilityError failures", async () => {
		const adapter = {
			distinctValues: async () => {
				throw new Error("boom");
			},
		} as unknown as DataSourceAdapter;

		await expect(
			planAndDistinctValues(adapter, "service.name", windowQuery)
		).rejects.toThrow("boom");
	});
});
