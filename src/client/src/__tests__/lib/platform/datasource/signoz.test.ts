/**
 * SigNoz adapter coverage: v5 request building (schemaVersion, requestType,
 * limit cap), the filter-expression compiler (escaping, EXISTS guards for
 * negative operators), raw/scalar/time-series normalization, detail lookups,
 * and health-check auth/version failure modes.
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
		raw: "sig-key",
		credentials: { apiKey: "sig-key" },
	}),
	redactableSecretValues: () => ["sig-key"],
}));

import {
	SignozAdapter,
	signozAdapterFactory,
	__resetSignozForTests,
} from "@/lib/platform/connectors/datasource/signoz/adapter";
import { buildSignozFilterExpression } from "@/lib/platform/connectors/datasource/signoz/selector";
import { SourceResponseError } from "@/lib/platform/connectors/datasource/http/safe-fetch";
import { __clearCache } from "@/lib/platform/connectors/datasource/http/cache";
import type {
	OpenLITQuery,
	TelemetrySourceDescriptor,
} from "@/lib/platform/connectors/datasource/types";

const window = {
	start: new Date("2026-07-01T00:00:00.000Z"),
	end: new Date("2026-07-02T00:00:00.000Z"),
};

function descriptor(overrides: Partial<TelemetrySourceDescriptor> = {}): TelemetrySourceDescriptor {
	return {
		type: "signoz",
		id: "signoz-test",
		isBuiltIn: false,
		settings: {
			url: "http://signoz.local:8080",
			allowHttp: true,
			allowPrivateNetwork: true,
		},
		secretRef: "secret-ref",
		signals: ["traces", "logs"],
		name: "SigNoz",
		...overrides,
	};
}

function rawResponse(rows: Record<string, unknown>[], nextCursor = "") {
	return {
		status: "success",
		data: {
			type: "raw",
			data: {
				results: [
					{
						queryName: "A",
						nextCursor,
						rows: rows.map((data) => ({
							timestamp: "2026-07-01T12:00:00Z",
							data,
						})),
					},
				],
			},
		},
	};
}

function scalarResponse(columns: string[], columnTypes: string[], data: unknown[][]) {
	return {
		status: "success",
		data: {
			type: "scalar",
			data: {
				results: [
					{
						queryName: "A",
						columns: columns.map((name, i) => ({
							name,
							columnType: columnTypes[i],
						})),
						data,
					},
				],
			},
		},
	};
}

function phaseAResponse(traceIds: string[]) {
	return scalarResponse(
		["trace_id", "last_seen"],
		["group", "aggregation"],
		traceIds.map((id) => [id, "2026-07-01T12:00:00Z"])
	);
}

function timeSeriesResponse(series: { labels: Record<string, unknown>; values: { timestamp: number; value: number; partial?: boolean }[] }[]) {
	return {
		status: "success",
		data: {
			type: "time_series",
			data: {
				results: [
					{
						queryName: "A",
						aggregations: [
							{
								index: 0,
								series: series.map((s) => ({
									labels: Object.entries(s.labels).map(([name, value]) => ({
										key: { name },
										value,
									})),
									values: s.values,
								})),
							},
						],
					},
				],
			},
		},
	};
}

const SPAN_ROW = {
	trace_id: "0123456789abcdef0123456789abcdef",
	span_id: "0123456789abcdef",
	parent_span_id: "",
	name: "chat",
	timestamp: "1719792000000000000",
	duration_nano: 1_000_000_000,
	status_code_string: "STATUS_CODE_OK",
	kind_string: "SPAN_KIND_CLIENT",
	has_error: false,
	"service.name": "svc",
	// Real v5 list-response shape: requested span attributes come back as
	// flat row keys (recorded from a live SigNoz v0.141.1 server).
	"gen_ai.request.model": "gpt-4",
	"session.id": "sess-1",
};

// Real v5 full-row shape (no selectFields): nested attribute/resource maps,
// as returned by detail lookups (recorded from a live SigNoz v0.141.1 server).
const SPAN_ROW_FULL = {
	trace_id: "0123456789abcdef0123456789abcdef",
	span_id: "0123456789abcdef",
	parent_span_id: "",
	name: "gen_ai.chat",
	timestamp: "1719792000000000000",
	duration_nano: 1_000_000_000,
	status_code_string: "Ok",
	kind_string: "Server",
	has_error: false,
	attributes: {
		"gen_ai.system": "openai",
		"gen_ai.request.model": "gpt-4",
		"session.id": "sess-1",
	},
	resource: { "service.name": "svc", "deployment.environment": "prod" },
};

beforeEach(() => {
	mockSafeFetch.mockReset();
	__resetSignozForTests();
	__clearCache();
});

describe("filter compiler", () => {
	const base: OpenLITQuery = { signal: "traces", timeRange: window };

	it("emits EXISTS guards for negative operators", () => {
		expect(
			buildSignozFilterExpression({
				...base,
				filters: [
					{ target: "attribute", key: "gen_ai.request.model", op: "neq", value: "gpt-4" },
					{ target: "attribute", key: "env", op: "notIn", value: ["a", "b"] },
				],
			})
		).toBe(
			"gen_ai.request.model EXISTS AND gen_ai.request.model != 'gpt-4' AND env EXISTS AND env NOT IN ('a', 'b')"
		);
	});

	it("escapes quotes, backslashes and control characters", () => {
		expect(
			buildSignozFilterExpression({
				...base,
				filters: [
					{
						target: "spanName",
						op: "eq",
						value: "it's a \\ test\nline",
					},
				],
			})
		).toBe("name = 'it\\'s a \\\\ test line'");
	});

	it("maps status and duration targets to SigNoz fields", () => {
		expect(
			buildSignozFilterExpression({
				...base,
				filters: [
					{ target: "status", op: "eq", value: "error" },
					{ target: "duration", op: "gte", value: 1_000_000_000 },
				],
			})
		).toBe("has_error = true AND duration_nano >= 1000000000");
	});

	it("drops numeric comparisons whose value is not a number", () => {
		expect(
			buildSignozFilterExpression({
				...base,
				filters: [{ target: "duration", op: "gt", value: "abc" }],
			})
		).toBeUndefined();
	});

	it("maps field targets onto vendor identifier columns", () => {
		expect(
			buildSignozFilterExpression({
				...base,
				filters: [{ target: "field", key: "traceId", op: "eq", value: "abc" }],
			})
		).toBe("trace_id = 'abc'");
	});
});

describe("request building", () => {
	it("pins schemaVersion, requestType, header auth and the limit cap", async () => {
		mockSafeFetch.mockResolvedValueOnce(rawResponse([]));
		const adapter = new SignozAdapter(descriptor());
		await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 50_000,
			aiSelector: false,
		});
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toBe("http://signoz.local:8080/api/v5/query_range");
		expect(options.method).toBe("POST");
		expect(options.headers["SIGNOZ-API-KEY"]).toBe("sig-key");
		const body = JSON.parse(options.body);
		expect(body.schemaVersion).toBe("v1");
		expect(body.requestType).toBe("raw");
		expect(body.start).toBe(window.start.getTime());
		expect(body.end).toBe(window.end.getTime());
		const spec = body.compositeQuery.queries[0].spec;
		expect(spec.signal).toBe("traces");
		// The query budget (5000 rows) clamps before the SigNoz server cap.
		expect(spec.limit).toBe(5_000);
		expect(spec.filter.expression).toContain("parent_span_id = ''");
	});
});

describe("normalization", () => {
	it("maps raw trace rows onto normalized spans", async () => {
		mockSafeFetch.mockResolvedValueOnce(rawResponse([SPAN_ROW]));
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
		});
		expect(frame.rows).toHaveLength(1);
		const span = frame.rows[0];
		expect(span.traceId).toBe(SPAN_ROW.trace_id);
		expect(span.spanId).toBe(SPAN_ROW.span_id);
		expect(span.name).toBe("chat");
		expect(span.serviceName).toBe("svc");
		expect(span.timestamp).toBe("2024-07-01T00:00:00.000Z");
		expect(span.durationNs).toBe(1_000_000_000);
		expect(span.spanAttributes["gen_ai.request.model"]).toBe("gpt-4");
		expect(span.spanAttributes["session.id"]).toBe("sess-1");
		expect(span.resourceAttributes["service.name"]).toBe("svc");
	});

	it("maps raw log rows and remembers the stable id for getLog", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			rawResponse([
				{
					id: "log-1",
					timestamp: "1719792000000000000",
					body: "hello",
					severity_text: "INFO",
					severity_number: 9,
					trace_id: SPAN_ROW.trace_id,
					"service.name": "svc",
				},
			])
		);
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.listLogs({
			signal: "logs",
			timeRange: window,
		});
		expect(frame.rows[0].body).toBe("hello");
		expect(frame.rows[0].logAttributes["signoz.log.id"]).toBe("log-1");

		// getLog hits the in-process index without another HTTP call.
		const log = await adapter.getLog("log-1");
		expect(log?.body).toBe("hello");
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	});

	it("getSpan/getTraceSpans query with identifier filters on a fallback window", async () => {
		mockSafeFetch.mockResolvedValue(rawResponse([SPAN_ROW_FULL]));
		const adapter = new SignozAdapter(descriptor());
		const span = await adapter.getSpan(SPAN_ROW.span_id);
		expect(span?.name).toBe("gen_ai.chat");
		expect(span?.spanAttributes["gen_ai.system"]).toBe("openai");
		expect(span?.resourceAttributes["deployment.environment"]).toBe("prod");
		let body = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
		expect(body.compositeQuery.queries[0].spec.filter.expression).toContain(
			"span_id = '0123456789abcdef'"
		);

		const spans = await adapter.getTraceSpans(SPAN_ROW.trace_id);
		expect(spans).toHaveLength(1);
		body = JSON.parse(mockSafeFetch.mock.calls[1][1].body);
		expect(body.compositeQuery.queries[0].spec.filter.expression).toContain(
			"trace_id = '0123456789abcdef0123456789abcdef'"
		);
	});

	it("drops partial time-series points", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			timeSeriesResponse([
				{
					labels: {},
					values: [
						{ timestamp: 1_719_792_000_000, value: 5 },
						{ timestamp: 1_719_792_060_000, value: 7, partial: true },
					],
				},
			])
		);
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.spanTimeSeries({
			signal: "traces",
			timeRange: window,
		});
		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0]).toMatchObject({ value: 5, count: 5 });
		const body = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
		expect(body.requestType).toBe("time_series");
		expect(body.compositeQuery.queries[0].spec.aggregations).toEqual([
			{ expression: "count()", alias: "count" },
		]);
	});

	it("maps scalar group/aggregation columns onto rows", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			scalarResponse(
				["service.name", "span_count"],
				["group", "aggregation"],
				[["svc", 42]]
			)
		);
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			groupBy: ["service.name"],
			aggregations: [{ fn: "count", as: "span_count" }],
		});
		expect(frame.rows).toEqual([{ "service.name": "svc", span_count: 42 }]);
	});

	it("extracts distinct values from the group column", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			scalarResponse(
				["gen_ai.request.model", "count()"],
				["group", "aggregation"],
				[["gpt-4", 10], ["gpt-4o", 5]]
			)
		);
		const adapter = new SignozAdapter(descriptor());
		const values = await adapter.distinctValues("gen_ai.request.model", {
			signal: "traces",
			timeRange: window,
		});
		expect(values).toEqual(["gpt-4", "gpt-4o"]);
	});
});

describe("health", () => {
	it("reports ok with the server version", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ version: "v0.141.1" })
			.mockResolvedValueOnce(rawResponse([]));
		const adapter = new SignozAdapter(descriptor());
		const health = await adapter.healthCheck();
		expect(health.ok).toBe(true);
		expect(health.message).toBe("SigNoz v0.141.1");
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
	});

	it("flags a rejected API key", async () => {
		mockSafeFetch.mockResolvedValueOnce({ version: "v0.141.1" });
		mockSafeFetch.mockRejectedValueOnce(
			new SourceResponseError(401, "Data source responded 401")
		);
		const adapter = new SignozAdapter(descriptor());
		const health = await adapter.healthCheck();
		expect(health.ok).toBe(false);
		expect(health.message).toContain("API key");
	});

	it("flags a pre-v5 server (version OK, query_range 404)", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ version: "v0.60.0" })
			.mockRejectedValueOnce(
				new SourceResponseError(404, "Data source responded 404")
			);
		const adapter = new SignozAdapter(descriptor());
		const health = await adapter.healthCheck();
		expect(health.ok).toBe(false);
		expect(health.message).toContain("v0.92.0");
		expect(health.message).toContain("server root");
	});

	it("hides an <unset> version string", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ version: "<unset>" })
			.mockResolvedValueOnce(rawResponse([]));
		const adapter = new SignozAdapter(descriptor());
		const health = await adapter.healthCheck();
		expect(health.ok).toBe(true);
		expect(health.message).toBeUndefined();
	});
});

describe("trace-level AI selector (two-phase listSpans)", () => {
	it("pushes the selector server-side without the root restriction, then lists roots", async () => {
		// Phase A: a child span (gen_ai attrs under a non-AI root) qualifies.
		mockSafeFetch
			.mockResolvedValueOnce(phaseAResponse([SPAN_ROW.trace_id]))
			.mockResolvedValueOnce(rawResponse([SPAN_ROW]));
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 100,
		});
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
		const phaseA = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
		expect(phaseA.requestType).toBe("scalar");
		expect(phaseA.compositeQuery.queries[0].spec.groupBy).toEqual([
			{ name: "trace_id" },
		]);
		const exprA = phaseA.compositeQuery.queries[0].spec.filter.expression;
		expect(exprA).toContain("gen_ai.operation.name EXISTS");
		expect(exprA).toContain("resource.telemetry.sdk.name = 'openlit'");
		expect(exprA).not.toContain("parent_span_id");
		const phaseB = JSON.parse(mockSafeFetch.mock.calls[1][1].body);
		const exprB = phaseB.compositeQuery.queries[0].spec.filter.expression;
		expect(exprB).toContain(`trace_id IN ('${SPAN_ROW.trace_id}')`);
		expect(exprB).toContain("parent_span_id = ''");
		expect(frame.rows).toHaveLength(1);
		expect(frame.rows[0].spanId).toBe(SPAN_ROW.span_id);
	});

	it("returns an empty frame without a second request when nothing matches", async () => {
		mockSafeFetch.mockResolvedValueOnce(phaseAResponse([]));
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
		});
		expect(frame.rows).toHaveLength(0);
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	});

	it("skips the selector phase entirely when aiSelector is false and no filters", async () => {
		mockSafeFetch.mockResolvedValueOnce(rawResponse([SPAN_ROW]));
		const adapter = new SignozAdapter(descriptor());
		await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
		});
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		const body = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
		expect(body.compositeQuery.queries[0].spec.filter.expression).toBe(
			"parent_span_id = ''"
		);
	});

	it("wraps the whole AI selector so user filters do not bind to the last group", async () => {
		mockSafeFetch
			.mockResolvedValueOnce(phaseAResponse([SPAN_ROW.trace_id]))
			.mockResolvedValueOnce(rawResponse([SPAN_ROW]));
		const adapter = new SignozAdapter(descriptor());
		await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 10,
			filters: [
				{ target: "attribute", key: "http.route", op: "eq", value: "/chat" },
			],
		});
		const phaseA = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
		const exprA = phaseA.compositeQuery.queries[0].spec.filter.expression;
		expect(exprA.startsWith("(")).toBe(true);
		expect(exprA).toContain(") AND http.route = '/chat'");
		expect(exprA.indexOf(" OR ")).toBeLessThan(exprA.indexOf(") AND "));
	});

	it("windows offset pagination in phase A so later pages are not empty", async () => {
		mockSafeFetch
			.mockResolvedValueOnce(phaseAResponse(["t1", "t2", "t3"]))
			.mockResolvedValueOnce(
				rawResponse([
					{ ...SPAN_ROW, span_id: "s2", trace_id: "t2" },
					{ ...SPAN_ROW, span_id: "s3", trace_id: "t3" },
				])
			);
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			limit: 2,
			offset: 1,
		});
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
		const phaseA = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
		expect(phaseA.compositeQuery.queries[0].spec.limit).toBe(3);
		const specB = JSON.parse(mockSafeFetch.mock.calls[1][1].body)
			.compositeQuery.queries[0].spec;
		expect(specB.filter.expression).toContain("trace_id IN ('t2', 't3')");
		expect(specB.offset).toBeUndefined();
		expect(frame.rows).toHaveLength(2);
	});
});

describe("filter hardening", () => {
	const base: OpenLITQuery = { signal: "traces", timeRange: window };

	it("drops hostile attribute keys instead of interpolating them", () => {
		const expression = buildSignozFilterExpression({
			...base,
			filters: [
				{
					target: "attribute",
					key: "x' OR 1=1 --",
					op: "eq",
					value: "v",
				},
			],
		});
		expect(expression).toBeUndefined();
	});

	it("drops hostile groupBy names and aggregation fields from requests", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			scalarResponse(["count"], ["aggregation"], [[5]])
		);
		const adapter = new SignozAdapter(descriptor());
		await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aggregations: [
				{ fn: "sum", field: "duration_nano) OR (1=1", as: "s" },
				{ fn: "avg", field: "duration_nano", as: "avg_d" },
			],
			groupBy: ["service.name", "evil' --"],
		} as OpenLITQuery);
		const body = JSON.parse(mockSafeFetch.mock.calls[0][1].body);
		const spec = body.compositeQuery.queries[0].spec;
		expect(spec.groupBy).toEqual([
			{ name: "service.name", fieldContext: "resource" },
		]);
		expect(spec.aggregations).toEqual([
			{ expression: "avg(duration_nano)", alias: "avg_d" },
		]);
	});

	it("types aggregation columns numeric and group columns string", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			scalarResponse(
				["service.name", "request_count"],
				["group", "aggregation"],
				[["svc", 12]]
			)
		);
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.aggregateSpans({
			signal: "traces",
			timeRange: window,
			aggregations: [{ fn: "count", as: "request_count" }],
			groupBy: ["service.name"],
		} as OpenLITQuery);
		expect(frame.fields).toEqual([
			{ name: "service.name", type: "string" },
			{ name: "request_count", type: "number" },
		]);
		expect(frame.rows).toEqual([{ "service.name": "svc", request_count: 12 }]);
	});
});

describe("status filter operators", () => {
	const base: OpenLITQuery = { signal: "traces", timeRange: window };

	it("maps eq error onto has_error = true", () => {
		expect(
			buildSignozFilterExpression({
				...base,
				filters: [{ target: "status", op: "eq", value: "error" }],
			})
		).toBe("has_error = true");
	});

	it("maps neq error onto has_error = false", () => {
		expect(
			buildSignozFilterExpression({
				...base,
				filters: [{ target: "status", op: "neq", value: "error" }],
			})
		).toBe("has_error = false");
	});

	it("maps neq ok onto has_error = true", () => {
		expect(
			buildSignozFilterExpression({
				...base,
				filters: [{ target: "status", op: "neq", value: "ok" }],
			})
		).toBe("has_error = true");
	});

	it("drops unsupported status operators", () => {
		expect(
			buildSignozFilterExpression({
				...base,
				filters: [{ target: "status", op: "exists", value: "error" }],
			})
		).toBeUndefined();
	});
});

describe("span normalization edge cases", () => {
	it("falls back to the resource map for serviceName", async () => {
		const row = { ...SPAN_ROW };
		delete row["service.name"];
		mockSafeFetch.mockResolvedValueOnce(
			rawResponse([{ ...row, resource: { "service.name": "from-resource" } }])
		);
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
		});
		expect(frame.rows[0].serviceName).toBe("from-resource");
	});

	it("marks spans without a status string as UNSET, not OK", async () => {
		const row = { ...SPAN_ROW };
		delete row.status_code_string;
		mockSafeFetch.mockResolvedValueOnce(rawResponse([row]));
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
		});
		expect(frame.rows[0].statusCode).toBe("UNSET");
	});

	it("drops rows with an unparseable timestamp instead of rendering epoch 0", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			rawResponse([{ ...SPAN_ROW, timestamp: "not-a-time" }])
		);
		const adapter = new SignozAdapter(descriptor());
		const frame = await adapter.listSpans({
			signal: "traces",
			timeRange: window,
			aiSelector: false,
		});
		expect(frame.rows).toHaveLength(0);
	});
});

describe("validateAISignal", () => {
	it("returns ok when AI spans are found through the two-phase probe", async () => {
		mockSafeFetch
			.mockResolvedValueOnce(phaseAResponse([SPAN_ROW.trace_id]))
			.mockResolvedValueOnce(rawResponse([SPAN_ROW]));
		const adapter = new SignozAdapter(descriptor());
		const result = await adapter.validateAISignal(window);
		expect(result.ok).toBe(true);
		expect(result.sampleCount).toBe(1);
	});

	it("reports ok:false when the probe fetch fails", async () => {
		mockSafeFetch.mockRejectedValueOnce(new Error("connection refused"));
		const adapter = new SignozAdapter(descriptor());
		const result = await adapter.validateAISignal(window);
		expect(result.ok).toBe(false);
		expect(result.sampleCount).toBe(0);
		expect(result.message).toContain("connection refused");
	});
});

describe("factory descriptor", () => {
	it("declares traces+logs, api-key auth, and config fields", () => {
		const described = signozAdapterFactory.describe();
		expect(described.type).toBe("signoz");
		expect(described.declaredSignals).toEqual(["traces", "logs"]);
		expect(described.authStyle).toBe("api-key");
		expect(described.capabilities.traceTree).toBe(true);
		expect(described.capabilities.spanEvents).toBe(false);
		const keys = described.configFields.map((field) => field.key);
		expect(keys).toContain("url");
		expect(keys).toContain("apiKey");
	});
});
