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
	selfHostedNetworkOptions: () => ({ allowHttp: true, allowPrivateNetwork: true }),
}));
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn().mockResolvedValue({ raw: "", credentials: {} }),
	redactableSecretValues: () => [],
}));
jest.mock("@/utils/log", () => ({ consoleLog: jest.fn() }));

import {
	LokiAdapter,
	__resetLokiLearningForTests,
	parseLokiDurationMs,
	reportedLokiMaxQueryRangeMs,
} from "@/lib/platform/connectors/datasource/grafana/loki";
import { PrometheusAdapter, prometheusSelector } from "@/lib/platform/connectors/datasource/prometheus/adapter";
import type { TelemetrySourceDescriptor } from "@/lib/platform/connectors/datasource/types";
import { facadeErrorMessage } from "@/lib/platform/connectors/datasource/facade";
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
});

describe("rethrowIfSourceFailure", () => {
	it("rethrows AdapterError", () => {
		const { rethrowIfSourceFailure } = require("@/lib/platform/connectors/datasource/facade");
		const error = new AdapterError("EXECUTION_FAILED", "down");
		expect(() => rethrowIfSourceFailure(error)).toThrow(AdapterError);
	});

	it("rethrows connection-like errors", () => {
		const { rethrowIfSourceFailure } = require("@/lib/platform/connectors/datasource/facade");
		expect(() =>
			rethrowIfSourceFailure(new Error("fetch failed"))
		).toThrow("fetch failed");
	});

	it("does not rethrow unrelated errors", () => {
		const { rethrowIfSourceFailure } = require("@/lib/platform/connectors/datasource/facade");
		expect(() =>
			rethrowIfSourceFailure(new Error("span not found"))
		).not.toThrow();
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
});
