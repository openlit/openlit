const mockSafeFetch = jest.fn();

jest.mock("@/lib/platform/connectors/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
	SourceResponseError: class SourceResponseError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	},
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

import { TempoAdapter, tempoAISelectorQuery, buildTempoSearchQuery, __clearTempoSpanIndex } from "@/lib/platform/connectors/datasource/grafana/tempo";
import { SourceResponseError } from "@/lib/platform/connectors/datasource/http/safe-fetch";
import { __clearCache } from "@/lib/platform/connectors/datasource/http/cache";
import { buildAggregateDag } from "@/lib/platform/connectors/datasource/graph/aggregate-dag";
import type {
	NormalizedSpan,
	TelemetrySourceDescriptor,
} from "@/lib/platform/connectors/datasource/types";

const window = {
	start: new Date("2026-07-01T00:00:00.000Z"),
	end: new Date("2026-07-02T00:00:00.000Z"),
};

const TRACE_1 = "0123456789abcdef0123456789abcdef";
const TRACE_2 = "fedcba9876543210fedcba9876543210";
const SPAN_1 = "0123456789abcdef";
const SPAN_2 = "fedcba9876543210";

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
							traceId: TRACE_1,
							spanId: SPAN_1,
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

	it("drops hostile attribute keys instead of interpolating them into TraceQL", () => {
		const q = buildTempoSearchQuery({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			filters: [
				{
					target: "attribute",
					scope: "span",
					key: 'foo" || true || span.bar',
					op: "eq",
					value: "x",
				},
				{
					target: "attribute",
					scope: "resource",
					key: "service.name",
					op: "eq",
					value: "ok",
				},
			],
		});
		expect(q).not.toContain("|| true");
		expect(q).toContain('resource.service.name = "ok"');
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

	it("retries a 31-day HTTP 400 search with Tempo's compatible 30-day window", async () => {
		const wideAdapter = new TempoAdapter({
			...descriptor,
			settings: {
				...descriptor.settings,
				maxTimeRangeDays: 31,
			},
		});
		const end = new Date("2026-08-06T11:24:17.901Z");
		const start = new Date(end.getTime() - 31 * 24 * 60 * 60 * 1000);
		mockSafeFetch
			.mockRejectedValueOnce(
				new SourceResponseError(
					400,
					"Data source responded 400: query range duration exceeds max duration 720h0m0s"
				)
			)
			.mockResolvedValueOnce({
				traces: [{
					traceID: TRACE_1,
					rootServiceName: "svc",
					rootTraceName: "chat",
					startTimeUnixNano: "1719792000000000000",
					durationMs: 1000,
				}],
			});

		const frame = await wideAdapter.listSpans({
			signal: "traces",
			timeRange: { start, end },
			aiSelector: false,
			limit: 1,
		});

		expect(frame.rows).toHaveLength(1);
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
		const retriedSearch = new URL(mockSafeFetch.mock.calls[1][0] as string);
		expect(Number(retriedSearch.searchParams.get("start"))).toBe(
			Math.ceil(end.getTime() / 1000) - 30 * 24 * 60 * 60
		);
	});

	it("does not retry a generic Tempo 400 by weakening the query", async () => {
		mockSafeFetch.mockRejectedValueOnce(
			new SourceResponseError(
				400,
				"Data source responded 400: invalid TraceQL near resource.service.name"
			)
		);
		await expect(
			adapter.listSpans({
				signal: "traces",
				timeRange: window,
				aiSelector: true,
				filters: [{
					target: "attribute",
					scope: "resource",
					key: "service.name",
					op: "eq",
					value: "svc",
				}],
				limit: 1,
			})
		).rejects.toThrow("Tempo returned HTTP 400");
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		const failedUrl = decodeURIComponent(
			mockSafeFetch.mock.calls[0][0] as string
		).replace(/\+/g, " ");
		expect(failedUrl).toContain('resource.service.name = "svc"');
	});

	it("detects Tempo 2.8 and enables most_recent only after a successful health inspection", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ version: "2.8.2" })
			.mockResolvedValueOnce({
				traces: [{
					traceID: TRACE_1,
					rootServiceName: "svc",
					rootTraceName: "chat",
					startTimeUnixNano: "1719792000000000000",
					durationMs: 12,
				}],
			});
		await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: true });
		await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			limit: 1,
		});
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
		const searchUrl = decodeURIComponent(
			mockSafeFetch.mock.calls[1][0] as string
		).replace(/\+/g, " ");
		expect(searchUrl).toContain("with (most_recent=true)");
	});

	it("checks a minimal search when a managed Tempo gateway hides build metadata", async () => {
		mockSafeFetch
			.mockRejectedValueOnce(new SourceResponseError(404, "buildinfo is not exposed"))
			.mockResolvedValueOnce({ traces: [] });

		await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: true });
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
		const searchUrl = decodeURIComponent(
			mockSafeFetch.mock.calls[1][0] as string
		).replace(/\+/g, " ");
		expect(searchUrl).toContain("/api/search");
		expect(searchUrl).not.toContain("most_recent");
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
			.mockRejectedValueOnce(
				new SourceResponseError(404, "Data source responded 404: metrics disabled")
			) // metrics endpoint unavailable
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] }) // search
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

	it("chunks multi-day TraceQL metrics through OpenPlait and de-duplicates boundary buckets", async () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const boundary = new Date("2026-07-02T00:00:00.000Z");
		const end = new Date("2026-07-03T00:00:00.000Z");
		mockSafeFetch
			.mockResolvedValueOnce({
				series: [{ labels: [], samples: [
					{ timestampMs: start.getTime(), value: 2 },
					{ timestampMs: boundary.getTime(), value: 3 },
				] }],
			})
			.mockResolvedValueOnce({
				series: [{ labels: [], samples: [
					{ timestampMs: boundary.getTime(), value: 3 },
					{ timestampMs: end.getTime(), value: 4 },
				] }],
			});
		const frame = await adapter.spanTimeSeries({
			signal: "traces",
			timeRange: { start, end },
			aiSelector: false,
			interval: "1h",
			aggregations: [{ fn: "count", as: "count" }],
		});
		expect((frame.rows as any[]).map((row) => Number(row.count))).toEqual([2, 3, 4]);
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
		for (const call of mockSafeFetch.mock.calls) {
			expect(new URL(call[0] as string).pathname).toBe("/api/metrics/query_range");
		}
	});

	it("builds trace summary buckets from one OpenPlait search without fetching trace details", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			traces: [
				{
					traceID: TRACE_1,
					rootServiceName: "checkout",
					rootTraceName: "POST /checkout",
					startTimeUnixNano: "1782864000000000000",
					durationMs: 125,
				},
				{
					traceID: TRACE_2,
					rootServiceName: "payments",
					rootTraceName: "POST /charge",
					startTimeUnixNano: "1782867600000000000",
					durationMs: 75,
				},
			],
		});

		const frame = await adapter.traceTimeSeries!({
			signal: "traces",
			timeRange: window,
			interval: "1h",
			aiSelector: false,
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "avg", field: "duration", as: "avgDuration" },
			],
		});

		expect(
			(frame.rows as any[]).reduce(
				(sum: number, row: any) => sum + Number(row.count || 0),
				0
			)
		).toBe(2);
		expect(frame.meta).toMatchObject({
			freshness: "live",
			truncated: false,
			rowsScanned: 2,
		});
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		const searchUrl = new URL(mockSafeFetch.mock.calls[0][0] as string);
		expect(searchUrl.pathname).toBe("/api/search");
		expect(searchUrl.searchParams.get("limit")).toBe("5001");
		await expect(adapter.countTraces!({
			signal: "traces",
			timeRange: window,
			interval: "1h",
			aiSelector: false,
		})).resolves.toEqual({ total: 2, truncated: false });
		// The list total and summary chart share the same cached Tempo search.
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	});

	it("learns Grafana Cloud's Tempo search ceiling and retries the summary", async () => {
		mockSafeFetch
			.mockRejectedValueOnce(
				new SourceResponseError(
					400,
					"Data source responded 400: limit 5001 exceeds max limit 1000"
				)
			)
			.mockResolvedValueOnce({
				traces: [
					{
						traceID: TRACE_1,
						rootServiceName: "checkout",
						rootTraceName: "POST /checkout",
						startTimeUnixNano: "1782864000000000000",
						durationMs: 125,
					},
				],
			});

		const frame = await adapter.traceTimeSeries!({
			signal: "traces",
			timeRange: window,
			interval: "1h",
			aiSelector: false,
			aggregations: [{ fn: "count", as: "count" }],
		});

		expect(frame.meta).toMatchObject({ freshness: "live", truncated: false });
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
		expect(
			new URL(mockSafeFetch.mock.calls[0][0] as string).searchParams.get("limit")
		).toBe("5001");
		expect(
			new URL(mockSafeFetch.mock.calls[1][0] as string).searchParams.get("limit")
		).toBe("1000");
	});

	it("marks trace summary buckets sampled only when the 5000-trace cap is exceeded", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			traces: Array.from({ length: 5_001 }, (_, index) => ({
				traceID: index.toString(16).padStart(32, "0"),
				rootServiceName: "checkout",
				rootTraceName: "POST /checkout",
				startTimeUnixNano: "1782864000000000000",
				durationMs: 25,
			})),
		});

		const frame = await adapter.traceTimeSeries!({
			signal: "traces",
			timeRange: window,
			interval: "1h",
			aiSelector: false,
			aggregations: [{ fn: "count", as: "count" }],
		});

		expect(
			(frame.rows as any[]).reduce(
				(sum: number, row: any) => sum + Number(row.count || 0),
				0
			)
		).toBe(5_000);
		expect(frame.meta).toMatchObject({
			freshness: "sampled",
			truncated: true,
			rowsScanned: 5_000,
			degraded: ["traceSummaryLimit"],
		});
		await expect(adapter.countTraces!({
			signal: "traces",
			timeRange: window,
			interval: "1h",
			aiSelector: false,
		})).resolves.toEqual({ total: 5_000, truncated: true });
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	});

	it("getTraceSpans parses OTLP into normalized spans with events", async () => {
		mockSafeFetch.mockResolvedValue(otlpTrace);
		const spans = await adapter.getTraceSpans(TRACE_1);
		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({
			traceId: TRACE_1,
			spanId: SPAN_1,
			name: "chat",
			serviceName: "svc",
			statusCode: "STATUS_CODE_OK",
			durationNs: 1000000000,
		});
		expect(spans[0].resourceAttributes["telemetry.sdk.name"]).toBe("openlit");
		expect(spans[0].events?.[0].attributes["gen_ai.prompt"]).toBe("hi");
	});

	it("listSpans uses TraceQL search summaries without downloading full OTLP traces", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			traces: [
				{
					traceID: TRACE_1,
					rootServiceName: "svc-a",
					rootTraceName: "chat",
					startTimeUnixNano: "1719792000000000000",
					durationMs: 12.5,
				},
				{
					traceID: TRACE_2,
					rootServiceName: "svc-b",
					rootTraceName: "embed",
					startTimeUnixNano: "1719792001000000000",
					durationMs: 4,
				},
			],
		});
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 5,
			aiSelector: true,
		});
		// One list row per trace summary — no per-trace OTLP fan-out.
		expect(frame.rows).toHaveLength(2);
		expect(frame.rows[0]).toMatchObject({
			traceId: TRACE_1,
			spanId: TRACE_1,
			serviceName: "svc-a",
			name: "chat",
			durationNs: 12_500_000,
		});
		const searchUrl = mockSafeFetch.mock.calls[0][0] as string;
		expect(searchUrl).toContain("/api/search");
		expect(decodeURIComponent(searchUrl)).toContain("telemetry.sdk.name");
		expect(mockSafeFetch.mock.calls[0][1]).toMatchObject({
			headers: expect.objectContaining({
				accept: "application/json",
				authorization: "Bearer tok",
				"x-request-id": expect.stringMatching(/^openlit:tempo:/),
			}),
			allowPrivateNetwork: true,
		});
		expect(frame.meta?.degraded).toContain("serverAggregation");
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	});

	it("sampleTracesForGraph skips an oversized Tempo trace instead of failing the whole sample", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({
				traces: [{ traceID: TRACE_1 }, { traceID: TRACE_2 }],
			})
			.mockRejectedValueOnce(
				new SourceResponseError(
					422,
					"Data source responded 422: trace exceeds max size (max bytes: 5000000)"
				)
			)
			.mockResolvedValueOnce(otlpForTrace(TRACE_2, SPAN_2));

		const spans = await adapter.sampleTracesForGraph(
			{
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			},
			5
		);

		expect(spans).toHaveLength(1);
		expect(spans[0]).toMatchObject({ traceId: TRACE_2, spanId: SPAN_2 });
	});

	it("getSpan resolves via TraceQL search then a single OTLP download", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] })
			.mockResolvedValueOnce(otlpTrace);
		const span = await adapter.getSpan(SPAN_1);
		expect(span?.spanId).toBe(SPAN_1);
		expect(span?.traceId).toBe(TRACE_1);
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
	});

	it("getSpan returns null when Tempo's matched trace does not contain the requested span", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] })
			.mockResolvedValueOnce(otlpTrace);

		await expect(adapter.getSpan(SPAN_2)).resolves.toBeNull();
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
	});

	it("preserves Tempo's upstream HTTP status through the OpenPlait transport", async () => {
		mockSafeFetch.mockRejectedValueOnce(
			new SourceResponseError(429, "Data source responded 429: rate limited")
		);

		await expect(
			adapter.listSpans({
				signal: "traces",
				timeRange: window,
				limit: 5,
				aiSelector: true,
			})
		).rejects.toThrow("Tempo returned HTTP 429");
	});

	it("discovers services through OpenPlait's Tempo v2 tag-values path", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			tagValues: [
				{ type: "string", value: "checkout" },
				{ type: "string", value: "payments" },
			],
		});

		await expect(adapter.discoverServices(window)).resolves.toEqual([
			{
				serviceName: "checkout",
				environment: "default",
				clusterId: "default",
			},
			{
				serviceName: "payments",
				environment: "default",
				clusterId: "default",
			},
		]);
		const url = new URL(mockSafeFetch.mock.calls[0][0] as string);
		expect(url.pathname).toBe(
			"/api/v2/search/tag/resource.service.name/values"
		);
		expect(url.searchParams.get("q")).toContain("telemetry.sdk.name");
		expect(url.searchParams.get("start")).toBe(
			String(window.start.getTime() / 1000)
		);
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
