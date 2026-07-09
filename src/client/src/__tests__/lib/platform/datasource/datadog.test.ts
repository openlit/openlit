const mockSafeFetch = jest.fn();
const mockResolveSecret = jest.fn();

jest.mock("@/lib/platform/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));
jest.mock("@/lib/platform/datasource/http/secret", () => ({
	resolveSourceSecret: (...args: unknown[]) => mockResolveSecret(...args),
	redactableSecretValues: () => ["secret"],
}));

import { DatadogAdapter } from "@/lib/platform/datasource/datadog/adapter";
import { datadogAISelectorQuery } from "@/lib/platform/datasource/datadog/selector";
import { __clearCache } from "@/lib/platform/datasource/http/cache";
import type { TelemetrySourceDescriptor } from "@/lib/platform/datasource/types";

const descriptor: TelemetrySourceDescriptor = {
	type: "datadog",
	id: "src-dd",
	isBuiltIn: false,
	settings: { site: "datadoghq.eu" },
	secretRef: "vault-1",
	signals: ["traces", "logs", "metrics"],
	name: "DD",
};

const window = {
	start: new Date("2026-07-01T00:00:00.000Z"),
	end: new Date("2026-07-02T00:00:00.000Z"),
};

beforeEach(() => {
	jest.clearAllMocks();
	__clearCache();
	mockResolveSecret.mockResolvedValue({
		raw: "secret",
		credentials: { apiKey: "api-key", appKey: "app-key" },
	});
});

describe("datadogAISelectorQuery", () => {
	const q = datadogAISelectorQuery();
	it("uses tag syntax for resource identity and @ for span attrs", () => {
		expect(q).toContain("telemetry.sdk.name:openlit");
		expect(q).toContain("telemetry.distro.name:openlit-cli");
		expect(q).toContain("@gen_ai.operation.name:*");
	});
	it("maps span names to operation_name group", () => {
		expect(q).toContain("operation_name:(");
		expect(q).toContain("coding_agent.session");
	});
	it("expresses the native Claude Code AND-group", () => {
		expect(q).toContain("(service.name:claude-code AND @session.id:*)");
	});
});

describe("DatadogAdapter", () => {
	const adapter = new DatadogAdapter(descriptor);

	it("reports honest capabilities (no span events, no mutation)", () => {
		expect(adapter.capabilities()).toMatchObject({
			traceTree: true,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
		});
	});

	it("healthCheck validates against the correct site", async () => {
		mockSafeFetch.mockResolvedValue({ valid: true });
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(true);
		expect(mockSafeFetch.mock.calls[0][0]).toBe(
			"https://api.datadoghq.eu/api/v1/validate"
		);
		const opts = mockSafeFetch.mock.calls[0][1] as {
			headers: Record<string, string>;
		};
		expect(opts.headers["DD-API-KEY"]).toBe("api-key");
		expect(opts.headers["DD-APPLICATION-KEY"]).toBe("app-key");
	});

	it("listSpans pushes the selector down and normalizes DD spans", async () => {
		mockSafeFetch.mockResolvedValue({
			data: [
				{
					id: "ev1",
					attributes: {
						trace_id: "t1",
						span_id: "s1",
						parent_id: "p1",
						operation_name: "chat",
						service: "svc",
						start_timestamp: "2026-07-01T10:00:00Z",
						duration: 1000000,
						status: "ok",
						custom: {
							"gen_ai.request.model": "gpt-4",
							"gen_ai.usage.cost": "0.5",
							"telemetry.sdk.name": "openlit",
						},
					},
				},
			],
		});
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 10,
			aiSelector: true,
		});
		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0]).toMatchObject({
			traceId: "t1",
			spanId: "s1",
			parentSpanId: "p1",
			name: "chat",
			serviceName: "svc",
			cost: 0.5,
		});
		// selector pushed into filter.query
		const body = JSON.parse(
			(mockSafeFetch.mock.calls[0][1] as { body: string }).body
		);
		expect(body.data.attributes.filter.query).toContain(
			"telemetry.sdk.name:openlit"
		);
		// identity attr routed to resourceAttributes, model to spanAttributes
		expect(frame.rows[0].resourceAttributes["telemetry.sdk.name"]).toBe("openlit");
		expect(frame.rows[0].spanAttributes["gen_ai.request.model"]).toBe("gpt-4");
	});

	it("aggregateSpans builds compute + group_by against the aggregate endpoint", async () => {
		mockSafeFetch.mockResolvedValue({
			data: { buckets: [{ by: { service: "svc" }, computes: { count: 3 } }] },
		});
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			groupBy: ["service"],
			aggregations: [{ fn: "count", as: "count" }],
		});
		expect(mockSafeFetch.mock.calls[0][0]).toBe(
			"https://api.datadoghq.eu/api/v2/spans/analytics/aggregate"
		);
		expect(frame.rows[0]).toEqual({ service: "svc", count: 3 });
	});

	it("caches identical spans queries (rate-limit protection)", async () => {
		mockSafeFetch.mockResolvedValue({ data: [] });
		const q = {
			signal: "traces" as const,
			timeRange: window,
			limit: 5,
			aiSelector: true,
		};
		await adapter.listSpans(q);
		await adapter.listSpans(q);
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	});

	it("listMetricSeries flattens Datadog pointlists", async () => {
		mockSafeFetch.mockResolvedValue({
			series: [
				{ metric: "gen_ai.tokens", pointlist: [[1719792000000, 10], [1719792060000, 20]] },
			],
		});
		const frame = await adapter.listMetricSeries({
			signal: "metrics",
			timeRange: window,
			filters: [{ target: "spanName", op: "eq", value: "gen_ai.tokens" }],
		});
		expect(frame.rows).toHaveLength(2);
		expect(frame.rows[0]).toMatchObject({ metricName: "gen_ai.tokens", value: 10 });
	});

	it("validateAISignal reports ok when spans are returned", async () => {
		mockSafeFetch.mockResolvedValue({ data: [{ id: "x", attributes: {} }] });
		const result = await adapter.validateAISignal(window);
		expect(result.ok).toBe(true);
		expect(result.sampleCount).toBe(1);
	});
});
