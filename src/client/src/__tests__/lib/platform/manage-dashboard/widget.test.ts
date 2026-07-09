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
					config: JSON.stringify({ query: "SELECT 1", sourceId: "src-dd" }),
				},
			],
			err: null,
		});
		mockResolveDescriptor.mockResolvedValue({ type: "datadog", name: "Prod DD" });
		mockSourceSupportsNativeSql.mockReturnValue(false);

		const result = await runWidgetQuery("w1", {
			userQuery: "SELECT count() FROM otel_traces",
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
		mockGetTelemetryAdapter.mockResolvedValue({ spanTimeSeries });

		const result = await runWidgetQuery("w1", {
			filter: { timeLimit: { start: "2026-07-01", end: "2026-07-02" } } as any,
		});

		expect(result).toEqual({ data: [{ bucket: "t0", agg0: 5 }] });
		expect(spanTimeSeries).toHaveBeenCalledTimes(1);
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
});
