const mockSafeFetch = jest.fn();

jest.mock("@/lib/platform/connectors/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
	selfHostedNetworkOptions: () => ({
		allowHttp: true,
		allowPrivateNetwork: true,
	}),
}));
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn().mockResolvedValue({
		raw: "tok",
		credentials: { token: "tok" },
	}),
	redactableSecretValues: () => ["tok"],
}));

import { JaegerAdapter } from "@/lib/platform/connectors/datasource/jaeger/adapter";
import {
	spanMatchesAISelector,
	traceMatchesAISelector,
} from "@/lib/platform/connectors/datasource/selector-match";
import { __clearCache } from "@/lib/platform/connectors/datasource/http/cache";
import type {
	NormalizedSpan,
	TelemetrySourceDescriptor,
} from "@/lib/platform/connectors/datasource/types";

const window = {
	start: new Date("2026-07-01T00:00:00.000Z"),
	end: new Date("2026-07-02T00:00:00.000Z"),
};

const span = (over: Partial<NormalizedSpan>): NormalizedSpan => ({
	traceId: "t",
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

beforeEach(() => {
	jest.clearAllMocks();
	__clearCache();
});

describe("selector-match", () => {
	it("matches openlit SDK identity on resource attributes", () => {
		expect(
			spanMatchesAISelector(
				span({ resourceAttributes: { "telemetry.sdk.name": "openlit" } })
			)
		).toBe(true);
	});
	it("matches gen_ai span attributes", () => {
		expect(
			spanMatchesAISelector(
				span({ spanAttributes: { "gen_ai.operation.name": "chat" } })
			)
		).toBe(true);
	});
	it("matches coding-agent span names", () => {
		expect(spanMatchesAISelector(span({ name: "coding_agent.session" }))).toBe(true);
	});
	it("rejects non-AI spans", () => {
		expect(
			spanMatchesAISelector(
				span({ name: "GET /health", spanAttributes: { "http.method": "GET" } })
			)
		).toBe(false);
	});
	it("keeps a trace when any span is AI-relevant", () => {
		const spans = [
			span({ spanId: "a", name: "GET /x" }),
			span({ spanId: "b", spanAttributes: { "gen_ai.request.model": "gpt-4" } }),
		];
		expect(traceMatchesAISelector(spans)).toBe(true);
	});
});

describe("JaegerAdapter", () => {
	const descriptor: TelemetrySourceDescriptor = {
		type: "jaeger",
		id: "src-jaeger",
		isBuiltIn: false,
		settings: { url: "https://jaeger.example.com", services: ["svc"] },
		signals: ["traces"],
		name: "Jaeger",
	};
	const adapter = new JaegerAdapter(descriptor);

	const jaegerTrace = {
		data: [
			{
				traceID: "t1",
				processes: {
					p1: {
						serviceName: "svc",
						tags: [{ key: "telemetry.sdk.name", value: "openlit" }],
					},
				},
				spans: [
					{
						traceID: "t1",
						spanID: "s1",
						operationName: "chat",
						references: [],
						startTime: 1782864000000000,
						duration: 12000,
						processID: "p1",
						tags: [
							{ key: "gen_ai.request.model", value: "gpt-4" },
							{ key: "gen_ai.usage.cost", value: "0.003" },
						],
						logs: [
							{
								timestamp: 1782864000500000,
								fields: [
									{ key: "event", value: "gen_ai.content.prompt" },
									{ key: "gen_ai.prompt", value: "hi" },
								],
							},
						],
					},
					{
						traceID: "t1",
						spanID: "s2",
						operationName: "GET /health",
						references: [{ refType: "CHILD_OF", spanID: "s1" }],
						startTime: 1782864000100000,
						duration: 500,
						processID: "p1",
						tags: [{ key: "http.method", value: "GET" }],
					},
				],
			},
		],
	};

	it("advertises trace-only, span events, no server aggregation", () => {
		expect(adapter.capabilities()).toMatchObject({
			signals: ["traces"],
			traceTree: true,
			spanEvents: true,
			serverAggregation: false,
		});
	});

	it("normalizes native Jaeger spans, maps logs to events, keeps AI traces", async () => {
		mockSafeFetch.mockResolvedValue(jaegerTrace);
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 100,
			aiSelector: true,
		});
		const url = mockSafeFetch.mock.calls[0][0] as string;
		expect(url).toContain("/api/traces");
		expect(url).toContain(`start=${window.start.getTime() * 1000}`);
		// Explore-style list: one row per trace (root span).
		expect(frame.rows).toHaveLength(1);
		const chat = frame.rows[0]!;
		expect(chat).toMatchObject({
			traceId: "t1",
			spanId: "s1",
			name: "chat",
			serviceName: "svc",
			durationNs: 12_000_000,
			cost: 0.003,
		});
		expect(chat.resourceAttributes["telemetry.sdk.name"]).toBe("openlit");
		expect(chat.events?.[0]).toMatchObject({
			name: "gen_ai.content.prompt",
		});
		expect(chat.events?.[0].attributes["gen_ai.prompt"]).toBe("hi");
		expect(frame.meta?.degraded).toContain("serverAggregation");
		expect(await adapter.getSpan("s1")).toMatchObject({
			spanId: "s1",
			traceId: "t1",
		});
		const tree = await adapter.getTraceSpans("t1");
		expect(tree).toHaveLength(2);
		expect(tree.find((span) => span.name === "GET /health")?.parentSpanId).toBe(
			"s1"
		);
	});

	it("counts unique traces from the Jaeger sample", async () => {
		mockSafeFetch.mockResolvedValue(jaegerTrace);
		await expect(
			adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			})
		).resolves.toEqual({ total: 1, truncated: false });
	});

	it("budgets list results by traces, not child-span count", async () => {
		const fatChildren = Array.from({ length: 400 }, (_, i) => ({
			traceID: "fat",
			spanID: `c${i}`,
			operationName: `child-${i}`,
			references: [{ refType: "CHILD_OF", spanID: "root" }],
			startTime: 1782864000000000 + i,
			duration: 10,
			processID: "p1",
			tags: [],
		}));
		mockSafeFetch.mockResolvedValue({
			data: [
				{
					traceID: "fat",
					processes: { p1: { serviceName: "svc", tags: [] } },
					spans: [
						{
							traceID: "fat",
							spanID: "root",
							operationName: "session",
							references: [],
							startTime: 1782864000000000,
							duration: 5000,
							processID: "p1",
							tags: [{ key: "gen_ai.request.model", value: "gpt-4" }],
						},
						...fatChildren,
					],
				},
				{
					traceID: "thin",
					processes: { p1: { serviceName: "svc", tags: [] } },
					spans: [
						{
							traceID: "thin",
							spanID: "r2",
							operationName: "checkout",
							references: [],
							startTime: 1782864100000000,
							duration: 100,
							processID: "p1",
							tags: [{ key: "gen_ai.request.model", value: "gpt-4" }],
						},
					],
				},
			],
		});
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 25,
			aiSelector: false,
		});
		expect(frame.rows.map((row) => row.traceId).sort()).toEqual(["fat", "thin"]);
	});

	it("loads span names from Jaeger operations API", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/operations")) {
				return { data: ["checkout", "gen_ai.chat"] };
			}
			return jaegerTrace;
		});
		await expect(
			adapter.distinctValues("SpanName", {
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			})
		).resolves.toEqual(["checkout", "gen_ai.chat"]);
	});

	it("builds a trace-level time series from search hits", async () => {
		mockSafeFetch.mockResolvedValue(jaegerTrace);
		const frame = await adapter.traceTimeSeries!({
			signal: "traces",
			timeRange: window,
			interval: "1d",
			aiSelector: false,
			aggregations: [{ fn: "count", as: "count" }],
		});
		expect(frame.rows.some((row: { count?: unknown }) => Number(row.count) > 0)).toBe(true);
		expect(frame.meta?.freshness).toBe("sampled");
	});

	it("drops traces with no AI-relevant span", async () => {
		mockSafeFetch.mockResolvedValue({
			data: [
				{
					traceID: "t2",
					processes: { p1: { serviceName: "svc", tags: [] } },
					spans: [
						{
							traceID: "t2",
							spanID: "x",
							operationName: "GET /health",
							startTime: 1782864000000000,
							duration: 100,
							processID: "p1",
							tags: [{ key: "http.method", value: "GET" }],
						},
					],
				},
			],
		});
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: true,
		});
		expect(frame.rows).toHaveLength(0);
	});
});
