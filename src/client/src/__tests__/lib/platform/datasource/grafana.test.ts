const mockSafeFetch = jest.fn();

jest.mock("@/lib/platform/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
	selfHostedNetworkOptions: () => ({
		allowHttp: true,
		allowPrivateNetwork: true,
	}),
}));
jest.mock("@/lib/platform/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn().mockResolvedValue({
		raw: "tok",
		credentials: { token: "tok" },
	}),
	redactableSecretValues: () => ["tok"],
}));

import { TempoAdapter, tempoAISelectorQuery, buildTempoSearchQuery, __clearTempoSpanIndex } from "@/lib/platform/datasource/grafana/tempo";
import { LokiAdapter } from "@/lib/platform/datasource/grafana/loki";
import { PrometheusAdapter } from "@/lib/platform/datasource/grafana/prometheus";
import { __clearCache } from "@/lib/platform/datasource/http/cache";
import { buildAggregateDag } from "@/lib/platform/datasource/graph/aggregate-dag";
import type {
	NormalizedSpan,
	TelemetrySourceDescriptor,
} from "@/lib/platform/datasource/types";

const window = {
	start: new Date("2026-07-01T00:00:00.000Z"),
	end: new Date("2026-07-02T00:00:00.000Z"),
};

const otlpTrace = {
	batches: [
		{
			resource: {
				attributes: [
					{ key: "service.name", value: { stringValue: "svc" } },
					{ key: "telemetry.sdk.name", value: { stringValue: "openlit" } },
				],
			},
			scopeSpans: [
				{
					spans: [
						{
							traceId: "t1",
							spanId: "s1",
							parentSpanId: "",
							name: "chat",
							startTimeUnixNano: "1719792000000000000",
							endTimeUnixNano: "1719792001000000000",
							status: { code: 1 },
							attributes: [
								{ key: "gen_ai.request.model", value: { stringValue: "gpt-4" } },
							],
							events: [
								{
									name: "gen_ai.content.prompt",
									attributes: [{ key: "gen_ai.prompt", value: { stringValue: "hi" } }],
								},
							],
						},
					],
				},
			],
		},
	],
};

function otlpForTrace(traceId: string, spanId: string) {
	return {
		batches: [
			{
				resource: otlpTrace.batches[0].resource,
				scopeSpans: [
					{
						spans: [
							{
								...otlpTrace.batches[0].scopeSpans[0].spans[0],
								traceId,
								spanId,
							},
						],
					},
				],
			},
		],
	};
}

beforeEach(() => {
	jest.clearAllMocks();
	__clearCache();
	__clearTempoSpanIndex();
});

describe("tempoAISelectorQuery", () => {
	const q = tempoAISelectorQuery();
	it("wraps TraceQL in braces and uses span./resource. prefixes", () => {
		expect(q.startsWith("{ ")).toBe(true);
		expect(q).toContain('resource.telemetry.sdk.name = "openlit"');
		expect(q).toContain('span.gen_ai.operation.name != ""');
		expect(q).toContain('name = "coding_agent.session"');
	});
});

describe("buildTempoSearchQuery scoping", () => {
	const window = {
		start: new Date("2026-07-11T00:00:00Z"),
		end: new Date("2026-07-11T01:00:00Z"),
	};

	it("parenthesizes the multi-group AI selector so a service filter scopes the whole selector", () => {
		const q = buildTempoSearchQuery({
			signal: "traces",
			timeRange: window,
			aiSelector: true,
			filters: [
				{
					target: "attribute",
					scope: "resource",
					key: "service.name",
					op: "eq",
					value: "demo-openai-app",
				},
			],
		});
		// The AI selector (which contains `||`) must be wrapped so the trailing
		// `&& resource.service.name = ...` constrains every OR branch, not just
		// the last one (TraceQL binds && tighter than ||).
		expect(q).toContain('&& resource.service.name = "demo-openai-app"');
		const beforeService = q.slice(0, q.indexOf("&& resource.service.name"));
		// Everything before the service clause is a single parenthesized group.
		expect(beforeService.trim().startsWith("{ (")).toBe(true);
		expect(beforeService).toContain(")");
	});
});

describe("TempoAdapter", () => {
	const descriptor: TelemetrySourceDescriptor = {
		type: "tempo",
		id: "src-tempo",
		isBuiltIn: false,
		settings: { url: "https://tempo.example.com", allowHttp: false },
		signals: ["traces"],
		name: "Tempo",
	};
	const adapter = new TempoAdapter(descriptor);

	it("advertises trace-only, span-events true, no server aggregation", () => {
		expect(adapter.capabilities()).toMatchObject({
			signals: ["traces"],
			traceTree: true,
			spanEvents: true,
			serverAggregation: false,
			distinctValues: true,
		});
	});

	it("aggregateSpans totals every matching span via native TraceQL metrics (no sample cap)", async () => {
		// Grafana-style: counts come from `/api/metrics/query_range`, which
		// aggregates over the whole window. Buckets summing to 4200 must surface
		// as 4200 — the old L1 path would have capped this at the 200-trace sample.
		mockSafeFetch.mockResolvedValueOnce({
			series: [
				{
					labels: [],
					samples: [
						{ timestampMs: window.start.getTime(), value: 1200 },
						{ timestampMs: window.start.getTime() + 3_600_000, value: 3000 },
					],
				},
			],
		});
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: true,
			filters: [
				{
					target: "attribute",
					scope: "resource",
					key: "service.name",
					op: "eq",
					value: "svc",
				},
			],
			aggregations: [{ fn: "count", as: "total_requests" }],
		});
		expect(Number((frame.rows[0] as any)?.total_requests)).toBe(4200);
		expect(frame.meta?.freshness).toBe("live");
		// The service scope + count function must reach the metrics query.
		const metricsUrl = decodeURIComponent(
			mockSafeFetch.mock.calls[0][0] as string
		).replace(/\+/g, " ");
		expect(metricsUrl).toContain("/api/metrics/query_range");
		expect(metricsUrl).toContain("count_over_time()");
		expect(metricsUrl).toContain('resource.service.name = "svc"');
	});

	it("aggregateSpans falls back to the L1 sample when metrics are unavailable", async () => {
		// Metrics endpoint returns no series -> we fall back to TraceQL search +
		// full-trace fetch and count in-process (degraded / sampled).
		mockSafeFetch
			.mockResolvedValueOnce({}) // metrics: no series
			.mockResolvedValueOnce({ traces: [{ traceID: "t1" }] }) // search
			.mockResolvedValueOnce(otlpTrace); // trace fetch
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: true,
			filters: [
				{
					target: "attribute",
					scope: "resource",
					key: "service.name",
					op: "eq",
					value: "svc",
				},
			],
			aggregations: [{ fn: "count", as: "total_requests" }],
		});
		expect(
			Number(
				(frame.rows[0] as any)?.total_requests ??
					(frame.rows[0] as any)?.count
			)
		).toBeGreaterThan(0);
		expect(frame.meta?.degraded).toContain("serverAggregation");
		const searchUrl = decodeURIComponent(
			mockSafeFetch.mock.calls[1][0] as string
		).replace(/\+/g, " ");
		expect(searchUrl).toContain('resource.service.name = "svc"');
	});

	it("aggregateSpans groups by model via a metrics `by (...)` clause", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			series: [
				{
					labels: [
						{ key: "gen_ai.request.model", value: { stringValue: "gpt-4" } },
					],
					samples: [{ timestampMs: window.start.getTime(), value: 100 }],
				},
				{
					labels: [
						{ key: "gen_ai.request.model", value: { stringValue: "gpt-3.5" } },
					],
					samples: [{ timestampMs: window.start.getTime(), value: 50 }],
				},
			],
		});
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: true,
			groupBy: ["gen_ai.request.model"],
			aggregations: [{ fn: "count", as: "count" }],
		});
		const byModel = Object.fromEntries(
			frame.rows.map((r: any) => [r.group_value, Number(r.count)])
		);
		expect(byModel["gpt-4"]).toBe(100);
		expect(byModel["gpt-3.5"]).toBe(50);
		const metricsUrl = decodeURIComponent(
			mockSafeFetch.mock.calls[0][0] as string
		).replace(/\+/g, " ");
		expect(metricsUrl).toContain("by (span.gen_ai.request.model)");
	});

	it("spanTimeSeries merges count + sum buckets from native metrics", async () => {
		const t0 = window.start.getTime();
		const t1 = t0 + 3_600_000;
		mockSafeFetch
			.mockResolvedValueOnce({
				series: [
					{
						labels: [],
						samples: [
							{ timestampMs: t0, value: 10 },
							{ timestampMs: t1, value: 20 },
						],
					},
				],
			})
			.mockResolvedValueOnce({
				series: [
					{
						labels: [],
						samples: [
							{ timestampMs: t0, value: 5 },
							{ timestampMs: t1, value: 15 },
						],
					},
				],
			});
		const frame = await adapter.spanTimeSeries({
			signal: "traces",
			timeRange: window,
			aiSelector: true,
			interval: "1h",
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "sum", field: "gen_ai.usage.cost", as: "cost" },
			],
		});
		expect(frame.rows).toHaveLength(2);
		expect(frame.rows.map((r: any) => Number(r.count))).toEqual([10, 20]);
		expect(frame.rows.map((r: any) => Number(r.cost))).toEqual([5, 15]);
	});

	it("getTraceSpans parses OTLP into normalized spans with events", async () => {
		mockSafeFetch.mockResolvedValue(otlpTrace);
		const spans = await adapter.getTraceSpans("t1");
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({
			traceId: "t1",
			spanId: "s1",
			name: "chat",
			serviceName: "svc",
			statusCode: "STATUS_CODE_OK",
			durationNs: 1000000000,
		});
		expect(spans[0].resourceAttributes["telemetry.sdk.name"]).toBe("openlit");
		expect(spans[0].events?.[0].attributes["gen_ai.prompt"]).toBe("hi");
	});

	it("listSpans searches for trace ids then fetches full traces in parallel", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: "t1" }, { traceID: "t2" }] })
			.mockResolvedValueOnce(otlpForTrace("t1", "s1"))
			.mockResolvedValueOnce(otlpForTrace("t2", "s2"));
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 5,
			aiSelector: true,
		});
		// One list row per trace (root span), not every span in the OTLP payload.
		expect(frame.rows).toHaveLength(2);
		const searchUrl = mockSafeFetch.mock.calls[0][0] as string;
		expect(searchUrl).toContain("/api/search");
		expect(decodeURIComponent(searchUrl)).toContain("telemetry.sdk.name");
		expect(frame.meta?.degraded).toContain("serverAggregation");
		// Both traces fetched (parallel), not only the first.
		expect(mockSafeFetch).toHaveBeenCalledTimes(3);
	});

	it("getSpan returns a span from the warm cache after listSpans", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: "t1" }] })
			.mockResolvedValueOnce(otlpTrace);
		await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 5,
			aiSelector: true,
		});
		const span = await adapter.getSpan("s1");
		expect(span?.spanId).toBe("s1");
		expect(span?.traceId).toBe("t1");
	});
});

describe("LokiAdapter", () => {
	const adapter = new LokiAdapter({
		type: "loki",
		id: "src-loki",
		isBuiltIn: false,
		settings: { url: "https://loki.example.com" },
		signals: ["logs"],
		name: "Loki",
	});

	it("parses query_range streams into normalized logs", async () => {
		mockSafeFetch.mockResolvedValue({
			data: {
				result: [
					{
						stream: { service_name: "svc", level: "info" },
						values: [["1719792000000000000", "hello"]],
					},
				],
			},
		});
		const frame = await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			aiSelector: true,
		});
		expect(frame.rows[0]).toMatchObject({
			body: "hello",
			serviceName: "svc",
			severityText: "info",
		});
		const url = mockSafeFetch.mock.calls[0][0] as string;
		expect(decodeURIComponent(url)).toContain("gen_ai_operation_name");
	});

	it("does not flag truncation for an under-limit result", async () => {
		mockSafeFetch.mockResolvedValue({
			data: {
				result: [
					{
						stream: { service_name: "svc" },
						values: [["1719792000000000000", "one"]],
					},
				],
			},
		});
		const frame = await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			limit: 100,
		});
		expect(frame.meta?.truncated).toBe(false);
	});

	it("flags truncation when the vendor fills the requested limit", async () => {
		const values: [string, string][] = Array.from({ length: 3 }, (_, i) => [
			`${1719792000000000000 + i}`,
			`line-${i}`,
		]);
		mockSafeFetch.mockResolvedValue({
			data: { result: [{ stream: { service_name: "svc" }, values }] },
		});
		const frame = await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			limit: 3,
		});
		expect(frame.rows).toHaveLength(3);
		expect(frame.meta?.truncated).toBe(true);
	});
});

describe("PrometheusAdapter", () => {
	const adapter = new PrometheusAdapter({
		type: "prometheus",
		id: "src-prom",
		isBuiltIn: false,
		settings: { url: "https://prom.example.com" },
		signals: ["metrics"],
		name: "Prom",
	});

	it("flattens PromQL range results and computes step from interval", async () => {
		mockSafeFetch.mockResolvedValue({
			data: {
				result: [
					{
						metric: { __name__: "gen_ai_tokens", service_name: "svc" },
						values: [[1719792000, "5"], [1719792060, "9"]],
					},
				],
			},
		});
		const frame = await adapter.listMetricSeries({
			signal: "metrics",
			timeRange: window,
			interval: "5m",
			filters: [{ target: "spanName", op: "eq", value: "gen_ai_tokens" }],
		});
		expect(frame.rows).toHaveLength(2);
		expect(frame.rows[0]).toMatchObject({ metricName: "gen_ai_tokens", value: 5 });
		const url = mockSafeFetch.mock.calls[0][0] as string;
		expect(url).toContain("step=300");
	});

	it("metricNames reads __name__ label values", async () => {
		mockSafeFetch.mockResolvedValue({ data: ["a", "b"] });
		expect(await adapter.metricNames(window)).toEqual(["a", "b"]);
	});
});

describe("buildAggregateDag", () => {
	const span = (over: Partial<NormalizedSpan>): NormalizedSpan => ({
		traceId: "t1",
		spanId: "s",
		parentSpanId: "",
		name: "n",
		serviceName: "svc",
		timestamp: "2026-07-01T00:00:00.000Z",
		durationNs: 1_000_000,
		statusCode: "STATUS_CODE_OK",
		spanAttributes: {},
		resourceAttributes: {},
		...over,
	});

	it("reconstructs nodes, edges, and quantiles from sampled spans", () => {
		const spans = [
			span({ spanId: "a", name: "agent", durationNs: 2_000_000, cost: 0.01 }),
			span({ spanId: "b", parentSpanId: "a", name: "llm", durationNs: 4_000_000 }),
			span({
				spanId: "c",
				parentSpanId: "a",
				name: "llm",
				durationNs: 6_000_000,
				statusCode: "STATUS_CODE_ERROR",
			}),
			span({ traceId: "t2", spanId: "d", name: "agent", durationNs: 1_000_000 }),
		];
		const dag = buildAggregateDag(spans);
		expect(dag.sampledTraces).toBe(2);
		expect(dag.sampledSpans).toBe(4);
		const llm = dag.nodes.find((n) => n.name === "llm");
		expect(llm).toMatchObject({ count: 2, errorCount: 1 });
		expect(llm?.p95DurationMs).toBeGreaterThanOrEqual(llm!.p50DurationMs);
		expect(llm?.p50DurationMs).toBe(4);
		const agent = dag.nodes.find((n) => n.name === "agent");
		expect(agent?.totalCost).toBeCloseTo(0.01);
		const edge = dag.edges.find((e) => e.from === "agent" && e.to === "llm");
		expect(edge?.count).toBe(2);
	});
});
