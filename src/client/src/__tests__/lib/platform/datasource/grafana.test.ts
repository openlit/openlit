const mockSafeFetch = jest.fn();

jest.mock("@/lib/platform/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));
jest.mock("@/lib/platform/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn().mockResolvedValue({
		raw: "tok",
		credentials: { token: "tok" },
	}),
	redactableSecretValues: () => ["tok"],
}));

import { TempoAdapter, tempoAISelectorQuery } from "@/lib/platform/datasource/grafana/tempo";
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

beforeEach(() => {
	jest.clearAllMocks();
	__clearCache();
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
		});
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

	it("listSpans searches for trace ids then fetches full traces", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: "t1" }] })
			.mockResolvedValueOnce(otlpTrace);
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 5,
			aiSelector: true,
		});
		expect(frame.rows).toHaveLength(1);
		const searchUrl = mockSafeFetch.mock.calls[0][0] as string;
		expect(searchUrl).toContain("/api/search");
		expect(decodeURIComponent(searchUrl)).toContain("telemetry.sdk.name");
		expect(frame.meta?.degraded).toContain("serverAggregation");
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
