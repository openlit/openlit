jest.mock("@/lib/platform/common", () => ({
	OTEL_LOGS_TABLE_NAME: "otel_logs",
	OTEL_TRACES_TABLE_NAME: "otel_traces",
	OTEL_METRICS_GAUGE_TABLE_NAME: "otel_metrics_gauge",
	OTEL_METRICS_SUM_TABLE_NAME: "otel_metrics_sum",
	OTEL_METRICS_HISTOGRAM_TABLE_NAME: "otel_metrics_histogram",
	OTEL_METRICS_SUMMARY_TABLE_NAME: "otel_metrics_summary",
	OTEL_METRICS_EXPONENTIAL_HISTOGRAM_TABLE_NAME:
		"otel_metrics_exponential_histogram",
	dataCollector: jest.fn(),
}));

jest.mock("@/helpers/server/platform", () => ({
	dateTruncGroupingLogic: jest.fn(() => "hour"),
	getFilterWhereCondition: jest.fn(() => "trace_filter = 1"),
}));

import { dataCollector } from "@/lib/platform/common";
import {
	getLogAttributeKeys,
	getLogByRowId,
	getLogs,
	getLogsConfig,
	getMetricAttributeKeys,
	getMetricDetail,
	getMetrics,
	getMetricsConfig,
	getSignalSummary,
} from "@/lib/platform/observability";

const params = {
	timeLimit: {
		type: "24H",
		start: "2026-05-15T00:00:00.000Z",
		end: "2026-05-16T00:00:00.000Z",
	},
	selectedConfig: {},
};

beforeEach(() => {
	jest.clearAllMocks();
	(dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
});

describe("observability platform queries", () => {
	it("builds logs config with log filters", async () => {
		await getLogsConfig({
			...params,
			selectedConfig: {
				services: ["api"],
				severities: ["ERROR"],
				customFilters: [
					{
						attributeType: "LogAttributes",
						key: "session.id",
						value: "abc'123",
					},
				],
			},
		} as any);

		const query = (dataCollector as jest.Mock).mock.calls[0][0].query;
		expect(query).toContain("FROM otel_logs");
		expect(query).toContain("ServiceName IN ('api')");
		expect(query).toContain("lower(SeverityText) IN ('error')");
		expect(query).toContain("LogAttributes['session.id'] = 'abc\\'123'");
	});

	it("loads log attribute keys from log, resource, and scope maps", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [{ key: "log.key" }], err: null })
			.mockResolvedValueOnce({ data: [{ key: "resource.key" }], err: null })
			.mockResolvedValueOnce({ data: [{ key: "scope.key" }], err: null });

		const result = await getLogAttributeKeys(params as any);

		expect(result.logAttributeKeys).toEqual(["log.key"]);
		expect(result.resourceAttributeKeys).toEqual(["resource.key"]);
		expect(result.scopeAttributeKeys).toEqual(["scope.key"]);
		expect(dataCollector).toHaveBeenCalledTimes(3);
	});

	it("returns paginated logs and count", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [{ total: 12 }], err: null })
			.mockResolvedValueOnce({ data: [{ rowId: "1", Body: "hello" }], err: null });

		const result = await getLogs({
			...params,
			limit: 10,
			offset: 5,
			sorting: { type: "SeverityText", direction: "asc" },
		} as any);

		expect(result.total).toBe(12);
		expect(result.records).toEqual([{ rowId: "1", Body: "hello" }]);
		const query = (dataCollector as jest.Mock).mock.calls[1][0].query;
		expect(query).toContain("ORDER BY SeverityText asc");
		expect(query).toContain("LIMIT 10");
		expect(query).toContain("OFFSET 5");
	});

	it("returns count errors before loading log records", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({ err: "count failed" });

		await expect(getLogs(params as any)).resolves.toEqual({ err: "count failed" });
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("builds signal summaries for traces, logs, and metrics", async () => {
		(dataCollector as jest.Mock).mockResolvedValue({
			data: [{ label: "05/16 01:00", count: 4 }],
			err: null,
		});

		const trace = await getSignalSummary(params as any, "traces");
		const traceQuery = (dataCollector as jest.Mock).mock.calls[0][0].query;
		const logs = await getSignalSummary(params as any, "logs");
		const logsQuery = (dataCollector as jest.Mock).mock.calls[1][0].query;
		const metrics = await getSignalSummary(params as any, "metrics");
		const metricsQuery = (dataCollector as jest.Mock).mock.calls[2][0].query;

		expect(trace.total).toBe(4);
		expect(traceQuery).toContain("FROM otel_traces");
		expect(logsQuery).toContain("FROM otel_logs");
		expect(metricsQuery).toContain("UNION ALL");
		expect(logs.bucket).toBe("hour");
		expect(metrics.peak).toBe(4);
	});

	it("sanitizes log row ids before lookup", async () => {
		await getLogByRowId("abc123 OR 1=1");

		const query = (dataCollector as jest.Mock).mock.calls[0][0].query;
		expect(query).toContain("= 12311");
		expect(query).not.toContain("OR 1=1");
	});

	it("builds metrics config and metric attribute keys across all metric tables", async () => {
		await getMetricsConfig({
			...params,
			selectedConfig: { metricTypes: ["gauge"], services: ["api"] },
		} as any);
		expect((dataCollector as jest.Mock).mock.calls[0][0].query).toContain(
			"otel_metrics_gauge"
		);
		expect((dataCollector as jest.Mock).mock.calls[0][0].query).not.toContain(
			"otel_metrics_sum"
		);

		(dataCollector as jest.Mock).mockClear();
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [{ key: "metric.key" }], err: null })
			.mockResolvedValueOnce({ data: [{ key: "resource.key" }], err: null })
			.mockResolvedValueOnce({ data: [{ key: "scope.key" }], err: null });

		const result = await getMetricAttributeKeys(params as any);

		expect(result.metricAttributeKeys).toEqual(["metric.key"]);
		expect(result.resourceAttributeKeys).toEqual(["resource.key"]);
		expect(result.scopeAttributeKeys).toEqual(["scope.key"]);
	});

	it("returns grouped metric rows with a total", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [{ total: 3 }], err: null })
			.mockResolvedValueOnce({ data: [{ metricName: "cpu", pointCount: 2 }], err: null });

		const result = await getMetrics({
			...params,
			limit: 20,
			offset: 10,
			selectedConfig: { metricTypes: ["sum"] },
		} as any);

		expect(result.total).toBe(3);
		expect(result.records).toEqual([{ metricName: "cpu", pointCount: 2 }]);
		const query = (dataCollector as jest.Mock).mock.calls[1][0].query;
		expect(query).toContain("GROUP BY MetricName, metric_type, ServiceName");
		expect(query).toContain("LIMIT 20");
		expect(query).toContain("OFFSET 10");
	});

	it("returns metric count errors before loading metric rows", async () => {
		(dataCollector as jest.Mock).mockResolvedValueOnce({ err: "metric count failed" });

		await expect(getMetrics(params as any)).resolves.toEqual({
			err: "metric count failed",
		});
		expect(dataCollector).toHaveBeenCalledTimes(1);
	});

	it("loads metric detail series and latest points with scoped filters", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [{ request_time: "2026/05/16 01:00", value: 1 }], err: null })
			.mockResolvedValueOnce({ data: [{ MetricName: "cpu.usage", metric_value: 2 }], err: null });

		const result = await getMetricDetail("cpu.usage", "gauge", "api", params as any);

		expect(result.series).toEqual([{ request_time: "2026/05/16 01:00", value: 1 }]);
		expect(result.points).toEqual([{ MetricName: "cpu.usage", metric_value: 2 }]);
		expect((dataCollector as jest.Mock).mock.calls[0][0].query).toContain(
			"MetricName = 'cpu.usage'"
		);
	});
});
