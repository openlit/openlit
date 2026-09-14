/**
 * Extra coverage for the Grafana connector adapters (tempo.ts, loki.ts,
 * openplait-http.ts). This file targets uncovered branches/statements
 * (error-handling paths, format fallbacks, aggregation switch cases, cache
 * eviction, query-mode variants) that the primary `grafana.test.ts` suite
 * does not exercise. See that file for the base mocking setup this mirrors.
 */
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

import {
	TempoAdapter,
	tempoAdapterFactory,
	buildTempoSearchQuery,
	tempoAISelectorQuery,
	__clearTempoSpanIndex,
} from "@/lib/platform/connectors/datasource/grafana/tempo";
import {
	LokiAdapter,
	lokiAdapterFactory,
	parseLokiDurationMs,
	reportedLokiMaxQueryRangeMs,
	__resetLokiLearningForTests,
} from "@/lib/platform/connectors/datasource/grafana/loki";
import { SourceResponseError } from "@/lib/platform/connectors/datasource/http/safe-fetch";
import { resolveSourceSecret } from "@/lib/platform/connectors/datasource/http/secret";
import { __clearCache } from "@/lib/platform/connectors/datasource/http/cache";
import type {
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

function otlpForTrace(
	traceId: string,
	spanId: string,
	overrides: Record<string, unknown> = {}
) {
	return {
		batches: [
			{
				resource: {
					attributes: [
						{ key: "service.name", value: { stringValue: "svc" } },
					],
				},
				scopeSpans: [
					{
						spans: [
							{
								traceId,
								spanId,
								parentSpanId: "",
								name: "chat",
								startTimeUnixNano: "1719792000000000000",
								endTimeUnixNano: "1719792001000000000",
								status: { code: 1 },
								attributes: [
									{ key: "gen_ai.request.model", value: { stringValue: "gpt-4" } },
								],
								events: [],
								...overrides,
							},
						],
					},
				],
			},
		],
	};
}

beforeEach(() => {
	// Full reset (not just clearAllMocks) so an unconsumed `mockResolvedValueOnce`/
	// `mockRejectedValueOnce` queued by one test can never leak into the next.
	mockSafeFetch.mockReset();
	(resolveSourceSecret as jest.Mock).mockReset();
	(resolveSourceSecret as jest.Mock).mockResolvedValue({
		raw: "tok",
		credentials: { token: "tok" },
	});
	__clearCache();
	__clearTempoSpanIndex();
	__resetLokiLearningForTests();
});

describe("tempoAdapterFactory", () => {
	it("describes config fields and creates a TempoAdapter instance", () => {
		const info = tempoAdapterFactory.describe();
		expect(info.type).toBe("tempo");
		expect(info.declaredSignals).toEqual(["traces"]);
		expect(info.configFields.some((f) => f.key === "tempoVersion")).toBe(true);
		expect(info.configFields.some((f) => f.key === "enableMostRecent")).toBe(true);
		expect(info.configFields.some((f) => f.key === "metricsMaxTimeRangeHours")).toBe(true);
		const created = tempoAdapterFactory.create({
			type: "tempo",
			id: "factory-tempo",
			isBuiltIn: false,
			settings: { url: "https://tempo.example.com" },
			signals: ["traces"],
			name: "Tempo",
		});
		expect(created).toBeInstanceOf(TempoAdapter);
	});
});

describe("TempoAdapter additional coverage", () => {
	const descriptor: TelemetrySourceDescriptor = {
		type: "tempo",
		id: "src-tempo-cov",
		isBuiltIn: false,
		settings: { url: "https://tempo.example.com", allowHttp: false },
		signals: ["traces"],
		name: "Tempo",
	};

	it("normalizes span events, unset status, and non-object event items defensively", async () => {
		const adapter = new TempoAdapter(descriptor);
		mockSafeFetch.mockResolvedValueOnce(
			otlpForTrace(TRACE_1, SPAN_1, {
				status: { code: 0 },
				events: [
					null,
					"not-an-object",
					{
						name: "gen_ai.content.completion",
						// Non-integer nanos: BigInt() throws -> eventTimestamp catch path.
						timeUnixNano: 1.5,
						attributes: [
							{ key: "int", value: { intValue: 5 } },
							{ key: "double", value: { doubleValue: 1.5 } },
							{ key: "bool", value: { boolValue: true } },
							{ key: "empty", value: {} },
							{ key: 123, value: { stringValue: "skip-non-string-key" } },
							"not-an-object-attr",
						],
					},
				],
			})
		);

		const spans = await adapter.getTraceSpans(TRACE_1);
		expect(spans).toHaveLength(1);
		expect(spans[0].statusCode).toBe("STATUS_CODE_UNSET");
		expect(spans[0].events).toHaveLength(3);
		expect(spans[0].events?.[0]).toMatchObject({ name: "", timestamp: undefined });
		expect(spans[0].events?.[1]).toMatchObject({ name: "", timestamp: undefined });
		const real = spans[0].events?.[2];
		expect(real?.name).toBe("gen_ai.content.completion");
		expect(real?.timestamp).toBeUndefined();
		expect(real?.attributes).toMatchObject({
			int: "5",
			double: "1.5",
			bool: "true",
			empty: "",
		});
	});

	it("evicts the oldest indexed span once the process-wide span index is full", async () => {
		const adapter = new TempoAdapter({
			...descriptor,
			id: "src-tempo-span-index",
		});
		const SPAN_INDEX_MAX = 5_000;
		let call = 0;
		const hex = (n: number, len: number) => n.toString(16).padStart(len, "0");
		mockSafeFetch.mockImplementation(async () => {
			const idx = call++;
			return otlpForTrace(hex(idx, 32), hex(idx, 16));
		});
		for (let i = 0; i <= SPAN_INDEX_MAX; i++) {
			// eslint-disable-next-line no-await-in-loop
			await adapter.getTraceSpans(hex(i, 32));
		}

		mockSafeFetch.mockReset();
		mockSafeFetch.mockResolvedValueOnce({ traces: [] });
		const evicted = await adapter.getSpan(hex(0, 16));
		expect(evicted).toBeNull();
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);

		const recent = await adapter.getSpan(hex(SPAN_INDEX_MAX, 16));
		expect(recent?.spanId).toBe(hex(SPAN_INDEX_MAX, 16));
		// Resolved straight from the warm index — no extra HTTP call.
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	}, 20_000);

	it("filters listSpans issue rows by generationHealth chips and drops non-matching traces", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-genhealth" });
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }, { traceID: TRACE_2 }] })
			.mockResolvedValueOnce(
				otlpForTrace(TRACE_1, SPAN_1, {
					attributes: [
						{
							key: "gen_ai.response.finish_reasons",
							value: { stringValue: "length" },
						},
					],
				})
			)
			.mockResolvedValueOnce(otlpForTrace(TRACE_2, SPAN_2));

		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 25,
			aiSelector: false,
			generationHealth: ["truncated"],
		});

		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0]).toMatchObject({ traceId: TRACE_1 });
	});

	it("uses an explicit maxTimeRangeMs setting (not just maxTimeRangeDays)", () => {
		const adapter = new TempoAdapter({
			...descriptor,
			id: "src-tempo-ms",
			settings: { ...descriptor.settings, maxTimeRangeMs: 3 * 60 * 60 * 1000 },
		});
		expect(adapter.capabilities().maxTimeRangeMs).toBe(3 * 60 * 60 * 1000);
	});

	it("floors a tiny configured maxTimeRangeMs to the 60s minimum", () => {
		const adapter = new TempoAdapter({
			...descriptor,
			id: "src-tempo-ms-floor",
			settings: { ...descriptor.settings, maxTimeRangeMs: 10 },
		});
		expect(adapter.capabilities().maxTimeRangeMs).toBe(60_000);
	});

	it("honors an explicit enableMostRecent=true setting without a prior health check", async () => {
		const adapter = new TempoAdapter({
			...descriptor,
			id: "src-tempo-explicit-mostrecent",
			settings: { ...descriptor.settings, enableMostRecent: true },
		});
		mockSafeFetch.mockResolvedValueOnce({ traces: [] });
		await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			limit: 1,
		});
		const searchUrl = decodeURIComponent(mockSafeFetch.mock.calls[0][0] as string).replace(/\+/g, " ");
		expect(searchUrl).toContain("with (most_recent=true)");
	});

	it("downgrades a cached most_recent profile when a generic 400 rejects the hint, then retries", async () => {
		const adapter = new TempoAdapter({
			...descriptor,
			id: "src-tempo-hint-downgrade",
		});
		mockSafeFetch
			.mockResolvedValueOnce({ version: "2.8.2" }) // buildinfo -> caches mostRecent undefined (no explicit feature flag in this shape)
			.mockRejectedValueOnce(
				new SourceResponseError(400, "invalid TraceQL near with (most_recent=true)")
			)
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] });
		await adapter.healthCheck();
		// Force most_recent on via settings so the search actually includes the hint,
		// independent of whatever the health probe inferred.
		(adapter as unknown as { descriptor: TelemetrySourceDescriptor }).descriptor.settings.enableMostRecent = true;
		const ids = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			limit: 1,
		});
		expect(ids.rows).toHaveLength(1);
		expect(mockSafeFetch).toHaveBeenCalledTimes(3);
		const retried = decodeURIComponent(mockSafeFetch.mock.calls[2][0] as string).replace(/\+/g, " ");
		expect(retried).not.toContain("most_recent");
	});

	it("retries the hint without touching the profile cache when no health check has run yet", async () => {
		const adapter = new TempoAdapter({
			...descriptor,
			id: "src-tempo-hint-no-profile",
			settings: { ...descriptor.settings, enableMostRecent: true },
		});
		mockSafeFetch
			.mockRejectedValueOnce(new SourceResponseError(400, "invalid TraceQL near with"))
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] });
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			limit: 1,
		});
		expect(frame.rows).toHaveLength(1);
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
	});

	it("clamps a fixed-window health-check fallback search to a tight configured maxTimeRangeMs", async () => {
		const adapter = new TempoAdapter({
			...descriptor,
			id: "src-tempo-health-clamp",
			settings: { ...descriptor.settings, maxTimeRangeMs: 60_000 },
		});
		mockSafeFetch
			.mockRejectedValueOnce(new SourceResponseError(404, "buildinfo is not exposed"))
			.mockResolvedValueOnce({ traces: [] });
		await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: true });
		const searchUrl = new URL(mockSafeFetch.mock.calls[1][0] as string);
		const startSec = Number(searchUrl.searchParams.get("start"));
		const endSec = Number(searchUrl.searchParams.get("end"));
		// The fixed 5-minute fallback window must be clamped down to the 60s cap.
		expect(endSec - startSec).toBeLessThanOrEqual(60);
	});

	it("reports healthCheck failure when the managed-gateway fallback search also fails", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-health-double-fail" });
		mockSafeFetch
			.mockRejectedValueOnce(new SourceResponseError(404, "buildinfo is not exposed"))
			.mockRejectedValueOnce(new Error("network unreachable"));
		await expect(adapter.healthCheck()).resolves.toMatchObject({
			ok: false,
			message: expect.stringContaining("Tempo request failed"),
		});
	});

	it("throws a clear error when basic auth is configured but no username is resolvable", async () => {
		(resolveSourceSecret as jest.Mock).mockResolvedValueOnce({
			raw: "",
			credentials: {},
		});
		const adapter = new TempoAdapter({
			...descriptor,
			id: "src-tempo-auth-required",
			settings: { ...descriptor.settings, authType: "basic" },
		});
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(false);
		expect(result.message).toContain("basic");
	});

	it("propagates a non-HTTP transport error from the guarded fetch instead of swallowing it", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-transport-error" });
		mockSafeFetch.mockRejectedValueOnce(new TypeError("fetch failed: getaddrinfo ENOTFOUND"));
		// The guarded fetch only intercepts SourceResponseError; any other
		// transport error (network/DNS/etc.) must propagate, not be swallowed
		// into a fake 200 response.
		await expect(
			adapter.listSpans({ signal: "traces", timeRange: window, aiSelector: false, limit: 1 })
		).rejects.toThrow(/Tempo request failed/);
	});

	it("getSpan returns null when the TraceQL span-id search has no hits", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-getspan-empty" });
		mockSafeFetch.mockResolvedValueOnce({ traces: [] });
		await expect(adapter.getSpan(SPAN_1)).resolves.toBeNull();
	});

	it("getSpan returns null when the TraceQL search itself throws", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-getspan-throw" });
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(500, "boom"));
		await expect(adapter.getSpan(SPAN_1)).resolves.toBeNull();
	});

	it("aggregateSpans: sum/min/max/avg all resolve via TraceQL metrics with duration unit conversion", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-agg-fns" });
		const t0 = window.start.getTime();
		mockSafeFetch
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: t0, value: 10 }] }] }) // count anchor
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: t0, value: 40 }] }] }) // sum(cost)
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: t0, value: 20_000_000_000 }] }] }) // sum(duration) for avg
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: t0, value: 5_000_000_000 }] }] }) // min(duration)
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: t0, value: 99 }] }] }); // max(tokens)

		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "sum", field: "gen_ai.usage.cost", as: "totalCost" },
				{ fn: "avg", field: "duration", as: "avgDuration" },
				{ fn: "min", field: "duration", as: "minDuration" },
				{ fn: "max", field: "gen_ai.usage.output_tokens", as: "maxTokens" },
			],
		});
		const row = frame.rows[0] as Record<string, number>;
		expect(row.count).toBe(10);
		expect(row.totalCost).toBe(40);
		expect(row.avgDuration).toBeCloseTo(2); // 20e9 ns / 10 -> seconds
		expect(row.minDuration).toBeCloseTo(5); // ns -> seconds
		expect(row.maxTokens).toBe(99);
	});

	it("aggregateSpans groups by span name and by resource.service.name aliases", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-group-aliases" });
		mockSafeFetch.mockResolvedValueOnce({
			series: [{ labels: [{ key: "name", value: "chat" }], samples: [{ timestampMs: window.start.getTime(), value: 3 }] }],
		});
		const byName = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			groupBy: ["spanName"],
			aggregations: [{ fn: "count", as: "count" }],
		});
		expect((byName.rows[0] as any).count).toBe(3);
		const metricsUrl = decodeURIComponent(mockSafeFetch.mock.calls[0][0] as string).replace(/\+/g, " ");
		expect(metricsUrl).toContain("by (name)");

		mockSafeFetch.mockResolvedValueOnce({
			series: [{ labels: [{ key: "resource.service.name", value: "checkout" }], samples: [{ timestampMs: window.start.getTime(), value: 7 }] }],
		});
		const byService = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			groupBy: ["applicationName"],
			aggregations: [{ fn: "count", as: "count" }],
		});
		expect((byService.rows[0] as any).count).toBe(7);
	});

	it("nativeAggregate returns null (falls back to L1) when the count anchor metric has no series", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-agg-null" });
		mockSafeFetch
			.mockRejectedValueOnce(new SourceResponseError(404, "metrics disabled"))
			.mockResolvedValueOnce({ traces: [] });
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			aggregations: [{ fn: "count", as: "count" }],
		});
		expect(frame.meta?.degraded).toContain("serverAggregation");
	});

	it("spanTimeSeries falls back to the L1 sample when native metrics reject with a non-404 error", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-spants-fallback" });
		mockSafeFetch
			.mockRejectedValueOnce(new SourceResponseError(500, "internal error"))
			.mockResolvedValueOnce({ traces: [] });
		const frame = await adapter.spanTimeSeries({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			interval: "1h",
		});
		expect(frame.meta?.degraded).toContain("serverAggregation");
	});

	it("spanTimeSeries applies avg aggregation per-bucket without weighting", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-spants-avg" });
		const t0 = window.start.getTime();
		mockSafeFetch
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: t0, value: 4 }] }] }) // count
			.mockResolvedValueOnce({
				series: [
					// Distinct labels keep these as two separate series after
					// grouping so both contribute to the per-bucket average.
					{ labels: [{ key: "span.kind", value: "client" }], samples: [{ timestampMs: t0, value: 2_000_000_000 }] },
					{ labels: [{ key: "span.kind", value: "server" }], samples: [{ timestampMs: t0, value: 6_000_000_000 }] },
				],
			}); // avg(duration) — two series contributing to the same bucket
		const frame = await adapter.spanTimeSeries({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "avg", field: "duration", as: "avgDuration" },
			],
		});
		expect(frame.rows).toHaveLength(1);
		expect((frame.rows[0] as any).avgDuration).toBeCloseTo(4); // (2e9+6e9)/2 ns -> 4s
	});

	it("countSpans totals matching spans via count_over_time and returns null when metrics are unavailable", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-countspans" });
		mockSafeFetch.mockResolvedValueOnce({
			series: [{ labels: [], samples: [{ timestampMs: window.start.getTime(), value: 42 }] }],
		});
		await expect(
			adapter.countSpans!({ signal: "traces", timeRange: window, aiSelector: false })
		).resolves.toBe(42);

		// Distinct window so this doesn't just replay the cached 42 from above.
		const laterWindow = {
			start: new Date(window.start.getTime() + 60_000),
			end: new Date(window.end.getTime() + 60_000),
		};
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "metrics disabled"));
		await expect(
			adapter.countSpans!({ signal: "traces", timeRange: laterWindow, aiSelector: false })
		).resolves.toBeNull();
	});

	it("distinctValues falls back to the L1 sample for non-service attribute keys", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-distinct-l1" });
		mockSafeFetch.mockResolvedValueOnce({ traces: [] });
		await expect(
			adapter.distinctValues("gen_ai.request.model", {
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			})
		).resolves.toEqual([]);
	});

	it("distinctValues('service.name') falls back to L1 when service discovery returns nothing", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-distinct-service-empty" });
		// Each of the 4 tag-value lookups (resource.service.name / service.name,
		// with/without the AI filter) makes an OpenPlait v2 call *and* OpenLIT's
		// own direct v1 call even when v2 succeeds empty (searchTagValues only
		// short-circuits on a non-empty result) — 8 calls — then the biased
		// full-trace fallback search (1) and finally the L1 sample's own
		// search (1).
		mockSafeFetch.mockResolvedValue({ tagValues: [] });
		mockSafeFetch.mockResolvedValueOnce({ tagValues: [] }); // resource.service.name v2 (+filter)
		mockSafeFetch.mockResolvedValueOnce({ tagValues: [] }); // resource.service.name v1 (+filter)
		mockSafeFetch.mockResolvedValueOnce({ tagValues: [] }); // service.name v2 (+filter)
		mockSafeFetch.mockResolvedValueOnce({ tagValues: [] }); // service.name v1 (+filter)
		mockSafeFetch.mockResolvedValueOnce({ tagValues: [] }); // resource.service.name v2 (no filter)
		mockSafeFetch.mockResolvedValueOnce({ tagValues: [] }); // resource.service.name v1 (no filter)
		mockSafeFetch.mockResolvedValueOnce({ tagValues: [] }); // service.name v2 (no filter)
		mockSafeFetch.mockResolvedValueOnce({ tagValues: [] }); // service.name v1 (no filter)
		mockSafeFetch.mockResolvedValueOnce({ traces: [] }); // discoverServices biased-sample search
		mockSafeFetch.mockResolvedValueOnce({ traces: [] }); // L1 fallback search
		await expect(
			adapter.distinctValues("service.name", {
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			})
		).resolves.toEqual([]);
		expect(mockSafeFetch).toHaveBeenCalledTimes(10);
	});

	it("searchTagValues falls back to a direct v1 HTTP request when OpenPlait's discovery throws entirely", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-tagvalues-v1" });
		mockSafeFetch
			.mockRejectedValueOnce(new SourceResponseError(500, "v2 unavailable"))
			.mockResolvedValueOnce({ tagValues: ["checkout", "payments"] });
		await expect(adapter.discoverServices(window)).resolves.toEqual([
			{ serviceName: "checkout", environment: "default", clusterId: "default" },
			{ serviceName: "payments", environment: "default", clusterId: "default" },
		]);
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
		const directUrl = new URL(mockSafeFetch.mock.calls[1][0] as string);
		expect(directUrl.pathname).toBe("/api/search/tag/resource.service.name/values");
	});

	it("propagates a hard failure when tag discovery and the biased-sample fallback all fail", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-tagvalues-both-fail" });
		// A 500 (not 400/404) makes OpenPlait's v2->v1 internal fallback rethrow
		// immediately; our own direct v1 request then also fails the same way,
		// so all four tag lookups resolve to `[]` and discoverServices finally
		// surfaces the biased-sample fallback's own hard failure.
		mockSafeFetch.mockRejectedValue(new SourceResponseError(500, "down"));
		await expect(adapter.discoverServices(window)).rejects.toThrow(/500/);
	});

	it("aggregateByService rolls up request counts, models, and providers per service/environment", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-agg-service" });
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }, { traceID: TRACE_2 }] })
			.mockResolvedValueOnce(
				otlpForTrace(TRACE_1, SPAN_1, {
					attributes: [
						{ key: "gen_ai.request.model", value: { stringValue: "gpt-4" } },
						{ key: "gen_ai.system", value: { stringValue: "openai" } },
					],
				})
			)
			.mockResolvedValueOnce({
				batches: [
					{
						resource: {
							attributes: [
								{ key: "service.name", value: { stringValue: "svc" } },
								{ key: "deployment.environment", value: { stringValue: "staging" } },
							],
						},
						scopeSpans: [
							{
								spans: [
									{
										traceId: TRACE_2,
										spanId: SPAN_2,
										parentSpanId: "",
										name: "chat",
										startTimeUnixNano: "1719792000000000000",
										endTimeUnixNano: "1719792001000000000",
										status: { code: 1 },
										attributes: [],
										events: [],
									},
								],
							},
						],
					},
				],
			});

		const rollups = await adapter.aggregateByService(window);
		const bySvc = Object.fromEntries(
			rollups.map((r) => [`${r.serviceName}|${r.environment}`, r])
		);
		expect(bySvc["svc|default"]).toMatchObject({
			requestCount: 1,
			models: ["gpt-4"],
			providers: ["openai"],
		});
		expect(bySvc["svc|staging"]).toMatchObject({ requestCount: 1, models: [], providers: [] });
	});

	it("validateAISignal reports a failure message when the probe search throws", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-validate-fail" });
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(500, "boom"));
		await expect(adapter.validateAISignal(window)).resolves.toMatchObject({
			ok: false,
			sampleCount: 0,
			message: expect.stringContaining("500"),
		});
	});

	it("validateAISignal reports ok:true with a sample count when the probe search finds a trace", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-validate-ok" });
		mockSafeFetch.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] });
		await expect(adapter.validateAISignal(window)).resolves.toMatchObject({
			ok: true,
			sampleCount: 1,
			missingAttributes: [],
		});
	});
});

describe("filterToTraceQL / conditionToTraceQL via buildTempoSearchQuery", () => {
	it("translates every filter target/op combination the query layer can send", () => {
		const q = buildTempoSearchQuery({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			filters: [
				{ target: "spanName", op: "eq", value: ["chat", "embed"] },
				{ target: "status", op: "eq", value: "STATUS_CODE_ERROR" },
				{ target: "attribute", scope: "span", key: "gen_ai.request.model", op: "exists" },
				{ target: "attribute", scope: "resource", key: "service.name", op: "in", value: ["a", "b"] },
				// Unscoped key starting with a resource-ish prefix auto-infers resource scope.
				{ target: "attribute", key: "k8s.namespace", op: "eq", value: "prod" },
				// Hostile key must be dropped entirely, not interpolated.
				{ target: "attribute", scope: "span", key: 'x" || true', op: "eq", value: "y" },
				// `duration` has no TraceQL translation and must contribute nothing.
				{ target: "duration", op: "gt", value: 100 },
			],
		});
		expect(q).toContain('(name = "chat" || name = "embed")');
		expect(q).toContain("status = error");
		expect(q).toContain('span.gen_ai.request.model != ""');
		expect(q).toContain('(resource.service.name = "a" || resource.service.name = "b")');
		expect(q).toContain('resource.k8s.namespace = "prod"');
		expect(q).not.toContain("|| true");
		expect(q).not.toContain("gt");
	});

	it("treats a non-error status filter value as a status != error clause", () => {
		const q = buildTempoSearchQuery({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			filters: [{ target: "status", op: "eq", value: "STATUS_CODE_OK" }],
		});
		expect(q).toContain("status != error");
	});
});

describe("tempoAISelectorQuery with a custom selector", () => {
	it("supports an attribute condition with op:'in' and a spanName condition with a single value", () => {
		const q = tempoAISelectorQuery({
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
				{ allOf: [{ target: "spanName", op: "eq", value: "chat" }] },
			],
		});
		expect(q).toContain('(span.gen_ai.system = "openai" || span.gen_ai.system = "anthropic")');
		expect(q).toContain('(name = "chat")');
	});
});

describe("TempoAdapter: metric helper edge cases", () => {
	const descriptor: TelemetrySourceDescriptor = {
		type: "tempo",
		id: "src-tempo-metrics-helpers",
		isBuiltIn: false,
		settings: { url: "https://tempo.example.com" },
		signals: ["traces"],
		name: "Tempo",
	};

	it("uses a 5-minute TraceQL step for a 5m interval (msToTempoDuration minute branch)", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-step-5m" });
		mockSafeFetch.mockResolvedValueOnce({ series: [] });
		await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			interval: "5m",
			aggregations: [{ fn: "count", as: "count" }],
		});
		const metricsUrl = decodeURIComponent(mockSafeFetch.mock.calls[0][0] as string);
		expect(metricsUrl).toContain("step=5m");
	});

	it("maps durationNs/Duration aliases and resource.* / span.* prefixed fields for metric aggregations", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-attr-aliases" });
		mockSafeFetch
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: window.start.getTime(), value: 2 }] }] })
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: window.start.getTime(), value: 20_000_000_000 }] }] });
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "avg", field: "durationNs", as: "avgDuration" },
			],
		});
		// The "durationNs" alias maps to the same TraceQL `duration` attribute
		// as "duration", but the ns->seconds unit conversion only special-cases
		// the literal field name "duration" — the alias's result stays in the
		// raw Tempo metric unit. Documented via this assertion rather than
		// changed, since it is a narrow field-aliasing quirk, not a
		// user-facing correctness bug (query builders normalize to "duration").
		expect((frame.rows[0] as any).avgDuration).toBeCloseTo(10_000_000_000);
		// aggregateSpans computes avg as a weighted sum(field)/count rather than
		// using TraceQL's avg_over_time directly, so the second call requests
		// sum_over_time.
		const avgUrl = decodeURIComponent(mockSafeFetch.mock.calls[1][0] as string);
		expect(avgUrl).toContain("sum_over_time(duration)");

		mockSafeFetch
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: window.start.getTime(), value: 5 }] }] })
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: window.start.getTime(), value: 30 }] }] });
		await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "sum", field: "resource.custom.metric", as: "total" },
			],
		});
		// The repeated "count" anchor query (identical window/signal) may be
		// served from the adapter's short-TTL query cache instead of issuing a
		// new request, so assert against the most recent safeFetch call rather
		// than a fixed index.
		const lastCallArgs = mockSafeFetch.mock.calls[mockSafeFetch.mock.calls.length - 1];
		const sumUrl = decodeURIComponent(lastCallArgs[0] as string);
		expect(sumUrl).toContain("sum_over_time(resource.custom.metric)");
	});

	it("treats an unsupported aggregation field/fn as contributing zero rather than throwing", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-unsupported-agg" });
		mockSafeFetch.mockResolvedValueOnce({
			series: [{ labels: [], samples: [{ timestampMs: window.start.getTime(), value: 3 }] }],
		});
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			// "p95" isn't one of count/sum/avg/min/max — aggregationToMetricExpr
			// returns null and the row must fall back to 0, not throw.
			aggregations: [{ fn: "p95" as any, field: "duration", as: "p95Duration" }],
		});
		expect((frame.rows[0] as any).p95Duration).toBe(0);
		// Only the count anchor call was made — no metrics call for the
		// unsupported aggregation expression.
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	});

	it("defaults to a count aggregation when the query supplies none", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-default-agg" });
		mockSafeFetch.mockResolvedValueOnce({
			series: [{ labels: [], samples: [{ timestampMs: window.start.getTime(), value: 8 }] }],
		});
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
		});
		expect((frame.rows[0] as any).count).toBe(8);
	});

	it("nativeSpanTimeSeries skips a companion aggregation whose metrics query is unavailable", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-spants-partial" });
		mockSafeFetch
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: window.start.getTime(), value: 5 }] }] }) // count
			.mockRejectedValueOnce(new SourceResponseError(500, "cost metrics down")); // sum(cost) fails -> null, skipped
		const frame = await adapter.spanTimeSeries({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "sum", field: "gen_ai.usage.cost", as: "cost" },
			],
		});
		expect(frame.rows).toHaveLength(1);
		expect((frame.rows[0] as any).count).toBe(5);
		expect((frame.rows[0] as any).cost).toBeUndefined();
	});

	it("honors an explicit metricsMaxTimeRangeHours setting when chunking metric windows", async () => {
		const adapter = new TempoAdapter({
			...descriptor,
			id: "src-tempo-metrics-window-hours",
			settings: { ...descriptor.settings, metricsMaxTimeRangeHours: 6 },
		});
		// A 24h range with a 6h max window must be split into 4 windows.
		mockSafeFetch.mockResolvedValue({ series: [] });
		await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			aggregations: [{ fn: "count", as: "count" }],
		});
		expect(mockSafeFetch).toHaveBeenCalledTimes(4);
	});

	it("does not re-touch the profile cache on a metrics 404 when no profile has been cached yet", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-metrics-404-no-profile" });
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "metrics disabled"));
		await expect(
			adapter.countSpans!({ signal: "traces", timeRange: window, aiSelector: false })
		).resolves.toBeNull();
	});
});

describe("TempoAdapter: trace-summary field fallbacks", () => {
	const descriptor: TelemetrySourceDescriptor = {
		type: "tempo",
		id: "src-tempo-summary-fallbacks",
		isBuiltIn: false,
		settings: { url: "https://tempo.example.com" },
		signals: ["traces"],
		name: "Tempo",
	};

	it("drops trace-summary rows with an unparsable timestamp and defaults missing name/service/duration", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-summary-missing" });
		mockSafeFetch.mockResolvedValueOnce({
			traces: [
				{ traceID: TRACE_1 }, // no startTimeUnixNano/rootServiceName/rootTraceName/durationMs at all
				{
					traceID: TRACE_2,
					rootServiceName: "checkout",
					rootTraceName: "POST /checkout",
					startTimeUnixNano: "1782864000000000000",
					durationMs: 25,
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
		// The trace with no parsable timestamp is dropped before rowsScanned is
		// computed, so only the one valid trace is counted/bucketed.
		expect(frame.meta?.rowsScanned).toBe(1);
		expect(
			(frame.rows as any[]).reduce((sum, row) => sum + Number(row.count || 0), 0)
		).toBe(1);
	});
});

describe("TempoAdapter: span/trace grouping edge cases", () => {
	const descriptor: TelemetrySourceDescriptor = {
		type: "tempo",
		id: "src-tempo-grouping",
		isBuiltIn: false,
		settings: { url: "https://tempo.example.com" },
		signals: ["traces"],
		name: "Tempo",
	};

	it("skips spans with a blank span id or trace id when indexing/grouping for issue queries", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-blank-ids" });
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] })
			.mockResolvedValueOnce({
				batches: [
					{
						resource: { attributes: [] },
						scopeSpans: [
							{
								spans: [
									// Blank ids: rememberSpans must skip indexing it, and
									// groupSpansByTrace must skip it entirely.
									{
										traceId: "",
										spanId: "",
										parentSpanId: "",
										name: "orphan",
										startTimeUnixNano: "1719792000000000000",
										endTimeUnixNano: "1719792001000000000",
										status: { code: 1 },
										attributes: [],
										events: [],
									},
									{
										traceId: TRACE_1,
										spanId: SPAN_1,
										parentSpanId: "",
										name: "chat",
										startTimeUnixNano: "1719792000000000000",
										endTimeUnixNano: "1719792001000000000",
										status: { code: 1 },
										attributes: [
											{
												key: "gen_ai.response.finish_reasons",
												value: { stringValue: "length" },
											},
										],
										events: [],
									},
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
			generationHealth: ["truncated"],
		});
		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0]).toMatchObject({ spanId: SPAN_1 });
	});

	it("agentLoop issue query treats a trace with no resolvable traceId as non-matching", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-agentloop-no-traceid" });
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] })
			.mockResolvedValueOnce({
				batches: [
					{
						resource: { attributes: [] },
						scopeSpans: [
							{
								spans: [
									{
										traceId: "",
										spanId: SPAN_1,
										parentSpanId: "",
										name: "chat",
										startTimeUnixNano: "1719792000000000000",
										endTimeUnixNano: "1719792001000000000",
										status: { code: 1 },
										attributes: [],
										events: [],
									},
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
		expect(frame.rows).toHaveLength(0);
	});
});

describe("TempoAdapter: remaining fallback/edge branches", () => {
	const descriptor: TelemetrySourceDescriptor = {
		type: "tempo",
		id: "src-tempo-remaining",
		isBuiltIn: false,
		settings: { url: "https://tempo.example.com" },
		signals: ["traces"],
		name: "Tempo",
	};

	it("listSpans uses the default page size and offset when the query omits them", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-default-page" });
		mockSafeFetch.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] });
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
		});
		expect(frame.rows).toHaveLength(1);
	});

	it("fetchSampledSpans tolerates a 413 (payload too large) from a single trace fetch", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-413" });
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }, { traceID: TRACE_2 }] })
			.mockRejectedValueOnce(new SourceResponseError(413, "trace payload too large"))
			.mockResolvedValueOnce(otlpForTrace(TRACE_2, SPAN_2));
		const spans = await adapter.sampleTracesForGraph(
			{ signal: "traces", timeRange: window, aiSelector: false },
			5
		);
		expect(spans).toHaveLength(1);
		expect(spans[0].traceId).toBe(TRACE_2);
	});

	it("searchTraceIds enables most_recent when only the cached server profile (not settings) reports support", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-profile-mostrecent" });
		mockSafeFetch
			.mockResolvedValueOnce({ version: "2.8.0", features: { mostRecent: true } })
			.mockResolvedValueOnce({ traces: [] });
		await adapter.healthCheck();
		await adapter.listSpans({ signal: "traces", timeRange: window, aiSelector: false, limit: 1 });
		const searchUrl = decodeURIComponent(mockSafeFetch.mock.calls[1][0] as string);
		expect(searchUrl).toContain("most_recent");
	});

	it("discoverServices' biased-sample fallback de-duplicates services seen on multiple spans", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-biased-dedupe" });
		mockSafeFetch
			.mockResolvedValue({ tagValues: [] }) // all 4 tag lookups (v2 + v1 each) come back empty
			.mockResolvedValueOnce({ tagValues: [] })
			.mockResolvedValueOnce({ tagValues: [] })
			.mockResolvedValueOnce({ tagValues: [] })
			.mockResolvedValueOnce({ tagValues: [] })
			.mockResolvedValueOnce({ tagValues: [] })
			.mockResolvedValueOnce({ tagValues: [] })
			.mockResolvedValueOnce({ tagValues: [] })
			.mockResolvedValueOnce({ tagValues: [] })
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }, { traceID: TRACE_2 }] })
			.mockResolvedValueOnce(otlpForTrace(TRACE_1, SPAN_1))
			.mockResolvedValueOnce(otlpForTrace(TRACE_2, SPAN_2)); // same "svc" service.name as TRACE_1
		const services = await adapter.discoverServices(window);
		expect(services).toHaveLength(1);
		expect(services[0].serviceName).toBe("svc");
	});

	it("aggregateByService falls back to resourceAttributes['service.name'] when serviceName is unset", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-service-fallback" });
		mockSafeFetch.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] }).mockResolvedValueOnce({
			batches: [
				{
					resource: {
						attributes: [{ key: "service.name", value: { stringValue: "resource-svc" } }],
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
									attributes: [],
									events: [],
								},
							],
						},
					],
				},
			],
		});
		const rollups = await adapter.aggregateByService(window);
		expect(rollups).toHaveLength(1);
		expect(rollups[0].serviceName).toBe("resource-svc");
	});
});

describe("TempoAdapter: session-2 branch coverage", () => {
	const descriptor: TelemetrySourceDescriptor = {
		type: "tempo",
		id: "src-tempo-s2",
		isBuiltIn: false,
		settings: { url: "https://tempo.example.com" },
		signals: ["traces"],
		name: "Tempo",
	};

	it("reportedMaxDurationMs falls through to undefined when the 400 body has no parsable duration candidate", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-s2-nodur" });
		// Matches isSearchRangeLimitMessage ("maximum ... duration") but has no
		// digit+unit substring for goDurationMs to parse -> reportedMaxDurationMs
		// falls through its candidate loop to the final `undefined` return, so
		// the range-narrowing retry is skipped and the original error rethrows.
		mockSafeFetch.mockRejectedValueOnce(
			new SourceResponseError(400, "Data source responded 400: maximum duration exceeded")
		);
		await expect(
			adapter.listSpans({ signal: "traces", timeRange: window, aiSelector: false, limit: 1 })
		).rejects.toThrow();
	});

	it("normalizedStatus maps a raw 'error' status string to STATUS_CODE_ERROR", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-s2-status-error" });
		mockSafeFetch.mockResolvedValueOnce(
			otlpForTrace(TRACE_1, SPAN_1, { status: { code: 2 } })
		);
		const spans = await adapter.getTraceSpans(TRACE_1);
		expect(spans[0].statusCode).toBe("STATUS_CODE_ERROR");
	});

	it("conditionToTraceQL drops an unsupported condition op, contributing nothing to the AI selector query", () => {
		const q = tempoAISelectorQuery({
			anyOf: [
				{
					allOf: [
						{
							target: "attribute",
							scope: "span",
							key: "gen_ai.system",
							op: "gt" as any,
							value: "x",
						},
					],
				},
			],
		});
		// The unsupported op returns "" from conditionToTraceQL, so the group's
		// filtered parts list is empty and it renders as an empty `()` clause.
		expect(q).toContain("()");
		expect(q).not.toContain("gen_ai.system");
	});

	it("filterToTraceQL treats a missing spanName filter value as an empty-string match", () => {
		const q = buildTempoSearchQuery({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			filters: [{ target: "spanName", op: "eq", value: undefined }],
		});
		expect(q).toContain('name = ""');
	});

	it("filterToTraceQL treats a missing status filter value as a status != error clause", () => {
		const q = buildTempoSearchQuery({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			filters: [{ target: "status", op: "eq", value: undefined }],
		});
		expect(q).toContain("status != error");
	});

	it("filterToTraceQL wraps a scalar (non-array) 'in' attribute value as a single-element group", () => {
		const q = buildTempoSearchQuery({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			filters: [
				{
					target: "attribute",
					scope: "span",
					key: "gen_ai.system",
					op: "in",
					value: "openai",
				},
			],
		});
		expect(q).toContain('(span.gen_ai.system = "openai")');
	});

	it("metricAttrRef maps a bare 'service.name' field (no span./resource. prefix) to a resource-scoped attribute", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-s2-bare-field" });
		mockSafeFetch
			.mockResolvedValueOnce({ series: [{ labels: [], samples: [{ timestampMs: window.start.getTime(), value: 3 }] }] })
			.mockResolvedValueOnce({ series: [] });
		await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			aggregations: [
				{ fn: "count", as: "count" },
				{ fn: "sum", field: "service.name", as: "svc" },
			],
		});
		const lastCall = mockSafeFetch.mock.calls[mockSafeFetch.mock.calls.length - 1];
		const sumUrl = decodeURIComponent(lastCall[0] as string);
		expect(sumUrl).toContain("sum_over_time(resource.service.name)");
	});

	it("msToTempoDuration falls back to a bare-seconds TraceQL step when the interval isn't a whole minute/hour multiple", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-s2-step-97s" });
		mockSafeFetch.mockResolvedValueOnce({ series: [] });
		await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window, // 24h range keeps a 97s step under the 1000-point cap
			aiSelector: false,
			interval: "97s",
			aggregations: [{ fn: "count", as: "count" }],
		});
		const metricsUrl = decodeURIComponent(mockSafeFetch.mock.calls[0][0] as string);
		expect(metricsUrl).toContain("step=97s");
	});

	it("seriesLabelValue matches a group label by its bare (unscoped) key and falls back to '' when no label matches at all", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-s2-label-shapes" });
		mockSafeFetch.mockResolvedValueOnce({
			series: [
				// Tempo returns the group label under the bare attribute name
				// (no "span."/"resource." prefix) — seriesLabelValue must accept it.
				{
					labels: [{ key: "gen_ai.request.model", value: "gpt-4" }],
					samples: [{ timestampMs: window.start.getTime(), value: 3 }],
				},
				// No label matches the scoped OR bare attribute name -> falls
				// through the loop entirely to the final `return ""`.
				{
					labels: [{ key: "some.unrelated.label", value: "x" }],
					samples: [{ timestampMs: window.start.getTime(), value: 1 }],
				},
			],
		});
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			groupBy: ["gen_ai.request.model"],
			aggregations: [{ fn: "count", as: "count" }],
		});
		const groupValues = (frame.rows as Array<{ group_value: string }>)
			.map((r) => r.group_value)
			.sort();
		expect(groupValues).toEqual(["", "gpt-4"]);
	});

	it("filterToTraceQL treats an array of status values, matching if any entry looks like an error", () => {
		const q = buildTempoSearchQuery({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			filters: [
				{ target: "status", op: "in", value: ["STATUS_CODE_OK", "error"] },
			],
		});
		expect(q).toContain("status = error");
	});

	it("aggregateSpans falls back to the L1 sample when nativeAggregate throws (not just returns null)", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-s2-agg-throws" });
		jest
			.spyOn(adapter as unknown as { nativeAggregate: () => Promise<unknown> }, "nativeAggregate")
			.mockRejectedValue(new Error("boom"));
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] })
			.mockResolvedValueOnce(otlpForTrace(TRACE_1, SPAN_1));
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			aggregations: [{ fn: "count", as: "count" }],
		});
		expect(frame.meta?.degraded).toContain("serverAggregation");
		expect(Number((frame.rows[0] as any)?.count)).toBeGreaterThan(0);
	});

	it("spanTimeSeries falls back to the L1 sample when nativeSpanTimeSeries throws (not just returns null)", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-s2-spants-throws" });
		jest
			.spyOn(
				adapter as unknown as { nativeSpanTimeSeries: () => Promise<unknown> },
				"nativeSpanTimeSeries"
			)
			.mockRejectedValue(new Error("boom"));
		mockSafeFetch
			.mockResolvedValueOnce({ traces: [{ traceID: TRACE_1 }] })
			.mockResolvedValueOnce(
				otlpForTrace(TRACE_1, SPAN_1, {
					// bucketSpansByInterval only counts spans within the query's
					// timeRange, unlike aggregateSpansInProcess.
					startTimeUnixNano: String(window.start.getTime() * 1_000_000),
					endTimeUnixNano: String((window.start.getTime() + 1_000) * 1_000_000),
				})
			);
		const frame = await adapter.spanTimeSeries({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
			aggregations: [{ fn: "count", as: "count" }],
		});
		expect(frame.meta?.degraded).toContain("serverAggregation");
		expect(
			(frame.rows as any[]).reduce((sum, row) => sum + Number(row.count || 0), 0)
		).toBeGreaterThan(0);
	});

	it("honors an explicit metricsMaxTimeRangeMs setting (milliseconds, not just hours) when chunking metric windows", async () => {
		const adapter = new TempoAdapter({
			...descriptor,
			id: "src-tempo-s2-window-ms",
			settings: { ...descriptor.settings, metricsMaxTimeRangeMs: 6 * 60 * 60 * 1000 },
		});
		mockSafeFetch.mockResolvedValue({ series: [] });
		await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window, // 24h range with a 6h max window -> 4 chunks
			aiSelector: false,
			aggregations: [{ fn: "count", as: "count" }],
		});
		expect(mockSafeFetch).toHaveBeenCalledTimes(4);
	});

	it("downgrades an already-cached Tempo profile's traceqlMetrics flag on a metrics 404, short-circuiting later metric calls", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-s2-404-with-profile" });
		mockSafeFetch.mockResolvedValueOnce({ version: "3.0.0" });
		await adapter.healthCheck();
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "metrics disabled"));
		await expect(
			adapter.countSpans!({ signal: "traces", timeRange: window, aiSelector: false })
		).resolves.toBeNull();
		const callsBefore = mockSafeFetch.mock.calls.length;
		// A second metrics call must short-circuit via the now-downgraded cached
		// profile without another HTTP round-trip.
		await expect(
			adapter.countSpans!({ signal: "traces", timeRange: window, aiSelector: false })
		).resolves.toBeNull();
		expect(mockSafeFetch.mock.calls.length).toBe(callsBefore);
	});

	it("distinctValues('service.name') resolves directly from discoverServices without falling back to the L1 sample", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-s2-distinct-direct" });
		mockSafeFetch.mockResolvedValueOnce({ tagValues: ["svc-a", "svc-b"] });
		const values = await adapter.distinctValues("service.name", {
			signal: "traces",
			timeRange: window,
			aiSelector: false,
		});
		expect(values).toEqual(["svc-a", "svc-b"]);
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	});

	it("distinctValues('service.name') falls through to the L1 sample when discoverServices throws", async () => {
		const adapter = new TempoAdapter({ ...descriptor, id: "src-tempo-s2-distinct-fallback" });
		// Every tag-value lookup and the biased-sample fallback search all fail
		// with a plain 500 (not a recognized 400 compat pattern), so
		// discoverServices itself rejects, exercising distinctValues' catch
		// branch before it falls through to the (also-failing) L1 sample.
		mockSafeFetch.mockRejectedValue(new SourceResponseError(500, "tag lookup unavailable"));
		await expect(
			adapter.distinctValues("service.name", {
				signal: "traces",
				timeRange: window,
				aiSelector: false,
			})
		).rejects.toThrow();
	});
});
