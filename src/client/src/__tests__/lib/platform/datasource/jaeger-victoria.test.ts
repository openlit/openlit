const mockSafeFetch = jest.fn();

jest.mock("@/lib/platform/connectors/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
	selfHostedNetworkOptions: () => ({
		allowHttp: true,
		allowPrivateNetwork: true,
	}),
	SourceResponseError: class SourceResponseError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	},
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
import type { AITelemetrySelector } from "@/lib/platform/connectors/datasource/ai-selector";

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

	it("falls back to unscoped attribute lookup, checking span attributes then resource attributes", () => {
		const selector: AITelemetrySelector = {
			anyOf: [
				{ allOf: [{ target: "attribute", key: "custom.key", op: "exists" }] },
			],
		};
		expect(
			spanMatchesAISelector(
				span({
					spanAttributes: { "custom.key": "from-span" },
					resourceAttributes: { "custom.key": "from-resource" },
				}),
				selector
			)
		).toBe(true);
		expect(
			spanMatchesAISelector(
				span({ resourceAttributes: { "custom.key": "from-resource" } }),
				selector
			)
		).toBe(true);
		expect(spanMatchesAISelector(span({}), selector)).toBe(false);
	});

	it("matches the 'in' operator against an array of candidate values", () => {
		const selector: AITelemetrySelector = {
			anyOf: [
				{
					allOf: [
						{
							target: "attribute",
							scope: "span",
							key: "gen_ai.system",
							op: "in",
							value: ["openai", "anthropic"],
						},
					],
				},
			],
		};
		expect(
			spanMatchesAISelector(
				span({ spanAttributes: { "gen_ai.system": "anthropic" } }),
				selector
			)
		).toBe(true);
		expect(
			spanMatchesAISelector(
				span({ spanAttributes: { "gen_ai.system": "cohere" } }),
				selector
			)
		).toBe(false);
	});

	it("matches the 'in' operator against a scalar (non-array) value", () => {
		const selector: AITelemetrySelector = {
			anyOf: [
				{
					allOf: [
						{
							target: "attribute",
							scope: "span",
							key: "gen_ai.system",
							op: "in",
							value: "openai",
						},
					],
				},
			],
		};
		expect(
			spanMatchesAISelector(
				span({ spanAttributes: { "gen_ai.system": "openai" } }),
				selector
			)
		).toBe(true);
	});

	it("defaults the attribute key to an empty string when no key is provided", () => {
		const selector: AITelemetrySelector = {
			anyOf: [
				{ allOf: [{ target: "attribute", scope: "resource", op: "exists" }] },
			],
		};
		expect(spanMatchesAISelector(span({}), selector)).toBe(false);
	});

	it("defaults a spanName condition's value to an empty string when none is provided", () => {
		const selector: AITelemetrySelector = {
			anyOf: [{ allOf: [{ target: "spanName", op: "in" }] }],
		};
		expect(spanMatchesAISelector(span({ name: "n" }), selector)).toBe(false);
	});

	it("defaults an 'eq' condition's value to an empty string when none is provided", () => {
		const selector: AITelemetrySelector = {
			anyOf: [
				{
					allOf: [
						{ target: "attribute", scope: "resource", key: "empty.val", op: "eq" },
					],
				},
			],
		};
		expect(
			spanMatchesAISelector(
				span({ resourceAttributes: { "empty.val": "" } }),
				selector
			)
		).toBe(true);
		expect(
			spanMatchesAISelector(
				span({ resourceAttributes: { "empty.val": "not-empty" } }),
				selector
			)
		).toBe(false);
	});

	it("defaults an 'in' condition's value to an empty string when none is provided", () => {
		const selector: AITelemetrySelector = {
			anyOf: [
				{
					allOf: [
						{ target: "attribute", scope: "resource", key: "empty.val", op: "in" },
					],
				},
			],
		};
		expect(
			spanMatchesAISelector(
				span({ resourceAttributes: { "empty.val": "" } }),
				selector
			)
		).toBe(true);
	});

	it("returns false for an unsupported condition operator", () => {
		const selector: AITelemetrySelector = {
			anyOf: [
				{
					allOf: [
						{
							target: "attribute",
							scope: "span",
							key: "foo",
							op: "unsupported" as unknown as "exists",
						},
					],
				},
			],
		};
		expect(
			spanMatchesAISelector(span({ spanAttributes: { foo: "bar" } }), selector)
		).toBe(false);
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

	it("lists the looping tool span when the agent-loop chip is on", async () => {
		const tool = (spanID: string, copy: number) => ({
			traceID: "loop",
			spanID,
			operationName: "execute_tool search",
			references: [{ refType: "CHILD_OF", spanID: "root" }],
			startTime: 1782864000000000 + copy,
			duration: 20,
			processID: "p1",
			tags: [
				{ key: "gen_ai.tool.name", value: "search" },
				{ key: "gen_ai.tool.args", value: '{"q":"orders"}' },
				{ key: "gen_ai.conversation.id", value: "chat-1" },
			],
		});
		mockSafeFetch.mockResolvedValue({
			data: [
				{
					traceID: "loop",
					processes: { p1: { serviceName: "svc", tags: [] } },
					spans: [
						{
							traceID: "loop",
							spanID: "root",
							operationName: "openai.chat.completions",
							references: [],
							startTime: 1782864000000000,
							duration: 5000,
							processID: "p1",
							tags: [{ key: "gen_ai.request.model", value: "gpt-4" }],
						},
						tool("t1", 1),
						tool("t2", 2),
						tool("t3", 3),
					],
				},
				{
					traceID: "ok",
					processes: { p1: { serviceName: "svc", tags: [] } },
					spans: [
						{
							traceID: "ok",
							spanID: "ok-root",
							operationName: "openai.chat.completions",
							references: [],
							startTime: 1782864100000000,
							duration: 100,
							processID: "p1",
							tags: [{ key: "gen_ai.request.model", value: "gpt-4" }],
						},
						{
							traceID: "ok",
							spanID: "ok-tool",
							operationName: "execute_tool search",
							references: [{ refType: "CHILD_OF", spanID: "ok-root" }],
							startTime: 1782864100000100,
							duration: 20,
							processID: "p1",
							tags: [
								{ key: "gen_ai.tool.name", value: "search" },
								{ key: "gen_ai.tool.args", value: '{"q":"once"}' },
							],
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
			agentLoop: true,
		});
		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0]).toMatchObject({
			traceId: "loop",
			name: "execute_tool search",
			agentLoop: expect.objectContaining({
				toolName: "search",
				count: 3,
			}),
		});
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
		expect(
			frame.rows.some((row) => Number((row as { count?: unknown }).count) > 0)
		).toBe(true);
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

describe("JaegerAdapter extended coverage", () => {
	const descriptor: TelemetrySourceDescriptor = {
		type: "jaeger",
		id: "src-jaeger",
		isBuiltIn: false,
		settings: { url: "https://jaeger.example.com", services: ["svc"] },
		signals: ["traces"],
		name: "Jaeger",
	};
	const adapter = new JaegerAdapter(descriptor);

	const noConfigDescriptor: TelemetrySourceDescriptor = {
		type: "jaeger",
		id: "src-jaeger-noconfig",
		isBuiltIn: false,
		settings: { url: "https://jaeger.example.com" },
		signals: ["traces"],
		name: "Jaeger",
	};
	const noConfigAdapter = new JaegerAdapter(noConfigDescriptor);

	const aiTag = { key: "gen_ai.request.model", value: "gpt-4" };

	function traceFixture(opts: {
		traceId: string;
		spanId?: string;
		name?: string;
		startTime?: number;
		duration?: number;
		tags?: { key: string; value: string }[];
		references?: { refType: string; spanID: string }[];
		serviceName?: string;
	}) {
		return {
			traceID: opts.traceId,
			processes: { p1: { serviceName: opts.serviceName ?? "svc", tags: [] } },
			spans: [
				{
					traceID: opts.traceId,
					spanID: opts.spanId ?? "root",
					operationName: opts.name ?? "op",
					references: opts.references || [],
					startTime: opts.startTime ?? 1782864000000000,
					duration: opts.duration ?? 1000,
					processID: "p1",
					tags: opts.tags || [aiTag],
				},
			],
		};
	}

	describe("pickRootSpan", () => {
		it("picks an orphaned reference as the trace root when no zero-parent span exists", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					traceFixture({
						traceId: "orphan",
						spanId: "child",
						references: [{ refType: "CHILD_OF", spanID: "missing-parent" }],
					}),
				],
			});
			const frame = await adapter.listSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(frame.rows[0]).toMatchObject({ spanId: "child", traceId: "orphan" });
		});

		it("falls back to the earliest-timestamp span when no explicit root exists", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					{
						traceID: "cyclic",
						processes: { p1: { serviceName: "svc", tags: [] } },
						spans: [
							{
								traceID: "cyclic",
								spanID: "a",
								operationName: "a-op",
								references: [{ refType: "CHILD_OF", spanID: "a" }],
								startTime: 1782864000100000,
								duration: 50,
								processID: "p1",
								tags: [aiTag],
							},
							{
								traceID: "cyclic",
								spanID: "b",
								operationName: "b-op",
								references: [{ refType: "CHILD_OF", spanID: "b" }],
								startTime: 1782864000000000,
								duration: 50,
								processID: "p1",
								tags: [aiTag],
							},
						],
					},
				],
			});
			const frame = await adapter.listSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(frame.rows[0]?.spanId).toBe("b");
		});
	});

	describe("spanMatchesFilters", () => {
		it("keeps traces matching a spanName filter (scalar and array values)", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					traceFixture({ traceId: "chat", name: "chat" }),
					traceFixture({ traceId: "health", name: "GET /health" }),
				],
			});
			const scalar = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "spanName", op: "eq", value: "chat" }],
			});
			expect(scalar.total).toBe(1);

			const array = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "spanName", op: "in", value: ["chat", "other"] }],
			});
			expect(array.total).toBe(1);
		});

		it("filters by span status (error vs ok, scalar and array values)", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					traceFixture({
						traceId: "err",
						tags: [{ key: "otel.status_code", value: "STATUS_CODE_ERROR" }],
					}),
					traceFixture({
						traceId: "ok",
						tags: [{ key: "otel.status_code", value: "STATUS_CODE_OK" }],
					}),
				],
			});
			const errorOnly = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "status", op: "eq", value: "error" }],
			});
			expect(errorOnly.total).toBe(1);

			const okOnly = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "status", op: "eq", value: "ok" }],
			});
			expect(okOnly.total).toBe(1);

			const arrayValue = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "status", op: "in", value: ["error", "STATUS_CODE_ERROR"] }],
			});
			expect(arrayValue.total).toBe(1);
		});

		it("filters by attribute exists/eq/neq/in", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					traceFixture({ traceId: "has-attr", tags: [{ key: "custom.attr", value: "yes" }] }),
					traceFixture({ traceId: "no-attr", tags: [] }),
				],
			});
			const exists = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "attribute", key: "custom.attr", op: "exists" }],
			});
			expect(exists.total).toBe(1);

			const eq = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "attribute", key: "custom.attr", op: "eq", value: "yes" }],
			});
			expect(eq.total).toBe(1);

			const neq = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "attribute", key: "custom.attr", op: "neq", value: "yes" }],
			});
			expect(neq.total).toBe(1);

			const inOp = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [
					{ target: "attribute", key: "custom.attr", op: "in", value: ["yes", "maybe"] },
				],
			});
			expect(inOp.total).toBe(1);

			// `in` with a single scalar (non-array) value still coerces to a list.
			const inScalar = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "attribute", key: "custom.attr", op: "in", value: "yes" }],
			});
			expect(inScalar.total).toBe(1);
		});

		it("keeps traces when a filter target is not spanName/status/attribute", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "any" })] });
			const result = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "duration", op: "gt", value: 100 }],
			});
			expect(result.total).toBe(1);
		});
	});

	describe("servicesFromFilters / operationFromFilters", () => {
		it("uses an explicit service.name filter instead of discovering services", async () => {
			mockSafeFetch.mockImplementation(async (url: string) => {
				expect(String(url)).not.toContain("/api/services");
				return { data: [traceFixture({ traceId: "custom", serviceName: "custom-svc" })] };
			});
			const result = await noConfigAdapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "attribute", key: "service.name", op: "eq", value: "custom-svc" }],
			});
			expect(result.total).toBe(1);
			const url = String(mockSafeFetch.mock.calls[0][0]);
			expect(url).toContain("service=custom-svc");
		});

		it("fans out over multiple service.name filter values (in)", async () => {
			mockSafeFetch.mockImplementation(async (url: string) => {
				expect(String(url)).not.toContain("/api/services");
				const service = new URL(String(url)).searchParams.get("service");
				return { data: [traceFixture({ traceId: `t-${service}`, serviceName: service || "" })] };
			});
			const result = await noConfigAdapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [
					{
						target: "attribute",
						key: "service.name",
						op: "in",
						value: ["svc-a", "svc-b"],
					},
				],
			});
			expect(result.total).toBe(2);
			const services = mockSafeFetch.mock.calls.map((call) =>
				new URL(String(call[0])).searchParams.get("service")
			);
			expect(services.sort()).toEqual(["svc-a", "svc-b"]);
		});

		it("coerces a scalar service.name `in` filter value to a single-service list", async () => {
			mockSafeFetch.mockImplementation(async (url: string) => {
				expect(String(url)).not.toContain("/api/services");
				return { data: [traceFixture({ traceId: "single-in", serviceName: "svc-solo" })] };
			});
			const result = await noConfigAdapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [
					{ target: "attribute", key: "service.name", op: "in", value: "svc-solo" },
				],
			});
			expect(result.total).toBe(1);
			expect(String(mockSafeFetch.mock.calls[0][0])).toContain("service=svc-solo");
		});

		it("maps a spanName filter onto Jaeger's single operation search param", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "op-test" })] });
			await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "spanName", op: "eq", value: "checkout" }],
			});
			const url = String(mockSafeFetch.mock.calls[0][0]);
			expect(url).toContain("operation=checkout");
		});

		it("uses the first spanName value from an array filter as the operation", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "op-test-2" })] });
			await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "spanName", op: "in", value: ["checkout", "other"] }],
			});
			const url = String(mockSafeFetch.mock.calls[0][0]);
			expect(url).toContain("operation=checkout");
		});
	});

	describe("healthCheck", () => {
		it("succeeds when Jaeger reports services", async () => {
			mockSafeFetch.mockResolvedValue({ data: ["svc-a", "svc-b"] });
			const result = await adapter.healthCheck();
			expect(result.ok).toBe(true);
			expect(typeof result.latencyMs).toBe("number");
		});

		it("fails when Jaeger reports no services", async () => {
			mockSafeFetch.mockResolvedValue({ data: [] });
			await expect(adapter.healthCheck()).resolves.toMatchObject({
				ok: false,
				message: "Jaeger returned no services",
			});
		});

		it("fails with the upstream status for a Jaeger HTTP error", async () => {
			const { SourceResponseError } = jest.requireMock(
				"@/lib/platform/connectors/datasource/http/safe-fetch"
			) as { SourceResponseError: new (status: number, message: string) => Error };
			mockSafeFetch.mockRejectedValue(new SourceResponseError(503, "jaeger down"));
			const result = await adapter.healthCheck();
			expect(result.ok).toBe(false);
			expect(result.message).toContain("Jaeger request failed (503)");
		});

		it("fails with a generic error message for non-HTTP failures", async () => {
			mockSafeFetch.mockRejectedValue(new Error("network unreachable"));
			const result = await adapter.healthCheck();
			expect(result.ok).toBe(false);
			expect(result.message).toContain("network unreachable");
		});
	});

	describe("listServices", () => {
		it("discovers services from the Jaeger API when none are configured", async () => {
			mockSafeFetch.mockResolvedValue({ data: ["svc-x", "", "svc-y"] });
			const services = await noConfigAdapter.discoverServices(window);
			expect(services.map((s) => s.serviceName)).toEqual(["svc-x", "svc-y"]);
			expect(mockSafeFetch).toHaveBeenCalledTimes(1);
			expect(String(mockSafeFetch.mock.calls[0][0])).toContain("/api/services");
		});
	});

	describe("misc small branches", () => {
		it("carries an explicit span.kind tag onto the normalized span", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					traceFixture({
						traceId: "kind-trace",
						tags: [aiTag, { key: "span.kind", value: "client" }],
					}),
				],
			});
			const frame = await adapter.listSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(frame.rows[0]).toMatchObject({ spanKind: "client" });
		});

		it("returns an empty span list when the trace lookup finds nothing", async () => {
			mockSafeFetch.mockResolvedValue({ data: [] });
			await expect(adapter.getTraceSpans("does-not-exist")).resolves.toEqual([]);
		});

		it("defaults sampleTracesForGraph's budget when maxTraces is falsy", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "default-budget" })] });
			const spans = await adapter.sampleTracesForGraph(
				{ signal: "traces", timeRange: window, aiSelector: false },
				0
			);
			expect(spans.some((s) => s.traceId === "default-budget")).toBe(true);
		});

		it("falls back to an empty base URL when no url setting is configured", async () => {
			const blankUrlDescriptor: TelemetrySourceDescriptor = {
				type: "jaeger",
				id: "src-jaeger-blank-url",
				isBuiltIn: false,
				settings: { services: ["svc"] },
				signals: ["traces"],
				name: "Jaeger",
			};
			const blankUrlAdapter = new JaegerAdapter(blankUrlDescriptor);
			const result = await blankUrlAdapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			// Invalid (empty) URL fails per-service, so the trace fetch degrades to zero results.
			expect(result.total).toBe(0);
		});

		it("treats a missing filter value as an empty string for spanName/attribute matchers", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [traceFixture({ traceId: "no-value", name: "" })],
			});
			const bySpanName = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "spanName", op: "eq" }],
			});
			expect(bySpanName.total).toBe(1);

			const byAttribute = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "attribute", key: "missing.attr", op: "eq" }],
			});
			// The attribute is absent, so an empty-string filter value still excludes it.
			expect(byAttribute.total).toBe(0);
		});
	});

	describe("more edge branches", () => {
		it("skips spans without a spanId when remembering them for getSpan", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					{
						traceID: "no-span-id",
						processes: { p1: { serviceName: "svc", tags: [] } },
						spans: [
							{
								traceID: "no-span-id",
								spanID: "",
								operationName: "anonymous",
								references: [],
								startTime: 1782864000000000,
								duration: 10,
								processID: "p1",
								tags: [aiTag],
							},
						],
					},
				],
			});
			await expect(adapter.getTraceSpans("no-span-id")).resolves.toEqual([
				expect.objectContaining({ spanId: "" }),
			]);
		});

		it("skips traces with no spans and traces with a missing/duplicate traceID", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					{ traceID: "empty-spans", processes: { p1: { serviceName: "svc", tags: [] } }, spans: [] },
					{ traceID: "", processes: { p1: { serviceName: "svc", tags: [] } }, spans: [
						{ traceID: "", spanID: "no-id-span", operationName: "op", references: [], startTime: 1782864000000000, duration: 10, processID: "p1", tags: [aiTag] },
					] },
					traceFixture({ traceId: "dup", spanId: "dup-1" }),
					traceFixture({ traceId: "dup", spanId: "dup-2" }),
				],
			});
			const frame = await adapter.listSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			// Only the first occurrence of "dup" survives; empty-span/no-id traces are dropped.
			expect(frame.rows.map((r) => r.traceId).sort()).toEqual(["dup"]);
		});

		it("falls back to earliest-timestamp span when the sort comparator sees a missing timestamp", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					{
						traceID: "zero-ts",
						processes: { p1: { serviceName: "svc", tags: [] } },
						spans: [
							{
								traceID: "zero-ts", spanID: "x", operationName: "x-op",
								references: [{ refType: "CHILD_OF", spanID: "x" }],
								startTime: 5_000_000_000_000, duration: 10, processID: "p1", tags: [aiTag],
							},
							{
								traceID: "zero-ts", spanID: "y", operationName: "y-op",
								references: [{ refType: "CHILD_OF", spanID: "y" }],
								startTime: 0, duration: 10, processID: "p1", tags: [aiTag],
							},
						],
					},
				],
			});
			const frame = await adapter.listSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(frame.rows[0]?.spanId).toBe("y");
		});

		it("treats a span with no status tag as non-error", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "no-status" })] });
			const result = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "status", op: "eq", value: "ok" }],
			});
			expect(result.total).toBe(1);
		});

		it("treats a missing filter value as empty for the neq/in attribute operators", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "no-value-2" })] });
			const neq = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "attribute", key: "missing.attr", op: "neq" }],
			});
			expect(neq.total).toBe(1);

			const inOp = await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "attribute", key: "missing.attr", op: "in" }],
			});
			expect(inOp.total).toBe(0);
		});

		it("resolves a scalar (non-array) spanName `in` filter value into an operation", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "op-scalar-in" })] });
			await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "spanName", op: "in", value: "checkout" }],
			});
			expect(String(mockSafeFetch.mock.calls[0][0])).toContain("operation=checkout");
		});

		it("skips a blank leading value when resolving an operation from an array filter", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "op-blank-leading" })] });
			await adapter.countTraces({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				filters: [{ target: "spanName", op: "in", value: ["", "checkout"] }],
			});
			expect(String(mockSafeFetch.mock.calls[0][0])).toContain("operation=checkout");
		});

		it("defaults the bucketing interval to 1h when the query does not request one", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "default-interval" })] });
			const frame = await adapter.traceTimeSeries({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(frame.meta?.freshness).toBe("sampled");
		});
	});

	describe("rememberSpans span index cap", () => {
		it("evicts the oldest indexed span once the per-source cap is reached", async () => {
			const evictDescriptor: TelemetrySourceDescriptor = {
				type: "jaeger",
				id: "src-jaeger-evict",
				isBuiltIn: false,
				settings: { url: "https://jaeger.example.com", services: ["svc"] },
				signals: ["traces"],
				name: "Jaeger",
			};
			const evictAdapter = new JaegerAdapter(evictDescriptor);
			const bigTrace = {
				traceID: "big",
				processes: { p1: { serviceName: "svc", tags: [] } },
				// One more span than SPAN_INDEX_MAX (5_000) so the index must evict.
				spans: Array.from({ length: 5_001 }, (_, i) => ({
					traceID: "big",
					spanID: `s${i}`,
					operationName: `op${i}`,
					references: [],
					startTime: 1782864000000000 + i,
					duration: 10,
					processID: "p1",
					tags: [],
				})),
			};
			mockSafeFetch.mockResolvedValue({ data: [bigTrace] });
			const spans = await evictAdapter.getTraceSpans("big");
			expect(spans).toHaveLength(5_001);
			// The most recently indexed span is still served straight from the index.
			expect(await evictAdapter.getSpan("s5000")).toMatchObject({ spanId: "s5000" });
		});
	});

	describe("startMs fallback for trace ordering", () => {
		it("scans span timestamps when the root span has no timestamp", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					{
						traceID: "no-ts-root",
						processes: { p1: { serviceName: "svc", tags: [] } },
						spans: [
							{
								traceID: "no-ts-root",
								spanID: "root",
								operationName: "op",
								references: [],
								startTime: 0,
								duration: 10,
								processID: "p1",
								tags: [aiTag],
							},
						],
					},
				],
			});
			const frame = await adapter.listSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(frame.rows.map((r) => r.traceId)).toContain("no-ts-root");
		});
	});

	describe("collectTraces failure handling", () => {
		it("throttles a failing service for 30s so later calls skip refetching it", async () => {
			const flakyDescriptor: TelemetrySourceDescriptor = {
				type: "jaeger",
				id: "src-jaeger-flaky",
				isBuiltIn: false,
				settings: { url: "https://jaeger.example.com", services: ["flaky-svc"] },
				signals: ["traces"],
				name: "Jaeger",
			};
			const flakyAdapter = new JaegerAdapter(flakyDescriptor);
			const { SourceResponseError } = jest.requireMock(
				"@/lib/platform/connectors/datasource/http/safe-fetch"
			) as { SourceResponseError: new (status: number, message: string) => Error };
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(500, "boom"));

			const first = await flakyAdapter.listSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(first.rows).toHaveLength(0);
			expect(mockSafeFetch).toHaveBeenCalledTimes(1);

			mockSafeFetch.mockResolvedValue({
				data: [traceFixture({ traceId: "should-not-fetch" })],
			});
			const second = await flakyAdapter.listSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(second.rows).toHaveLength(0);
			// Still throttled: no additional fetch for the flaky service.
			expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		});
	});

	describe("generation health filtering", () => {
		it("keeps only traces matching the requested generation-health chip", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					traceFixture({
						traceId: "truncated-trace",
						spanId: "trunc-span",
						name: "chat",
						tags: [
							aiTag,
							{ key: "gen_ai.response.finish_reasons", value: "length" },
						],
					}),
					traceFixture({
						traceId: "ok-trace",
						spanId: "ok-span",
						name: "chat",
						tags: [aiTag, { key: "gen_ai.response.finish_reasons", value: "stop" }],
					}),
				],
			});
			const frame = await adapter.listSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				generationHealth: ["truncated"],
			});
			expect(frame.rows).toHaveLength(1);
			expect(frame.rows[0]).toMatchObject({
				traceId: "truncated-trace",
				spanId: "trunc-span",
			});
		});
	});

	describe("legacy collectSpans helper", () => {
		it("flattens collected traces and caps the span count", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "legacy" })] });
			const spans = await (
				adapter as unknown as {
					collectSpans: (q: unknown, n: number) => Promise<unknown[]>;
				}
			).collectSpans({ signal: "traces", timeRange: window, aiSelector: false }, 10);
			expect(Array.isArray(spans)).toBe(true);
			expect(spans.length).toBeGreaterThan(0);
		});
	});

	describe("getSpan", () => {
		it("falls back to a recent trace scan when the span is not indexed yet", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [traceFixture({ traceId: "fresh-trace", spanId: "fresh-span-1" })],
			});
			const found = await adapter.getSpan("fresh-span-1");
			expect(found).toMatchObject({ spanId: "fresh-span-1", traceId: "fresh-trace" });
		});

		it("returns null when the span cannot be found anywhere", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [traceFixture({ traceId: "other", spanId: "other-span" })],
			});
			const found = await adapter.getSpan("totally-missing-span-id");
			expect(found).toBeNull();
		});
	});

	describe("sampleTracesForGraph / aggregateSpans / spanTimeSeries", () => {
		it("samples traces for the discovery graph", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "graph-trace" })] });
			const spans = await adapter.sampleTracesForGraph(
				{ signal: "traces", timeRange: window, aiSelector: false },
				50
			);
			expect(spans.some((s) => s.traceId === "graph-trace")).toBe(true);
		});

		it("aggregates spans via the L1 in-process aggregator", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "agg-trace" })] });
			const frame = await adapter.aggregateSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				aggregations: [{ fn: "count" }],
			});
			expect(frame.rows.length).toBeGreaterThanOrEqual(1);
			expect(frame.meta?.degraded).toContain("serverAggregation");
		});

		it("spanTimeSeries delegates to traceTimeSeries", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "series-trace" })] });
			const frame = await adapter.spanTimeSeries({
				signal: "traces",
				timeRange: window,
				aiSelector: false,
				interval: "1d",
			});
			expect(frame.meta?.freshness).toBe("sampled");
		});
	});

	describe("distinctValues", () => {
		it("falls back to L1 sampling when the operations endpoint fails for every service", async () => {
			mockSafeFetch.mockImplementation(async (url: string) => {
				if (String(url).includes("/operations")) {
					throw new Error("operations endpoint down");
				}
				return { data: [traceFixture({ traceId: "fallback-trace", name: "fallback-op" })] };
			});
			const names = await adapter.distinctValues("SpanName", {
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(names).toContain("fallback-op");
		});

		it("resolves service.name distinct values from configured services", async () => {
			const names = await adapter.distinctValues("ServiceName", {
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(names).toEqual(["svc"]);
			expect(mockSafeFetch).not.toHaveBeenCalled();
		});

		it("falls back to L1 sampling for arbitrary attribute keys", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					traceFixture({
						traceId: "attr-trace",
						tags: [{ key: "custom.attr", value: "hello" }],
					}),
				],
			});
			const values = await adapter.distinctValues("custom.attr", {
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			});
			expect(values).toEqual(["hello"]);
		});
	});

	describe("attributeKeys", () => {
		it("collects unique span and resource attribute keys", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					traceFixture({
						traceId: "keys-trace",
						tags: [aiTag, { key: "custom.attr", value: "x" }],
					}),
				],
			});
			const keys = await adapter.attributeKeys("traces", window);
			expect(keys).toEqual(
				expect.arrayContaining(["gen_ai.request.model", "custom.attr", "service.name"])
			);
		});
	});

	describe("discoverServices / aggregateByService", () => {
		it("maps configured services into discovered service rows", async () => {
			const services = await adapter.discoverServices(window);
			expect(services).toEqual([{ serviceName: "svc", environment: "", clusterId: "" }]);
		});

		it("aggregates model/provider rollups per discovered service", async () => {
			mockSafeFetch.mockResolvedValue({
				data: [
					traceFixture({
						traceId: "rollup-trace",
						tags: [aiTag, { key: "gen_ai.system", value: "openai" }],
					}),
				],
			});
			const rollups = await adapter.aggregateByService(window);
			expect(rollups).toEqual([
				{
					serviceName: "svc",
					environment: "default",
					clusterId: "default",
					requestCount: 1,
					models: ["gpt-4"],
					providers: ["openai"],
				},
			]);
		});
	});

	describe("validateAISignal", () => {
		it("succeeds when AI-relevant traces are found", async () => {
			mockSafeFetch.mockResolvedValue({ data: [traceFixture({ traceId: "ai-trace" })] });
			const result = await adapter.validateAISignal(window);
			expect(result).toMatchObject({ ok: true, sampleCount: 1, missingAttributes: [] });
		});

		it("reports a failure message when service discovery throws", async () => {
			mockSafeFetch.mockRejectedValue(new Error("services down"));
			const result = await noConfigAdapter.validateAISignal(window);
			expect(result.ok).toBe(false);
			expect(result.sampleCount).toBe(0);
			expect(result.message).toContain("services down");
		});
	});

	describe("jaegerAdapterFactory", () => {
		it("creates an adapter instance and describes the source type", async () => {
			const { jaegerAdapterFactory } = await import(
				"@/lib/platform/connectors/datasource/jaeger/adapter"
			);
			expect(jaegerAdapterFactory.type).toBe("jaeger");
			const created = jaegerAdapterFactory.create(descriptor);
			expect(created).toBeInstanceOf(JaegerAdapter);
			const described = jaegerAdapterFactory.describe();
			expect(described).toMatchObject({
				type: "jaeger",
				displayName: "Jaeger",
				declaredSignals: ["traces"],
			});
		});
	});
});
