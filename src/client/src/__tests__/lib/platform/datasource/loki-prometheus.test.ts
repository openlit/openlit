const mockSafeFetch = jest.fn();
const mockSelfHostedNetworkOptions = jest.fn((..._args: unknown[]) => ({
	allowHttp: true,
	allowPrivateNetwork: true,
}));

jest.mock("@/lib/platform/connectors/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
	SourceResponseError: class SourceResponseError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	},
	selfHostedNetworkOptions: (...args: unknown[]) =>
		mockSelfHostedNetworkOptions(...args),
}));
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn().mockResolvedValue({ raw: "", credentials: {} }),
	redactableSecretValues: () => [],
	httpAuthNeedsVault: (authType: unknown) => {
		const type = String(authType || "none").trim().toLowerCase();
		return type === "basic" || type === "bearer";
	},
}));
jest.mock("@/utils/log", () => ({ consoleLog: jest.fn() }));

const mockResolveDescriptor = jest.fn();
const mockGetAdapter = jest.fn();
jest.mock("@/lib/telemetry-source", () => ({
	resolveTelemetrySourceDescriptor: (...a: unknown[]) =>
		mockResolveDescriptor(...a),
	getTelemetryAdapter: (...a: unknown[]) => mockGetAdapter(...a),
}));

import {
	LokiAdapter,
	__resetLokiLearningForTests,
	parseLokiDurationMs,
	reportedLokiMaxQueryRangeMs,
} from "@/lib/platform/connectors/datasource/grafana/loki";
import { PrometheusAdapter, prometheusSelector } from "@/lib/platform/connectors/datasource/prometheus/adapter";
import type { TelemetrySourceDescriptor } from "@/lib/platform/connectors/datasource/types";
import { UnsupportedCapabilityError } from "@/lib/platform/connectors/datasource/types";
import {
	facadeErrorMessage,
	resolveSignalReadContext,
	rethrowIfSourceFailure,
} from "@/lib/platform/connectors/datasource/facade";
import { SourceResponseError } from "@/lib/platform/connectors/datasource/http/safe-fetch";
import { AdapterError } from "@openplait/adapter-sdk";

const window = {
	start: new Date("2026-08-05T00:00:00Z"),
	end: new Date("2026-08-05T01:00:00Z"),
};

function descriptor(
	type: "loki" | "prometheus",
	url: string,
	settings: Record<string, unknown> = {}
): TelemetrySourceDescriptor {
	return {
		type,
		id: `source-${type}`,
		isBuiltIn: false,
		settings: { url, allowHttp: true, allowPrivateNetwork: true, ...settings },
		signals: [type === "loki" ? "logs" : "metrics"],
		name: type,
	};
}

beforeEach(() => {
	mockSafeFetch.mockReset();
	mockSelfHostedNetworkOptions.mockReset();
	mockSelfHostedNetworkOptions.mockReturnValue({
		allowHttp: true,
		allowPrivateNetwork: true,
	});
	__resetLokiLearningForTests();
});

describe("OpenPlait Loki integration", () => {
	it("uses the selected Loki endpoint and normalizes log streams", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: {
				resultType: "streams",
				result: [
					{
						stream: { service_name: "checkout", trace_id: "trace-1" },
						values: [["1785888000000000000", "failed"]],
					},
				],
			},
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const frame = await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			filters: [
				{ target: "attribute", key: "service.name", op: "eq", value: "checkout" },
			],
			limit: 25,
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.origin).toBe("http://loki:3100");
		expect(url.pathname).toBe("/loki/api/v1/query_range");
		expect(url.searchParams.get("query")).toBe('{service_name="checkout"}');
		expect(frame.rows[0]).toMatchObject({
			body: "failed",
			traceId: "trace-1",
			serviceName: "checkout",
		});
	});

	it("clamps oversized summary ranges before querying Loki", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: { resultType: "matrix", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await adapter.logTimeSeries({
			signal: "logs",
			timeRange: {
				start: new Date("2024-01-01T00:00:00Z"),
				end: new Date("2026-08-07T00:00:00Z"),
			},
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		const startNs = BigInt(url.searchParams.get("start") || "0");
		const endNs = BigInt(url.searchParams.get("end") || "0");
		const rangeMs = Number((endNs - startNs) / BigInt(1_000_000));
		expect(rangeMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1_000);
		expect(url.searchParams.get("query")).toContain("count_over_time");
		expect(url.searchParams.get("query")).not.toContain("[auto]");
		expect(Number(url.searchParams.get("step"))).toBeGreaterThan(0);
	});

	it("learns Loki max query length from 400 bodies and retries", async () => {
		const { SourceResponseError } = jest.requireMock(
			"@/lib/platform/connectors/datasource/http/safe-fetch"
		) as {
			SourceResponseError: new (status: number, message: string) => Error & {
				status: number;
			};
		};
		mockSafeFetch
			.mockRejectedValueOnce(
				new SourceResponseError(
					400,
					"Data source responded 400: the query time range exceeds the limit (query length: 40d, limit: 7d)"
				)
			)
			.mockResolvedValueOnce({
				status: "success",
				data: { resultType: "matrix", result: [] },
			});

		const adapter = new LokiAdapter(
			descriptor("loki", "http://loki:3100", {
				// Force first attempt above the learned 7d ceiling.
				maxTimeRangeMs: 40 * 24 * 60 * 60 * 1_000,
			})
		);
		await adapter.logTimeSeries({
			signal: "logs",
			timeRange: {
				start: new Date("2026-06-01T00:00:00Z"),
				end: new Date("2026-08-07T00:00:00Z"),
			},
		});
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
		const retryUrl = new URL(mockSafeFetch.mock.calls[1][0]);
		const startNs = BigInt(retryUrl.searchParams.get("start") || "0");
		const endNs = BigInt(retryUrl.searchParams.get("end") || "0");
		const rangeMs = Number((endNs - startNs) / BigInt(1_000_000));
		expect(rangeMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1_000);
	});
});

describe("LokiAdapter: session-2 branch coverage", () => {
	it("evicts the oldest indexed log once the process-wide log index is full", async () => {
		const LOG_INDEX_MAX = 5_000;
		const values: [string, string][] = [];
		for (let i = 0; i <= LOG_INDEX_MAX; i++) {
			// Unique nanosecond timestamps -> distinct logStableRowId per row.
			values.push([`${1785888000000000000 + i}`, `line-${i}`]);
		}
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: {
				resultType: "streams",
				result: [{ stream: { service_name: "checkout" }, values }],
			},
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		// `limit` stays within Loki's maxResultRows cap; the mocked response
		// still returns every row regardless of the requested query limit.
		const frame = await adapter.listLogs({ signal: "logs", timeRange: window });
		expect(frame.rows).toHaveLength(LOG_INDEX_MAX + 1);
		const { logStableRowId } = await import(
			"@/lib/platform/connectors/datasource/clickhouse/normalize"
		);
		const oldestId = logStableRowId(frame.rows[0]);
		const newestId = logStableRowId(frame.rows[frame.rows.length - 1]);
		mockSafeFetch.mockClear();
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		// Evicted -> falls through to a live Loki scan (empty result -> null).
		expect(await adapter.getLog(oldestId)).toBeNull();
		expect(mockSafeFetch).toHaveBeenCalled();
		mockSafeFetch.mockClear();
		// The newest row is still warm in the index -> resolved with no HTTP call.
		const recent = await adapter.getLog(newestId);
		expect(recent?.body).toBe(`line-${LOG_INDEX_MAX}`);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	}, 20_000);

	it("builds a `contains` LogQL regex matcher for an attribute filter (escapeRegex)", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			filters: [
				{ target: "attribute", key: "service.name", op: "contains", value: ["check.out"] },
			],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("query")).toBe(
			'{service_name=~".*check\\\\.out.*"}'
		);
	});

	it("labelName sanitizes an unmapped, non-identifier attribute key into a safe LogQL label", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			filters: [{ target: "attribute", key: "http.route", op: "eq", value: "/api" }],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("query")).toBe('{http_route="/api"}');
	});

	it("translates a spanName filter and a body/message attribute filter into LogQL line filters", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			filters: [
				{ target: "spanName", op: "eq", value: ["chat"] },
				{ target: "attribute", key: "message", op: "neq", value: "noisy" },
			],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		const query = url.searchParams.get("query") || "";
		expect(query).toContain('|= "chat"');
		expect(query).toContain('!= "noisy"');
	});

	it("skips a filter with no target/key/value contribution to the LogQL selector", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			filters: [
				{ target: "duration", op: "gt", value: 100 },
				{ target: "attribute", key: "service.name", op: "eq", value: [] },
			],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		// Neither filter contributes a label -> falls back to the default selector.
		expect(url.searchParams.get("query")).toBe('{service_name=~".+"}');
	});

	it("uses a negative (!=) matcher for a single-value neq attribute filter", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			filters: [{ target: "attribute", key: "service.name", op: "neq", value: "checkout" }],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("query")).toBe('{service_name!="checkout"}');
	});

	it("builds a negative (!~) regex-OR label matcher for a multi-value notIn filter", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			filters: [
				{ target: "attribute", key: "service.name", op: "notIn", value: ["a", "b"] },
			],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("query")).toBe('{service_name!~"a|b"}');
	});

	it("builds a multi-value 'in' filter as a LogQL regex-OR label matcher", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			filters: [
				{ target: "attribute", key: "service.name", op: "in", value: ["a", "b"] },
			],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("query")).toBe('{service_name=~"a|b"}');
	});

	it("uses the configured default selector fallback ('{service_name=~\".+\"}') when no filters contribute labels", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await adapter.listLogs({ signal: "logs", timeRange: window });
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("query")).toBe('{service_name=~".+"}');
	});

	it("uses a configured custom defaultSelector when it's a well-formed '{...}' LogQL matcher", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(
			descriptor("loki", "http://loki:3100", { defaultSelector: '{app="checkout"}' })
		);
		await adapter.listLogs({ signal: "logs", timeRange: window });
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("query")).toBe('{app="checkout"}');
	});

	it("requests forward direction when the query sorts by timestamp ascending", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			sort: [{ field: "timestamp", direction: "asc" }],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("direction")).toBe("forward");
	});

	it("defaults to a blank body string for an empty log line", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: {
				resultType: "streams",
				result: [
					{ stream: { service_name: "checkout" }, values: [["1785888000000000000", ""]] },
				],
			},
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const frame = await adapter.listLogs({ signal: "logs", timeRange: window });
		expect(frame.rows[0]).toMatchObject({ body: "" });
	});

	it("getLog returns null immediately for a blank log id without querying Loki", async () => {
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await expect(adapter.getLog("")).resolves.toBeNull();
		await expect(adapter.getLog("   ")).resolves.toBeNull();
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("withRangeRetry's adapterErrorBody returns '' for a non-Error rejection (not AdapterError/SourceResponseError/Error)", async () => {
		// logTimeSeries calls the guarded fetch directly (bypassing OpenPlait's
		// requestJson, which would otherwise wrap any rejection in an
		// AdapterError) — a non-SourceResponseError rejection is rethrown as-is.
		mockSafeFetch.mockRejectedValueOnce("plain rejection reason");
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await expect(
			adapter.logTimeSeries({ signal: "logs", timeRange: window })
		).rejects.toBe("plain rejection reason");
	});

	it("logTimeSeries tolerates a response with no matrix result and a series with no values", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "matrix" }, // no `result` field at all
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const frame = await adapter.logTimeSeries({ signal: "logs", timeRange: window });
		expect(frame.rows).toEqual([]);

		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "matrix", result: [{}] }, // series with no `values` field
		});
		const frame2 = await adapter.logTimeSeries({ signal: "logs", timeRange: window });
		expect(frame2.rows).toEqual([]);
	});

	it("parseLokiDurationMs returns undefined for an unparsable duration string", () => {
		expect(parseLokiDurationMs("not-a-duration")).toBeUndefined();
		expect(parseLokiDurationMs("")).toBeUndefined();
	});

	it("learns Loki max query length from an AdapterError (listLogs path) and retries with the narrowed range", async () => {
		mockSafeFetch
			.mockRejectedValueOnce(
				new SourceResponseError(
					400,
					"Data source responded 400: the query time range exceeds the limit (query length: 40d, limit: 7d)"
				)
			)
			.mockResolvedValueOnce({
				status: "success",
				data: { resultType: "streams", result: [] },
			});
		const adapter = new LokiAdapter(
			descriptor("loki", "http://loki:3100", {
				maxTimeRangeMs: 40 * 24 * 60 * 60 * 1_000,
			})
		);
		const frame = await adapter.listLogs({
			signal: "logs",
			timeRange: {
				start: new Date("2026-06-01T00:00:00Z"),
				end: new Date("2026-08-07T00:00:00Z"),
			},
		});
		expect(frame.rows).toEqual([]);
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
	});

	it("withRangeRetry rethrows a generic error carrying a bare numeric `.status` property (not AdapterError/SourceResponseError)", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "matrix", result: [] },
		});
		const weird = Object.assign(new Error("weird upstream failure"), { status: 400 });
		mockSafeFetch.mockReset();
		mockSafeFetch.mockRejectedValueOnce(weird);
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await expect(
			adapter.logTimeSeries({ signal: "logs", timeRange: window })
		).rejects.toThrow("weird upstream failure");
	});

	it("withRangeRetry rethrows a plain error with no recognizable status when the range/limit can't be learned", async () => {
		mockSafeFetch.mockRejectedValueOnce(new Error("network unreachable"));
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await expect(
			adapter.logTimeSeries({ signal: "logs", timeRange: window })
		).rejects.toThrow("network unreachable");
	});

	it("clampTimeRange leaves an invalid (end before start) range untouched rather than clamping it", async () => {
		mockSafeFetch.mockResolvedValueOnce({ status: "success", data: [] });
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const inverted = {
			start: new Date("2026-08-05T02:00:00Z"),
			end: new Date("2026-08-05T01:00:00Z"),
		};
		await adapter.attributeKeys("logs", inverted);
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("start")).toBe(`${inverted.start.getTime()}000000`);
		expect(url.searchParams.get("end")).toBe(`${inverted.end.getTime()}000000`);
	});

	it("configuredMaxTimeRangeMs / maxQueryRangeMs fall back to the 30d1h default when no setting or learned limit exists", () => {
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		expect(adapter.capabilities().maxTimeRangeMs).toBe(30 * 24 * 60 * 60 * 1_000);
	});

	it("ignores a non-positive/invalid configured maxTimeRangeMs setting", () => {
		const adapter = new LokiAdapter(
			descriptor("loki", "http://loki:3100", { maxTimeRangeMs: -5 })
		);
		expect(adapter.capabilities().maxTimeRangeMs).toBe(30 * 24 * 60 * 60 * 1_000);
	});

	it("advertises the full Loki capabilities object, including maxLookbackMs from settings", () => {
		const adapter = new LokiAdapter(
			descriptor("loki", "http://loki:3100", { maxLookbackMs: 3_600_000 })
		);
		expect(adapter.capabilities()).toMatchObject({
			signals: ["logs"],
			traceTree: false,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
			maxLookbackMs: 3_600_000,
		});
	});

	it("healthCheck succeeds when Loki reports label names", async () => {
		mockSafeFetch.mockResolvedValueOnce({ status: "success", data: ["service_name", "level"] });
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(true);
		expect(typeof result.latencyMs).toBe("number");
	});

	it("healthCheck reports failure with the upstream error message when labelNames fails", async () => {
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(500, "loki unreachable"));
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(false);
		expect(result.message).toContain("500");
	});

	it("getLog uses an explicit opts.timeRange window instead of the default lookback", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const explicitRange = {
			start: new Date("2026-01-01T00:00:00Z"),
			end: new Date("2026-01-02T00:00:00Z"),
		};
		const result = await adapter.getLog("missing-id", { timeRange: explicitRange });
		expect(result).toBeNull();
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("start")).toBe(`${explicitRange.start.getTime()}000000`);
	});

	it("getLog centers the search window around a valid opts.aroundTimestamp", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const around = new Date("2026-05-01T12:00:00Z");
		await adapter.getLog("missing-id", { aroundTimestamp: around });
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		const startMs = Number(url.searchParams.get("start")) / 1_000_000;
		const endMs = Number(url.searchParams.get("end")) / 1_000_000;
		expect(around.getTime() - startMs).toBe(60 * 60 * 1_000);
		expect(endMs - around.getTime()).toBe(60 * 60 * 1_000);
	});

	it("getLog falls back to the default lookback window when opts.aroundTimestamp is unparsable", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: { resultType: "streams", result: [] },
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const result = await adapter.getLog("missing-id", { aroundTimestamp: "not-a-date" });
		expect(result).toBeNull();
		expect(mockSafeFetch).toHaveBeenCalled();
	});

	it("normalizes a log stream that only has a bare 'service' label and no trace/span/level labels", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: {
				resultType: "streams",
				result: [
					{
						stream: { service: "legacy-svc" },
						values: [["1785888000000000000", "plain line"]],
					},
				],
			},
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const frame = await adapter.listLogs({ signal: "logs", timeRange: window });
		expect(frame.rows[0]).toMatchObject({
			body: "plain line",
			serviceName: "legacy-svc",
			traceId: undefined,
			spanId: undefined,
			severityText: undefined,
		});
	});

	it("logTimeSeries skips non-finite sample timestamps and defaults a non-numeric sample value to 0", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: {
				resultType: "matrix",
				result: [
					{
						values: [
							["not-a-number", "3"],
							[String(window.start.getTime() / 1000), "not-a-number"],
						],
					},
				],
			},
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const frame = await adapter.logTimeSeries({ signal: "logs", timeRange: window });
		expect(frame.rows).toHaveLength(1);
		expect((frame.rows[0] as any).count).toBe(0);
	});

	it("logTimeSeries treats a nanosecond-scale sample timestamp as already-in-nanoseconds (not seconds)", async () => {
		const nsTimestamp = window.start.getTime() * 1_000_000; // well above the 10^13 threshold
		mockSafeFetch.mockResolvedValueOnce({
			status: "success",
			data: {
				resultType: "matrix",
				result: [{ values: [[nsTimestamp, "5"]] }],
			},
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const frame = await adapter.logTimeSeries({ signal: "logs", timeRange: window });
		expect(frame.rows[0]).toMatchObject({
			timestamp: new Date(window.start.getTime()).toISOString(),
			count: 5,
		});
	});

	it("attributeKeys returns an empty list for a non-logs signal without fetching", async () => {
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await expect(adapter.attributeKeys("metrics" as any, window)).resolves.toEqual([]);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("ignores a non-array label-values payload instead of throwing", async () => {
		mockSafeFetch.mockResolvedValueOnce({ status: "success", data: "not-an-array" });
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await expect(
			adapter.distinctValues("service.name", { signal: "logs", timeRange: window })
		).resolves.toEqual([]);
	});

	it("baseUrl defaults to an empty string when no url setting is configured", () => {
		const adapter = new LokiAdapter(descriptor("loki", ""));
		expect((adapter as unknown as { baseUrl: string }).baseUrl).toBe("");
	});

	it("baseUrl skips the Docker loopback rewrite when private-network access is disallowed", () => {
		mockSelfHostedNetworkOptions.mockReturnValue({
			allowHttp: true,
			allowPrivateNetwork: false,
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://localhost:3100"));
		expect((adapter as unknown as { baseUrl: string }).baseUrl).toBe(
			"http://localhost:3100"
		);
	});

	it("lokiAdapterFactory.describe() advertises Loki's capabilities and config fields", async () => {
		const { lokiAdapterFactory } = await import(
			"@/lib/platform/connectors/datasource/grafana/loki"
		);
		const info = lokiAdapterFactory.describe();
		expect(info.type).toBe("loki");
		expect(info.declaredSignals).toEqual(["logs"]);
		expect(info.capabilities).toMatchObject({
			serverAggregation: true,
			distinctValues: true,
			rawQuery: false,
		});
		expect(info.configFields.some((f) => f.key === "defaultSelector")).toBe(true);
		expect(info.configFields.some((f) => f.key === "maxTimeRangeMs")).toBe(true);
		expect(info.correlation).toMatchObject({ crossSignal: true });
	});
});

describe("Loki duration parsing", () => {
	it("parses Loki limit durations and error bodies", () => {
		expect(parseLokiDurationMs("30d1h")).toBe(30 * 24 * 60 * 60 * 1_000 + 60 * 60 * 1_000);
		expect(parseLokiDurationMs("7d")).toBe(7 * 24 * 60 * 60 * 1_000);
		expect(
			reportedLokiMaxQueryRangeMs(
				"the query time range exceeds the limit (query length: 22788h3m24s, limit: 30d1h)"
			)
		).toBe(30 * 24 * 60 * 60 * 1_000 + 60 * 60 * 1_000);
	});
});

describe("facadeErrorMessage", () => {
	it("includes Loki upstream bodies for generic HTTP failures", () => {
		const error = new AdapterError("EXECUTION_FAILED", "Loki returned HTTP 400.", {
			details: {
				status: 400,
				body: "the query time range exceeds the limit (query length: 40d, limit: 30d1h)",
			},
		});
		expect(facadeErrorMessage(error)).toContain("limit: 30d1h");
	});

	it("returns the UnsupportedCapabilityError message as-is", () => {
		const error = new UnsupportedCapabilityError("tempo", "spanMutation");
		expect(facadeErrorMessage(error)).toBe(error.message);
	});

	it("returns the AdapterError message unchanged when the message is not an HTTP-status message", () => {
		const error = new AdapterError("EXECUTION_FAILED", "Loki query rejected.", {
			details: { status: 400, body: "the query time range exceeds the limit" },
		});
		expect(facadeErrorMessage(error)).toBe("Loki query rejected.");
	});

	it("returns the AdapterError message unchanged when there is no upstream body", () => {
		const error = new AdapterError("EXECUTION_FAILED", "Tempo returned HTTP 500.", {
			details: { status: 500 },
		});
		expect(facadeErrorMessage(error)).toBe("Tempo returned HTTP 500.");
	});

	it("returns the AdapterError message unchanged when the upstream body is blank", () => {
		const error = new AdapterError("EXECUTION_FAILED", "Tempo returned HTTP 500.", {
			details: { status: 500, body: "   " },
		});
		expect(facadeErrorMessage(error)).toBe("Tempo returned HTTP 500.");
	});

	it("returns a plain Error message", () => {
		expect(facadeErrorMessage(new Error("boom"))).toBe("boom");
	});

	it("returns a raw string error as-is", () => {
		expect(facadeErrorMessage("plain string failure")).toBe("plain string failure");
	});

	it("falls back to the generic widget-run-failed message for non-Error, non-string values", () => {
		expect(facadeErrorMessage({ weird: true })).toMatch(/failed/i);
		expect(facadeErrorMessage(undefined)).toMatch(/failed/i);
	});
});

describe("rethrowIfSourceFailure", () => {
	it("rethrows AdapterError", () => {
		const error = new AdapterError("EXECUTION_FAILED", "down");
		expect(() => rethrowIfSourceFailure(error)).toThrow(AdapterError);
	});

	it("does not rethrow UnsupportedCapabilityError (capability gaps stay soft)", () => {
		expect(() =>
			rethrowIfSourceFailure(new UnsupportedCapabilityError("tempo", "spanMutation"))
		).not.toThrow();
	});

	it("rethrows SourceResponseError", () => {
		expect(() =>
			rethrowIfSourceFailure(new SourceResponseError(503, "unavailable"))
		).toThrow(SourceResponseError);
	});

	it("rethrows connection-like errors", () => {
		expect(() =>
			rethrowIfSourceFailure(new Error("fetch failed"))
		).toThrow("fetch failed");
	});

	it.each([
		"ECONNREFUSED",
		"ENOTFOUND",
		"ETIMEDOUT",
		"ECONNRESET",
		"socket hang up",
		"network error",
		"connection refused",
		"connection timed out",
		"connect reset",
	])("rethrows connection-like error message %p", (message) => {
		expect(() => rethrowIfSourceFailure(new Error(message))).toThrow(message);
	});

	it("does not rethrow unrelated errors", () => {
		expect(() =>
			rethrowIfSourceFailure(new Error("span not found"))
		).not.toThrow();
	});

	it("does not rethrow non-Error values", () => {
		expect(() => rethrowIfSourceFailure("plain string")).not.toThrow();
		expect(() => rethrowIfSourceFailure(undefined)).not.toThrow();
	});
});

describe("resolveSignalReadContext", () => {
	beforeEach(() => {
		mockResolveDescriptor.mockReset();
		mockGetAdapter.mockReset();
	});

	it("marks the context built-in when the descriptor is built-in", async () => {
		const descriptor = { id: "d1", type: "clickhouse", isBuiltIn: true, name: "Built-in" };
		mockResolveDescriptor.mockResolvedValue(descriptor);
		const adapter = { id: "adapter" };
		mockGetAdapter.mockResolvedValue(adapter);

		const ctx = await resolveSignalReadContext("traces", { sourceId: "s1" });

		expect(ctx.adapter).toBe(adapter);
		expect(ctx.descriptor).toBe(descriptor);
		expect(ctx.isBuiltIn).toBe(true);
		expect(mockResolveDescriptor).toHaveBeenCalledWith({
			signal: "traces",
			sourceId: "s1",
		});
		expect(mockGetAdapter).toHaveBeenCalledWith({
			signal: "traces",
			sourceId: "s1",
			descriptor,
		});
	});

	it("marks the context built-in when descriptor.type is clickhouse even if isBuiltIn is false", () => {
		const descriptor = { id: "d2", type: "clickhouse", isBuiltIn: false, name: "CH" };
		mockResolveDescriptor.mockResolvedValue(descriptor);
		mockGetAdapter.mockResolvedValue({});

		return resolveSignalReadContext("logs").then((ctx) => {
			expect(ctx.isBuiltIn).toBe(true);
		});
	});

	it("marks the context as non-built-in for external adapters", async () => {
		const descriptor = { id: "d3", type: "loki", isBuiltIn: false, name: "Loki" };
		mockResolveDescriptor.mockResolvedValue(descriptor);
		mockGetAdapter.mockResolvedValue({});

		const ctx = await resolveSignalReadContext("logs", { environment: "prod" });

		expect(ctx.isBuiltIn).toBe(false);
		expect(ctx.descriptor).toBe(descriptor);
	});
});

describe("Loki discovery", () => {
	it("discovers Loki filter labels with start/end nanoseconds", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: ["openlit-demo", "openplait-integration"],
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const values = await adapter.distinctValues("service.name", {
			signal: "logs",
			timeRange: window,
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.pathname).toBe("/loki/api/v1/label/service_name/values");
		expect(url.searchParams.get("start")).toBe(`${window.start.getTime()}000000`);
		expect(url.searchParams.get("end")).toBe(`${window.end.getTime()}000000`);
		expect(values).toEqual(["openlit-demo", "openplait-integration"]);
	});

	it("discovers Loki attribute keys for custom filters", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: ["service_name", "level", "job"],
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const keys = await adapter.attributeKeys("logs", window);
		expect(keys).toEqual(["service_name", "level", "job"]);
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.pathname).toBe("/loki/api/v1/labels");
		expect(url.searchParams.get("start")).toBeTruthy();
	});

	it("fails loud when Loki label discovery returns an upstream error", async () => {
		const { SourceResponseError } = jest.requireMock(
			"@/lib/platform/connectors/datasource/http/safe-fetch"
		) as { SourceResponseError: new (status: number, message: string) => Error };
		mockSafeFetch.mockRejectedValue(new SourceResponseError(503, "loki down"));
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		await expect(adapter.attributeKeys("logs", window)).rejects.toMatchObject({
			status: 503,
		});
	});

	it("getLog returns a log from the warm cache after listLogs", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: {
				resultType: "streams",
				result: [
					{
						stream: {
							service_name: "checkout",
							level: "error",
							trace_id: "trace-1",
						},
						values: [["1785888000000000000", "payment failed"]],
					},
				],
			},
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const frame = await adapter.listLogs({
			signal: "logs",
			timeRange: window,
			limit: 25,
		});
		const { logStableRowId } = await import(
			"@/lib/platform/connectors/datasource/clickhouse/normalize"
		);
		const rowId = logStableRowId(frame.rows[0]);
		mockSafeFetch.mockClear();
		const detail = await adapter.getLog(rowId);
		expect(detail).toMatchObject({
			body: "payment failed",
			serviceName: "checkout",
			severityText: "error",
			traceId: "trace-1",
		});
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("getLog falls back to a recent Loki scan when the index misses", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: {
				resultType: "streams",
				result: [
					{
						stream: { service_name: "checkout", level: "info" },
						values: [["1785888000000000000", "hello from fallback"]],
					},
				],
			},
		});
		const adapter = new LokiAdapter(descriptor("loki", "http://loki:3100"));
		const { logStableRowId } = await import(
			"@/lib/platform/connectors/datasource/clickhouse/normalize"
		);
		const expectedId = logStableRowId({
			timestamp: new Date(1785888000000).toISOString(),
			traceId: "",
			spanId: "",
			severityText: "info",
			body: "hello from fallback",
		});
		const detail = await adapter.getLog(expectedId);
		expect(detail).toMatchObject({
			body: "hello from fallback",
			serviceName: "checkout",
		});
		expect(mockSafeFetch).toHaveBeenCalled();
	});
});

describe("OpenPlait Prometheus integration", () => {
	it("builds regex matchers for multiple metric names", () => {
		expect(
			prometheusSelector({
				signal: "metrics",
				timeRange: window,
				filters: [
					{
						target: "spanName",
						op: "in",
						value: ["up", "go_goroutines"],
					},
					{
						target: "attribute",
						key: "service.name",
						op: "in",
						value: ["prometheus-local", "api"],
					},
				],
			})
		).toBe(
			'{__name__=~"up|go_goroutines",service_name=~"prometheus-local|api"}'
		);
	});

	it("escapes regex metacharacters in multi-value PromQL matchers", () => {
		expect(
			prometheusSelector({
				signal: "metrics",
				timeRange: window,
				filters: [
					{
						target: "spanName",
						op: "in",
						value: ["http.server.duration", "rpc.client.duration"],
					},
				],
			})
		).toBe(
			// escapeRegex → \. then escape() doubles backslashes for PromQL quotes
			'{__name__=~"http\\\\.server\\\\.duration|rpc\\\\.client\\\\.duration"}'
		);
	});

	it("uses the selected Prometheus endpoint and normalizes metric samples", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: {
				resultType: "matrix",
				result: [
					{
						metric: { __name__: "up", service_name: "checkout" },
						values: [[1785888000, "1"]],
					},
				],
			},
		});
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		const frame = await adapter.metricTimeSeries({
			signal: "metrics",
			timeRange: window,
			filters: [{ target: "spanName", op: "eq", value: "up" }],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.origin).toBe("http://prometheus:9090");
		expect(url.pathname).toBe("/api/v1/query_range");
		expect(url.searchParams.get("query")).toBe('{__name__="up"}');
		expect(frame.rows[0]).toMatchObject({
			metricName: "up",
			value: 1,
			serviceName: "checkout",
		});
	});

	it("discovers Prometheus filter labels within the selected time window", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: ["prometheus-local", "checkout"],
		});
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		const values = await adapter.distinctValues("service.name", {
			signal: "metrics",
			timeRange: window,
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.pathname).toBe("/api/v1/label/service_name/values");
		expect(url.searchParams.get("start")).toBe(String(Math.floor(window.start.getTime() / 1000)));
		expect(url.searchParams.get("end")).toBe(String(Math.ceil(window.end.getTime() / 1000)));
		expect(values).toEqual(["prometheus-local", "checkout"]);
	});

	it("fails loud when Prometheus label discovery returns an upstream error", async () => {
		const { SourceResponseError } = jest.requireMock(
			"@/lib/platform/connectors/datasource/http/safe-fetch"
		) as { SourceResponseError: new (status: number, message: string) => Error };
		mockSafeFetch.mockRejectedValue(new SourceResponseError(502, "prom down"));
		const adapter = new PrometheusAdapter(
			descriptor("prometheus", "http://prometheus:9090")
		);
		await expect(
			adapter.distinctValues("service.name", {
				signal: "metrics",
				timeRange: window,
			})
		).rejects.toMatchObject({ status: 502 });
	});
});

describe("PrometheusAdapter extended coverage", () => {
	it("sanitizes a label key with regex metacharacters into a safe PromQL label name", () => {
		expect(
			prometheusSelector({
				signal: "metrics",
				timeRange: window,
				filters: [
					{ target: "attribute", key: "http.route", op: "eq", value: "/api" },
				],
			})
		).toBe('{__name__=~".+",http_route="/api"}');
	});

	it("builds a `contains` PromQL regex matcher", () => {
		expect(
			prometheusSelector({
				signal: "metrics",
				timeRange: window,
				filters: [
					{ target: "attribute", key: "service.name", op: "contains", value: ["check.out"] },
				],
			})
		).toBe('{__name__=~".+",service_name=~".*check\\\\.out.*"}');
	});

	it("adds a default __name__ matcher when no spanName/metric.name filter is present", () => {
		expect(
			prometheusSelector({
				signal: "metrics",
				timeRange: window,
				filters: [
					{ target: "attribute", key: "service.name", op: "eq", value: "checkout" },
				],
			})
		).toBe('{__name__=~".+",service_name="checkout"}');
	});

	it("healthCheck succeeds when Prometheus reports label names", async () => {
		mockSafeFetch.mockResolvedValue({ status: "success", data: ["__name__", "job"] });
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(true);
		expect(typeof result.latencyMs).toBe("number");
	});

	it("healthCheck fails with the upstream error message", async () => {
		const { SourceResponseError } = jest.requireMock(
			"@/lib/platform/connectors/datasource/http/safe-fetch"
		) as { SourceResponseError: new (status: number, message: string) => Error };
		mockSafeFetch.mockRejectedValue(new SourceResponseError(500, "prometheus unreachable"));
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(false);
		expect(result.message).toBeTruthy();
	});

	it("groups a sum/avg/min/max/count aggregation by the requested labels", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: { resultType: "matrix", result: [] },
		});
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		await adapter.metricTimeSeries({
			signal: "metrics",
			timeRange: window,
			filters: [{ target: "spanName", op: "eq", value: "http_requests_total" }],
			groupBy: ["service.name"],
			aggregations: [{ fn: "sum" }],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("query")).toBe(
			'sum by (service_name) ({__name__="http_requests_total"})'
		);
	});

	it("builds a rate() aggregation over the computed interval", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: { resultType: "matrix", result: [] },
		});
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		await adapter.metricTimeSeries({
			signal: "metrics",
			timeRange: window,
			filters: [{ target: "spanName", op: "eq", value: "http_requests_total" }],
			aggregations: [{ fn: "count", field: "rate" }],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("query")).toContain("sum (rate(");
	});

	it("builds a rate() aggregation grouped by the requested labels", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: { resultType: "matrix", result: [] },
		});
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		await adapter.metricTimeSeries({
			signal: "metrics",
			timeRange: window,
			filters: [{ target: "spanName", op: "eq", value: "http_requests_total" }],
			groupBy: ["service.name"],
			aggregations: [{ fn: "count", field: "rate" }],
		});
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.searchParams.get("query")).toContain("sum by (service_name) (rate(");
	});

	it("returns metric names via the __name__ label values endpoint", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: ["up", "http_requests_total"],
		});
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		const names = await adapter.metricNames(window);
		expect(names).toEqual(["up", "http_requests_total"]);
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.pathname).toBe("/api/v1/label/__name__/values");
	});

	it("attributeKeys returns an empty list for non-metrics signals without fetching", async () => {
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		await expect(adapter.attributeKeys("logs", window)).resolves.toEqual([]);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("attributeKeys discovers all Prometheus label names for the metrics signal", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: ["__name__", "job", "service_name"],
		});
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		const keys = await adapter.attributeKeys("metrics", window);
		expect(keys).toEqual(["__name__", "job", "service_name"]);
		const url = new URL(mockSafeFetch.mock.calls[0][0]);
		expect(url.pathname).toBe("/api/v1/labels");
		expect(url.searchParams.get("start")).toBe(
			String(Math.floor(window.start.getTime() / 1000))
		);
		expect(url.searchParams.get("end")).toBe(String(Math.ceil(window.end.getTime() / 1000)));
	});

	it("fails loud when the Prometheus /labels endpoint returns an upstream error", async () => {
		const { SourceResponseError } = jest.requireMock(
			"@/lib/platform/connectors/datasource/http/safe-fetch"
		) as { SourceResponseError: new (status: number, message: string) => Error };
		mockSafeFetch.mockRejectedValue(new SourceResponseError(504, "prom labels down"));
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		await expect(adapter.attributeKeys("metrics", window)).rejects.toMatchObject({
			status: 504,
		});
	});

	it("ignores non-string entries in a Prometheus label response", async () => {
		mockSafeFetch.mockResolvedValue({ status: "success", data: "not-an-array" });
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		await expect(adapter.attributeKeys("metrics", window)).resolves.toEqual([]);
	});

	it("ignores non-string entries in a Prometheus label VALUES response", async () => {
		mockSafeFetch.mockResolvedValue({ status: "success", data: ["ok", 42, null, "also-ok"] });
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		const values = await adapter.distinctValues("job", { signal: "metrics", timeRange: window });
		expect(values).toEqual(["ok", "also-ok"]);
	});

	it("drops an empty-value filter from the PromQL selector", () => {
		expect(
			prometheusSelector({
				signal: "metrics",
				timeRange: window,
				filters: [{ target: "attribute", key: "service.name", op: "eq", value: [] }],
			})
		).toBe('{__name__=~".+"}');
	});

	it("uses a negative (!=) matcher for a single-value neq filter", () => {
		expect(
			prometheusSelector({
				signal: "metrics",
				timeRange: window,
				filters: [{ target: "attribute", key: "service.name", op: "neq", value: "checkout" }],
			})
		).toBe('{__name__=~".+",service_name!="checkout"}');
	});

	it("forces a single-value notIn filter through the negative regex matcher", () => {
		expect(
			prometheusSelector({
				signal: "metrics",
				timeRange: window,
				filters: [{ target: "attribute", key: "service.name", op: "notIn", value: "checkout" }],
			})
		).toBe('{__name__=~".+",service_name!~"checkout"}');
	});

	it("skips non-attribute filters and attribute filters without a key", () => {
		expect(
			prometheusSelector({
				signal: "metrics",
				timeRange: window,
				filters: [
					{ target: "duration", op: "gt", value: 100 },
					{ target: "attribute", op: "eq", value: "x" },
				],
			})
		).toBe('{__name__=~".+"}');
	});

	it("defaults to an empty filter list when the query has none", () => {
		expect(
			prometheusSelector({ signal: "metrics", timeRange: window })
		).toBe('{__name__=~".+"}');
	});

	it("falls back to the `service` label and the operation name when metric labels are sparse", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "success",
			data: {
				resultType: "matrix",
				result: [{ metric: { service: "checkout-legacy" }, values: [[1785888000, "1"]] }],
			},
		});
		const adapter = new PrometheusAdapter(descriptor("prometheus", "http://prometheus:9090"));
		const frame = await adapter.listMetricSeries({ signal: "metrics", timeRange: window });
		expect(frame.rows[0]).toMatchObject({
			metricName: "metric-list",
			serviceName: "checkout-legacy",
		});
	});

	it("honors configured maxTimeRangeMs/maxLookbackMs in the advertised capabilities", () => {
		const adapter = new PrometheusAdapter(
			descriptor("prometheus", "http://prometheus:9090", {
				maxTimeRangeMs: 3_600_000,
				maxLookbackMs: 7_200_000,
			})
		);
		expect(adapter.capabilities()).toMatchObject({
			maxTimeRangeMs: 3_600_000,
			maxLookbackMs: 7_200_000,
		});
	});
});
