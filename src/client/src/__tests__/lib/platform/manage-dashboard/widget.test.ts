jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));
jest.mock("@/lib/platform/manage-dashboard/table-details", () => ({
	OPENLIT_WIDGET_TABLE_NAME: "openlit_widgets",
	OPENLIT_BOARD_WIDGET_TABLE_NAME: "openlit_board_widgets",
}));
jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: jest.fn(() => ({
		WIDGET_FETCH_FAILED: "Widget fetch failed",
		WIDGET_RUN_FAILED: "Widget run failed",
		WIDGET_STRUCTURED_QUERY_FAILED: "Structured widget query failed.",
		WIDGET_NO_STRUCTURED_QUERY: "No structured query.",
		WIDGET_RAW_SQL_SOURCE_ONLY: (source: string) => `raw-sql-only:${source}`,
	})),
}));
const mockResolveDescriptor = jest.fn();
const mockSourceSupportsNativeSql = jest.fn();
const mockGetTelemetryAdapter = jest.fn();
jest.mock("@/lib/telemetry-source", () => ({
	resolveTelemetrySourceDescriptor: (...a: unknown[]) => mockResolveDescriptor(...a),
	sourceSupportsNativeSql: (...a: unknown[]) => mockSourceSupportsNativeSql(...a),
	getTelemetryAdapter: (...a: unknown[]) => mockGetTelemetryAdapter(...a),
}));
jest.mock("@/utils/sanitizer", () => ({
	__esModule: true,
	default: {
		sanitizeValue: jest.fn((value: string) => value),
	},
}));
jest.mock("@/helpers/server/widget", () => {
	const escapeClickHouseTestString = (value: string) =>
		JSON.stringify(value).slice(1, -1).split("'").join("\\'");

	return {
		normalizeWidgetToClient: jest.fn((widget: any) => ({
			...widget,
			config:
				typeof widget?.config === "string"
					? JSON.parse(widget.config)
					: widget?.config,
		})),
		sanitizeWidget: jest.fn((widget: any) => widget),
		escapeSingleQuotes: jest.fn(escapeClickHouseTestString),
	};
});

import { runWidgetQuery } from "@/lib/platform/manage-dashboard/widget";
import { dataCollector } from "@/lib/platform/common";
import { escapeSingleQuotes } from "@/helpers/server/widget";

beforeEach(() => {
	jest.clearAllMocks();
	(dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
	mockResolveDescriptor.mockResolvedValue({
		type: "clickhouse",
		name: "Built-in",
		isBuiltIn: true,
	});
	mockSourceSupportsNativeSql.mockReturnValue(true);
});

describe("runWidgetQuery", () => {
	it("blocks non-SELECT user queries", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
			err: null,
		});

		const result = await runWidgetQuery("w1", {
			userQuery: "DROP TABLE otel_traces",
			filter: {} as any,
		});

		expect(result).toEqual({ err: "Only SELECT queries are allowed" });
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("blocks dangerous ClickHouse functions in user queries", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
			err: null,
		});

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT * FROM url('https://example.com')",
			filter: {} as any,
		});

		expect(result).toEqual({ err: "Query contains disallowed functions" });
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it('rejects system table names injected through Mustache filter values', async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
			err: null,
		});

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT * FROM {{filter.tbl}}",
			filter: { tbl: "system.users" } as any,
		});

		expect(result).toEqual({ err: "Access to system tables is not allowed" });
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("rejects information_schema table access", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
			err: null,
		});

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT * FROM information_schema.schemata",
			filter: {} as any,
		});

		expect(result).toEqual({
			err: "Access to information_schema tables is not allowed",
		});
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("validates the rendered query after Mustache expansion", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
			err: null,
		});

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT * FROM {{filter.prefix}}{{filter.suffix}}",
			filter: { prefix: "syst", suffix: "em.users" } as any,
		});

		expect(result).toEqual({ err: "Access to system tables is not allowed" });
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("runs allowed SELECT user queries in readonly mode", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
				err: null,
			})
			.mockResolvedValueOnce({ data: [{ count: 1 }], err: null });

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT count() FROM otel_traces",
			filter: {} as any,
		});

		expect(result).toEqual({ data: [{ count: 1 }] });
		expect(dataCollector).toHaveBeenLastCalledWith(
			{ query: "SELECT count() FROM otel_traces", enable_readonly: true },
			"query",
			undefined
		);
	});

	it("allows attribute keys whose names embed blocklisted keywords", async () => {
		// `gen_ai.system` is a data key, not the SYSTEM command. The
		// `system` substring is word-bounded by `.` and `'`, so a naive
		// keyword scan would wrongly reject this safe SELECT.
		const query =
			"SELECT if(notEmpty(SpanAttributes['gen_ai.provider.name']), SpanAttributes['gen_ai.provider.name'], SpanAttributes['gen_ai.system']) AS provider, COUNT(*) AS count FROM otel_traces GROUP BY provider";
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [{ id: "w1", config: JSON.stringify({ query }) }],
				err: null,
			})
			.mockResolvedValueOnce({
				data: [{ provider: "openai", count: 5 }],
				err: null,
			});

		const result = await runWidgetQuery("w1", { filter: {} as any });

		expect(result).toEqual({ data: [{ provider: "openai", count: 5 }] });
		expect(dataCollector).toHaveBeenLastCalledWith({
			query,
			enable_readonly: true,
		});
	});

	it("does not flag blocklisted keywords that appear only inside string literals", async () => {
		const query =
			"SELECT ServiceName FROM otel_traces WHERE ServiceName = 'drop-table-service'";
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [{ id: "w1", config: JSON.stringify({ query }) }],
				err: null,
			})
			.mockResolvedValueOnce({ data: [], err: null });

		const result = await runWidgetQuery("w1", { filter: {} as any });

		expect(result).toEqual({ data: [] });
	});

	it("strips literals with backslash and doubled-quote escapes without ReDoS", async () => {
		// Pathological closed literal that previously triggered CodeQL
		// js/redos on /'(?:\\.|''|[^'])*'/. Must complete in linear time.
		const evilLiteral = "'" + "\\&".repeat(40) + "'";
		const query = `SELECT 1 WHERE x = ${evilLiteral} OR y = 'it''s fine' OR z = 'a\\'b'`;
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
				err: null,
			})
			.mockResolvedValueOnce({ data: [{ ok: 1 }], err: null });

		const started = Date.now();
		const result = await runWidgetQuery("w1", {
			userQuery: query,
			filter: {} as any,
		});
		expect(Date.now() - started).toBeLessThan(500);
		expect(result).toEqual({ data: [{ ok: 1 }] });
	});

	it("still sees keywords when a string literal is left unclosed", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
			err: null,
		});

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT 1 WHERE x = 'unclosed DROP TABLE otel_traces",
			filter: {} as any,
		});

		expect(result).toEqual({ err: "Query contains disallowed operations" });
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("still blocks real SYSTEM commands outside string literals", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
			err: null,
		});

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT 1 FROM otel_traces WHERE x = 'ok'; SYSTEM RELOAD DICTIONARIES",
			filter: {} as any,
		});

		expect(result).toEqual({ err: "Query contains disallowed operations" });
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("interpolates {{filter.*}} placeholders without a template engine", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
				err: null,
			})
			.mockResolvedValueOnce({ data: [{ n: 1 }], err: null });

		const result = await runWidgetQuery("w1", {
			userQuery:
				"SELECT 1 WHERE ts >= '{{filter.timeLimit.start}}' AND env = '{{filter.env}}'",
			filter: {
				timeLimit: { start: "2024-01-01", end: "2024-01-02" },
				env: "prod",
			} as any,
		});

		expect(result).toEqual({ data: [{ n: 1 }] });
		expect(dataCollector).toHaveBeenLastCalledWith({
			query: "SELECT 1 WHERE ts >= '2024-01-01' AND env = 'prod'",
			enable_readonly: true,
		});
	});

	it("ignores non-filter mustache-like tags so they cannot run as code", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [{ id: "w1", config: JSON.stringify({ query: "SELECT 1" }) }],
				err: null,
			})
			.mockResolvedValueOnce({ data: [], err: null });

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT '{{#evil}}{{/evil}}' AS x, '{{filter.ok}}' AS y",
			filter: { ok: "safe" } as any,
		});

		expect(result).toEqual({ data: [] });
		expect(dataCollector).toHaveBeenLastCalledWith({
			query: "SELECT '{{#evil}}{{/evil}}' AS x, 'safe' AS y",
			enable_readonly: true,
		});
	});

	it("mock escapeSingleQuotes escapes backslashes before quotes", () => {
		expect(escapeSingleQuotes("a\\b'c")).toBe("a\\\\b\\'c");
	});
});

describe("runWidgetQuery source routing", () => {
	it("rejects raw SQL on an external source", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [
				{
					id: "w1",
					config: JSON.stringify({
						query: "SELECT name FROM system.tables",
						sourceId: "src-dd",
					}),
				},
			],
			err: null,
		});
		mockResolveDescriptor.mockResolvedValue({ type: "datadog", name: "Prod DD" });
		mockSourceSupportsNativeSql.mockReturnValue(false);

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT name FROM system.tables",
			filter: {} as any,
		});

		expect(result).toEqual({ err: "raw-sql-only:Prod DD" });
		// Only the widget fetch hit ClickHouse; no query execution.
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("executes a structured query against the external adapter", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [
				{
					id: "w1",
					config: JSON.stringify({
						sourceId: "src-tempo",
						structuredQuery: {
							mode: "timeseries",
							query: { signal: "traces" },
						},
					}),
				},
			],
			err: null,
		});
		mockResolveDescriptor.mockResolvedValue({ type: "tempo", name: "Prod Tempo" });
		mockSourceSupportsNativeSql.mockReturnValue(false);
		const spanTimeSeries = jest
			.fn()
			.mockResolvedValue({ fields: [], rows: [{ bucket: "t0", agg0: 5 }] });
		mockGetTelemetryAdapter.mockResolvedValue({
			type: "tempo",
			capabilities: () => ({ serverAggregation: true }),
			spanTimeSeries,
		});

		const result = await runWidgetQuery("w1", {
			filter: { timeLimit: { start: "2026-07-01", end: "2026-07-02" } } as any,
		});

		expect(result).toEqual({ data: [{ bucket: "t0", agg0: 5 }] });
		expect(spanTimeSeries).toHaveBeenCalledTimes(1);
		expect(mockResolveDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({ sourceId: "src-tempo", signal: "traces" })
		);
	});

	it("follows project binding when a signal widget has no sourceId", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [
				{
					id: "w1",
					config: JSON.stringify({
						structuredQuery: {
							mode: "timeseries",
							query: { signal: "traces" },
						},
					}),
				},
			],
			err: null,
		});
		mockResolveDescriptor.mockResolvedValue({ type: "tempo", name: "Prod Tempo" });
		mockSourceSupportsNativeSql.mockReturnValue(false);
		const spanTimeSeries = jest
			.fn()
			.mockResolvedValue({ fields: [], rows: [{ bucket: "t0", agg0: 5 }] });
		mockGetTelemetryAdapter.mockResolvedValue({
			type: "tempo",
			capabilities: () => ({ serverAggregation: true }),
			spanTimeSeries,
		});

		await runWidgetQuery("w1", {
			filter: { timeLimit: { start: "2026-07-01", end: "2026-07-02" } } as any,
		});

		expect(mockResolveDescriptor).toHaveBeenCalledWith(
			expect.objectContaining({ sourceId: null, signal: "traces" })
		);
	});

	it("threads the resolved dbConfigId for a built-in source override", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [
					{
						id: "w1",
						config: JSON.stringify({
							query: "SELECT count() FROM otel_traces",
							sourceId: "src-ch2",
						}),
					},
				],
				err: null,
			})
			.mockResolvedValueOnce({ data: [{ count: 2 }], err: null });
		mockResolveDescriptor.mockResolvedValue({
			type: "clickhouse",
			name: "Other CH",
			dbConfigId: "db-9",
		});
		mockSourceSupportsNativeSql.mockReturnValue(true);

		const result = await runWidgetQuery("w1", { filter: {} as any });

		expect(result).toEqual({ data: [{ count: 2 }] });
		expect(dataCollector).toHaveBeenLastCalledWith(
			{ query: "SELECT count() FROM otel_traces", enable_readonly: true },
			"query",
			"db-9"
		);
	});

	it("bridges legacy otel_traces SQL to the project external traces source", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [
				{
					id: "w1",
					config: JSON.stringify({
						query: `SELECT CAST(countIf(Timestamp >= start_time) AS INTEGER) AS total_request,
							CAST(countIf(Timestamp >= prev_start_time) AS INTEGER) AS total_request_previous
							FROM otel_traces WHERE 1=1`,
					}),
				},
			],
			err: null,
		});
		mockResolveDescriptor.mockResolvedValue({
			type: "tempo",
			name: "Grafana Tempo",
			isBuiltIn: false,
		});
		mockSourceSupportsNativeSql.mockReturnValue(false);
		const aggregateSpans = jest.fn().mockResolvedValue({
			fields: [],
			rows: [{ total_request: 12, count: 12 }],
		});
		mockGetTelemetryAdapter.mockResolvedValue({ aggregateSpans });

		const result = await runWidgetQuery("w1", {
			filter: {
				timeLimit: {
					start: "2026-07-01T00:00:00.000Z",
					end: "2026-07-02T00:00:00.000Z",
				},
				selectedConfig: { serviceNames: ["demo-openai-app"] },
			} as any,
		});

		expect(result.err).toBeUndefined();
		expect(result.data).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					total_request: expect.any(Number),
					total_request_previous: expect.any(Number),
				}),
			])
		);
		// Widget fetch only — no ClickHouse SQL execution for the metric.
		expect(dataCollector).toHaveBeenCalledTimes(1);
		expect(mockGetTelemetryAdapter).toHaveBeenCalled();
	});
});
