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

const mockCredentials = jest.fn();
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn(async () => ({
		raw: "tok",
		credentials: mockCredentials(),
	})),
	redactableSecretValues: () => ["tok"],
}));

import {
	OtlpHttpAdapter,
	otlpHttpAdapterFactory,
} from "@/lib/platform/connectors/datasource/otlp-http/adapter";
import { SourceResponseError } from "@/lib/platform/connectors/datasource/http/safe-fetch";
import type { TelemetrySourceDescriptor } from "@/lib/platform/connectors/datasource/types";

const window = {
	start: new Date("2026-07-01T00:00:00.000Z"),
	end: new Date("2026-07-02T00:00:00.000Z"),
};

function descriptor(settings: Record<string, unknown> = {}): TelemetrySourceDescriptor {
	return {
		type: "otlp-http",
		id: "src-1",
		isBuiltIn: false,
		settings: { url: "https://collector.example.com", ...settings },
		secretRef: "sec-1",
		signals: ["traces"],
		name: "OTLP HTTP",
	};
}

function otlpSpan(traceId: string, spanId: string, parentSpanId = "") {
	return {
		traceId,
		spanId,
		parentSpanId,
		name: `op-${spanId}`,
		startTimeUnixNano: "1782864000000000000",
		endTimeUnixNano: "1782864001000000000",
		status: { code: 1 },
		attributes: [] as Array<{ key: string; value: { stringValue: string } }>,
	};
}

function otlpPayload(traces: Array<[string, string[]]>) {
	return {
		resourceSpans: [
			{
				resource: { attributes: [{ key: "service.name", value: { stringValue: "svc" } }] },
				scopeSpans: [
					{
						spans: traces.flatMap(([traceId, spanIds]) =>
							spanIds.map((spanId, i) => otlpSpan(traceId, spanId, i === 0 ? "" : spanIds[0]))
						),
					},
				],
			},
		],
	};
}

beforeEach(() => {
	jest.clearAllMocks();
	mockCredentials.mockReturnValue({ token: "tok" });
});

describe("capabilities", () => {
	it("reports traces only by default", () => {
		const caps = new OtlpHttpAdapter(descriptor()).capabilities();
		expect(caps.signals).toEqual(["traces"]);
		expect(caps.traceTree).toBe(true);
		expect(caps.serverAggregation).toBe(false);
	});

	it("reports no signals when traces are toggled off", () => {
		const caps = new OtlpHttpAdapter(descriptor({ tracesEnabled: false })).capabilities();
		expect(caps.signals).toEqual([]);
		expect(caps.traceTree).toBe(false);
	});
});

describe("healthCheck", () => {
	it("passes on 2xx", async () => {
		mockSafeFetch.mockResolvedValueOnce({});
		const result = await new OtlpHttpAdapter(descriptor()).healthCheck();
		expect(result.ok).toBe(true);
		expect(mockSafeFetch.mock.calls[0][0]).toBe("https://collector.example.com/");
	});

	it("treats 405 as reachable", async () => {
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(405, "method not allowed"));
		const result = await new OtlpHttpAdapter(descriptor()).healthCheck();
		expect(result.ok).toBe(true);
		expect(result.message).toMatch(/405/);
	});

	it("flags 401 as an auth problem", async () => {
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(401, "unauthorized"));
		const result = await new OtlpHttpAdapter(descriptor()).healthCheck();
		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/Authentication failed/);
	});

	it("flags 404 as a path problem and honors a custom health path", async () => {
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "not found"));
		const result = await new OtlpHttpAdapter(descriptor({ healthPath: "/healthz" })).healthCheck();
		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/404/);
		expect(mockSafeFetch.mock.calls[0][0]).toBe("https://collector.example.com/healthz");
	});
});

describe("traces", () => {
	it("listSpans groups spans into trace rows with a root and summary", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			otlpPayload([
				["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["01", "02"]],
				["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ["03"]],
			])
		);
		const adapter = new OtlpHttpAdapter(descriptor());
		const frame = await adapter.listSpans({ signal: "traces", timeRange: window, limit: 25, aiSelector: false });
		expect(frame.rows).toHaveLength(2);
		expect(frame.rows.map((row) => row.name)).toEqual(["op-01", "op-03"]);
		expect(frame.rows[0].parentSpanId).toBe("");
		expect(frame.rows[0].traceSummary).toMatchObject({ spanCount: 2, errorCount: 0 });
		expect(frame.rows[1].traceSummary).toMatchObject({ spanCount: 1, errorCount: 0 });
		const url = String(mockSafeFetch.mock.calls[0][0]);
		expect(url).toContain("/v1/traces?");
		expect(url).toContain("start=2026-07-01");
		expect(url).toContain("limit=25");
	});

	it("getTraceSpans normalizes OTLP JSON and feeds the span index", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			otlpPayload([["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["0a", "0b"]]])
		);
		const adapter = new OtlpHttpAdapter(descriptor());
		const spans = await adapter.getTraceSpans("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
		expect(spans).toHaveLength(2);
		expect(spans[0].serviceName).toBe("svc");
		const found = await adapter.getSpan(spans[0].spanId);
		expect(found?.spanId).toBe(spans[0].spanId);
		expect(await adapter.getSpan("missing")).toBeNull();
	});

	it("rejects spans from a different trace id", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			otlpPayload([["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ["0a"]]])
		);
		const adapter = new OtlpHttpAdapter(descriptor());
		const spans = await adapter.getTraceSpans("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
		expect(spans).toHaveLength(0);
	});

	it("counts truncation in trace groups, not raw spans", async () => {
		// 2 traces x 5 spans with limit=2: 10 spans >= limit but only 2 groups.
		mockSafeFetch.mockResolvedValueOnce(
			otlpPayload([
				["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["01", "02", "03", "04", "05"]],
				["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ["06", "07", "08", "09", "10"]],
			])
		);
		const frame = await new OtlpHttpAdapter(descriptor()).listSpans({
			signal: "traces", timeRange: window, limit: 2, aiSelector: false,
		});
		expect(frame.rows).toHaveLength(2);
		expect(frame.meta?.truncated).toBe(false);
	});

	it("slices rows to the limit and flags truncation when groups exceed it", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			otlpPayload([
				["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["01"]],
				["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ["02"]],
				["cccccccccccccccccccccccccccccccc", ["03"]],
			])
		);
		const frame = await new OtlpHttpAdapter(descriptor()).listSpans({
			signal: "traces", timeRange: window, limit: 2, aiSelector: false,
		});
		expect(frame.rows).toHaveLength(2);
		expect(frame.meta?.truncated).toBe(true);
	});

	it("clamps limit into 1..200 and offset to >= 0", async () => {
		mockSafeFetch.mockResolvedValueOnce(otlpPayload([["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["01"]]]));
		await new OtlpHttpAdapter(descriptor()).listSpans({
			signal: "traces", timeRange: window, limit: -5, offset: -3, aiSelector: false,
		});
		let url = String(mockSafeFetch.mock.calls[0][0]);
		expect(url).toContain("limit=1");
		expect(url).toContain("offset=0");

		mockSafeFetch.mockResolvedValueOnce(otlpPayload([["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["01"]]]));
		await new OtlpHttpAdapter(descriptor()).listSpans({
			signal: "traces", timeRange: window, limit: 5000, aiSelector: false,
		});
		url = String(mockSafeFetch.mock.calls[1][0]);
		expect(url).toContain("limit=200");
	});

	it("drops spans with an empty trace id", async () => {
		const payload = otlpPayload([["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["01"]]]);
		payload.resourceSpans[0].scopeSpans[0].spans.push({
			...otlpSpan("", "99"),
		});
		mockSafeFetch.mockResolvedValueOnce(payload);
		const adapter = new OtlpHttpAdapter(descriptor());
		const frame = await adapter.listSpans({ signal: "traces", timeRange: window, limit: 25, aiSelector: false });
		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0].traceSummary?.spanCount).toBe(1);
		expect(await adapter.getSpan("99")).toBeNull();
	});

	it("applies user filters in-process at trace granularity", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			otlpPayload([
				["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["01", "02"]],
				["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ["03"]],
			])
		);
		const frame = await new OtlpHttpAdapter(descriptor()).listSpans({
			signal: "traces", timeRange: window, limit: 25, aiSelector: false,
			filters: [{ target: "spanName", op: "in", value: ["op-02"] }],
		});
		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0].traceId).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
	});

	it("applies the AI selector by default and keeps everything when disabled", async () => {
		const aiPayload = otlpPayload([
			["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["01"]],
			["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ["02"]],
		]);
		aiPayload.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({
			key: "gen_ai.request.model",
			value: { stringValue: "gpt-4" },
		});
		mockSafeFetch.mockResolvedValueOnce(aiPayload);
		const adapter = new OtlpHttpAdapter(descriptor());
		const aiOnly = await adapter.listSpans({ signal: "traces", timeRange: window, limit: 25 });
		expect(aiOnly.rows.map((r) => r.traceId)).toEqual(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);

		mockSafeFetch.mockResolvedValueOnce(aiPayload);
		const everything = await adapter.listSpans({ signal: "traces", timeRange: window, limit: 25, aiSelector: false });
		expect(everything.rows).toHaveLength(2);
	});

	it("keeps the span index isolated per source", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			otlpPayload([["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["0a"]]])
		);
		const adapterA = new OtlpHttpAdapter(descriptor());
		const spans = await adapterA.getTraceSpans("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
		const adapterB = new OtlpHttpAdapter({ ...descriptor(), id: "src-2" });
		expect(await adapterB.getSpan(spans[0].spanId)).toBeNull();
		expect(await adapterA.getSpan(spans[0].spanId)).not.toBeNull();
	});

	it("honors a base URL path prefix and a custom traces path", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			otlpPayload([["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["01"]]])
		);
		await new OtlpHttpAdapter(
			descriptor({ url: "https://collector.example.com/otel", tracesPath: "/api/traces" })
		).listSpans({ signal: "traces", timeRange: window, limit: 25, aiSelector: false });
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain(
			"https://collector.example.com/otel/api/traces?"
		);
	});

	it("accepts array and { traces: [] } payloads", async () => {
		const single = otlpPayload([["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["01"]]]);
		mockSafeFetch.mockResolvedValueOnce([single]);
		const fromArray = await new OtlpHttpAdapter(descriptor()).listSpans({
			signal: "traces", timeRange: window, limit: 25, aiSelector: false,
		});
		expect(fromArray.rows).toHaveLength(1);

		mockSafeFetch.mockResolvedValueOnce({ traces: [single] });
		const fromWrapper = await new OtlpHttpAdapter(descriptor()).listSpans({
			signal: "traces", timeRange: window, limit: 25, aiSelector: false,
		});
		expect(fromWrapper.rows).toHaveLength(1);

		mockSafeFetch.mockResolvedValueOnce({ traces: [] });
		const empty = await new OtlpHttpAdapter(descriptor()).listSpans({
			signal: "traces", timeRange: window, limit: 25, aiSelector: false,
		});
		expect(empty.rows).toHaveLength(0);
	});

	it("throws a clear error when a 200 body is not OTLP JSON", async () => {
		mockSafeFetch.mockResolvedValueOnce({ hello: "world" });
		await expect(
			new OtlpHttpAdapter(descriptor()).listSpans({
				signal: "traces", timeRange: window, limit: 25, aiSelector: false,
			})
		).rejects.toThrow(/did not return OTLP JSON/);
	});

	it("rejects a tracesPath containing a query string", async () => {
		await expect(
			new OtlpHttpAdapter(descriptor({ tracesPath: "/v1/traces?debug=1" })).listSpans({
				signal: "traces", timeRange: window, limit: 25, aiSelector: false,
			})
		).rejects.toThrow(/without a query string/);
	});
});

describe("auth", () => {
	it("sends the API key under the configured header", async () => {
		mockCredentials.mockReturnValue({ apiKey: "secret-key" });
		mockSafeFetch.mockResolvedValueOnce({});
		await new OtlpHttpAdapter(descriptor({ apiKeyHeader: "X-Custom-Key" })).healthCheck();
		const init = mockSafeFetch.mock.calls[0][1] as { headers: Record<string, string> };
		expect(init.headers["X-Custom-Key"]).toBe("secret-key");
	});

	it("defaults the API key header to X-API-Key", async () => {
		mockCredentials.mockReturnValue({ apiKey: "secret-key" });
		mockSafeFetch.mockResolvedValueOnce({});
		await new OtlpHttpAdapter(descriptor()).healthCheck();
		const init = mockSafeFetch.mock.calls[0][1] as { headers: Record<string, string> };
		expect(init.headers["X-API-Key"]).toBe("secret-key");
	});
});

describe("unsupported capabilities", () => {
	it("logs reads throw UnsupportedCapabilityError", async () => {
		await expect(
			new OtlpHttpAdapter(descriptor()).listLogs({ signal: "logs", timeRange: window })
		).rejects.toThrow(/not supported/);
	});
});

describe("describe()", () => {
	it("is descriptor-only and declares the OTLP-specific fields", () => {
		const d = otlpHttpAdapterFactory.describe();
		expect(d.type).toBe("otlp-http");
		expect(d.declaredSignals).toEqual(["traces"]);
		const keys = d.configFields.map((f) => f.key);
		for (const key of ["url", "authType", "tracesEnabled", "tracesPath", "healthPath", "apiKey", "apiKeyHeader"]) {
			expect(keys).toContain(key);
		}
		expect(keys).not.toContain("logsEnabled");
		expect(keys).not.toContain("metricsEnabled");
		expect(d.correlation.crossSignal).toBe(false);
		expect(d.capabilities.spanEvents).toBe(true);
	});
});
