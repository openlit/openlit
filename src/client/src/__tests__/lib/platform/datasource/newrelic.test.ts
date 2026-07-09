const mockSafeFetch = jest.fn();

jest.mock("@/lib/platform/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));
jest.mock("@/lib/platform/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn().mockResolvedValue({
		raw: "nrak-xxx",
		credentials: { apiKey: "nrak-xxx" },
	}),
	redactableSecretValues: () => ["nrak-xxx"],
}));

import { NewRelicAdapter } from "@/lib/platform/datasource/newrelic/adapter";
import { newrelicAISelectorWhere } from "@/lib/platform/datasource/newrelic/selector";
import { __clearCache } from "@/lib/platform/datasource/http/cache";
import { UnsupportedCapabilityError } from "@/lib/platform/datasource/types";
import type { TelemetrySourceDescriptor } from "@/lib/platform/datasource/types";

const window = {
	start: new Date("2026-07-01T00:00:00.000Z"),
	end: new Date("2026-07-02T00:00:00.000Z"),
};

const descriptor: TelemetrySourceDescriptor = {
	type: "newrelic",
	id: "src-nr",
	isBuiltIn: false,
	settings: { region: "US", accountId: 12345 },
	signals: ["traces", "logs", "metrics"],
	name: "New Relic",
};

function nrqlResult(results: unknown[]) {
	return { data: { actor: { account: { nrql: { results } } } } };
}

beforeEach(() => {
	jest.clearAllMocks();
	__clearCache();
});

describe("newrelicAISelectorWhere", () => {
	const where = newrelicAISelectorWhere();
	it("builds an NRQL OR-of-AND fragment with backtick-quoted dotted keys", () => {
		expect(where).toContain("`telemetry.sdk.name` = 'openlit'");
		expect(where).toContain("`gen_ai.operation.name` IS NOT NULL");
		expect(where).toContain("name IN ('coding_agent.session'");
		expect(where.startsWith("(")).toBe(true);
	});
});

describe("NewRelicAdapter", () => {
	const adapter = new NewRelicAdapter(descriptor);

	it("advertises server aggregation, trace tree, no span events", () => {
		expect(adapter.capabilities()).toMatchObject({
			signals: ["traces", "logs", "metrics"],
			traceTree: true,
			spanEvents: false,
			serverAggregation: true,
		});
	});

	it("posts NerdGraph with account id and pushes the AI selector into WHERE", async () => {
		mockSafeFetch.mockResolvedValue(
			nrqlResult([
				{
					"trace.id": "t1",
					id: "s1",
					"parent.id": "",
					name: "chat",
					timestamp: 1719792000000,
					"duration.ms": 12,
					"otel.status_code": "OK",
					"service.name": "svc",
					"telemetry.sdk.name": "openlit",
					"gen_ai.request.model": "gpt-4",
					"gen_ai.usage.cost": "0.002",
				},
			])
		);
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 10,
			aiSelector: true,
		});
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		const [url, opts] = mockSafeFetch.mock.calls[0] as [
			string,
			{ body: string; headers: Record<string, string> },
		];
		expect(url).toBe("https://api.newrelic.com/graphql");
		expect(opts.headers["API-Key"]).toBe("nrak-xxx");
		const body = JSON.parse(opts.body);
		expect(body.variables.id).toBe(12345);
		expect(body.variables.nrql).toContain("FROM Span");
		expect(body.variables.nrql).toContain("`telemetry.sdk.name` = 'openlit'");
		expect(body.variables.nrql).toContain(`SINCE ${window.start.getTime()}`);

		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0]).toMatchObject({
			traceId: "t1",
			spanId: "s1",
			name: "chat",
			serviceName: "svc",
			statusCode: "OK",
			durationNs: 12_000_000,
			cost: 0.002,
		});
		expect(frame.rows[0].resourceAttributes["telemetry.sdk.name"]).toBe("openlit");
		expect(frame.rows[0].spanAttributes["gen_ai.request.model"]).toBe("gpt-4");
	});

	it("uses EU endpoint when region is EU", async () => {
		const eu = new NewRelicAdapter({
			...descriptor,
			settings: { region: "EU", accountId: 999 },
		});
		mockSafeFetch.mockResolvedValue(nrqlResult([]));
		await eu.listSpans({ signal: "traces", timeRange: window });
		expect(mockSafeFetch.mock.calls[0][0]).toBe("https://api.eu.newrelic.com/graphql");
	});

	it("propagates NerdGraph errors", async () => {
		mockSafeFetch.mockResolvedValue({
			errors: [{ message: "bad nrql" }],
		});
		await expect(
			adapter.listSpans({ signal: "traces", timeRange: window })
		).rejects.toThrow("bad nrql");
	});

	it("aggregateSpans builds FACET with aliased aggregations", async () => {
		mockSafeFetch.mockResolvedValue(
			nrqlResult([{ facet: "svc", count: 5, "service.name": "svc" }])
		);
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: true,
			groupBy: ["service.name"],
			aggregations: [{ fn: "count", as: "count" }],
		});
		const body = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
		expect(body.variables.nrql).toContain("count(*) AS `count`");
		expect(body.variables.nrql).toContain("FACET `service.name` LIMIT MAX");
		expect(frame.rows).toHaveLength(1);
	});

	it("aggregateByService maps facet + uniques into rollups", async () => {
		mockSafeFetch.mockResolvedValue(
			nrqlResult([
				{ facet: ["svc"], c: 7, models: ["gpt-4"], providers: ["openai"] },
			])
		);
		const rollups = await adapter.aggregateByService(window);
		expect(rollups[0]).toMatchObject({
			serviceName: "svc",
			requestCount: 7,
			models: ["gpt-4"],
			providers: ["openai"],
		});
	});

	it("metricNames reads uniques(metricName)", async () => {
		mockSafeFetch.mockResolvedValue(
			nrqlResult([{ names: ["gen_ai.client.token.usage", "llm.latency"] }])
		);
		expect(await adapter.metricNames(window)).toEqual([
			"gen_ai.client.token.usage",
			"llm.latency",
		]);
	});

	it("listMetricSeries requires a metric name filter", async () => {
		await expect(
			adapter.listMetricSeries({ signal: "metrics", timeRange: window })
		).rejects.toBeInstanceOf(UnsupportedCapabilityError);
	});

	it("listMetricSeries builds a TIMESERIES query and flattens points", async () => {
		mockSafeFetch.mockResolvedValue(
			nrqlResult([
				{ beginTimeSeconds: 1719792000, value: 3 },
				{ beginTimeSeconds: 1719792060, value: 8 },
			])
		);
		const frame = await adapter.listMetricSeries({
			signal: "metrics",
			timeRange: window,
			interval: "1 minute",
			filters: [{ target: "spanName", op: "eq", value: "llm.latency" }],
		});
		const body = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
		expect(body.variables.nrql).toContain("average(`llm.latency`)");
		expect(body.variables.nrql).toContain("TIMESERIES 1 minute");
		expect(frame.rows).toHaveLength(2);
		expect(frame.rows[0]).toMatchObject({ metricName: "llm.latency", value: 3 });
	});

	it("throws when accountId is missing", async () => {
		const noAccount = new NewRelicAdapter({
			...descriptor,
			settings: { region: "US" },
		});
		await expect(
			noAccount.listSpans({ signal: "traces", timeRange: window })
		).rejects.toBeInstanceOf(UnsupportedCapabilityError);
	});
});
