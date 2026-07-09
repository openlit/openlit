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

import { JaegerAdapter } from "@/lib/platform/datasource/jaeger/adapter";
import { VictoriaLogsAdapter, parseNdjsonLogs } from "@/lib/platform/datasource/victoria/logs";
import {
	spanMatchesAISelector,
	traceMatchesAISelector,
} from "@/lib/platform/datasource/selector-match";
import { __clearCache } from "@/lib/platform/datasource/http/cache";
import type {
	NormalizedSpan,
	TelemetrySourceDescriptor,
} from "@/lib/platform/datasource/types";

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
		expect(frame.rows).toHaveLength(2);
		const chat = frame.rows.find((r) => r.name === "chat")!;
		expect(chat).toMatchObject({
			traceId: "t1",
			spanId: "s1",
			serviceName: "svc",
			durationNs: 12_000_000,
			cost: 0.003,
		});
		expect(chat.resourceAttributes["telemetry.sdk.name"]).toBe("openlit");
		expect(chat.events?.[0]).toMatchObject({
			name: "gen_ai.content.prompt",
		});
		expect(chat.events?.[0].attributes["gen_ai.prompt"]).toBe("hi");
		const child = frame.rows.find((r) => r.name === "GET /health")!;
		expect(child.parentSpanId).toBe("s1");
		expect(frame.meta?.degraded).toContain("serverAggregation");
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

describe("parseNdjsonLogs", () => {
	it("parses newline-delimited JSON log records", () => {
		const ndjson = [
			JSON.stringify({
				_time: "2026-07-01T00:00:00Z",
				_msg: "hello",
				"service.name": "svc",
				level: "info",
				"gen_ai.operation.name": "chat",
			}),
			JSON.stringify({ _time: "2026-07-01T00:00:01Z", _msg: "world" }),
			"",
		].join("\n");
		const rows = parseNdjsonLogs(ndjson);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			body: "hello",
			serviceName: "svc",
			severityText: "info",
		});
		expect(rows[0].logAttributes["gen_ai.operation.name"]).toBe("chat");
		expect(rows[0].logAttributes._msg).toBeUndefined();
	});

	it("tolerates malformed lines", () => {
		expect(parseNdjsonLogs('not json\n{"_msg":"ok"}')).toHaveLength(1);
	});
});

describe("VictoriaLogsAdapter", () => {
	const adapter = new VictoriaLogsAdapter({
		type: "victorialogs",
		id: "src-vl",
		isBuiltIn: false,
		settings: { url: "https://vlogs.example.com" },
		signals: ["logs"],
		name: "VictoriaLogs",
	});

	it("queries LogsQL with an AI field-presence filter", async () => {
		mockSafeFetch.mockResolvedValue(
			`${JSON.stringify({ _time: "2026-07-01T00:00:00Z", _msg: "hi" })}\n`
		);
		const frame = await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			aiSelector: true,
		});
		expect(frame.rows).toHaveLength(1);
		const url = mockSafeFetch.mock.calls[0][0] as string;
		expect(url).toContain("/select/logsql/query");
		expect(decodeURIComponent(url)).toContain("gen_ai.operation.name");
	});
});
