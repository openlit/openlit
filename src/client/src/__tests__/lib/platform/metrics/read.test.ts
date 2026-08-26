const mockGetMetrics = jest.fn();
const mockGetMetricsConfig = jest.fn();
const mockGetMetricAttributeKeys = jest.fn();
const mockGetMetricDetail = jest.fn();
const mockGetSignalSummary = jest.fn();
const mockResolveCtx = jest.fn();

jest.mock("@/lib/platform/observability", () => ({
	getMetrics: (...a: unknown[]) => mockGetMetrics(...a),
	getMetricsConfig: (...a: unknown[]) => mockGetMetricsConfig(...a),
	getMetricAttributeKeys: (...a: unknown[]) => mockGetMetricAttributeKeys(...a),
	getMetricDetail: (...a: unknown[]) => mockGetMetricDetail(...a),
	getSignalSummary: (...a: unknown[]) => mockGetSignalSummary(...a),
	getSummaryBucket: () => "hour",
}));

jest.mock("@/lib/platform/connectors/datasource/facade", () => ({
	resolveSignalReadContext: (...a: unknown[]) => mockResolveCtx(...a),
	facadeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
	rethrowIfSourceFailure: (e: unknown) => {
		const { AdapterError } = require("@openplait/adapter-sdk");
		if (e instanceof AdapterError) throw e;
	},
}));

import { listMetricRecords, getMetricsSummary, getMetricsFilterConfig, getMetricAttributeKeysRecord } from "@/lib/platform/metrics/read";
import { AdapterError } from "@openplait/adapter-sdk";

const params = {
	timeLimit: {
		start: new Date("2026-07-01T00:00:00.000Z"),
		end: new Date("2026-07-01T01:00:00.000Z"),
		type: "CUSTOM",
	},
	limit: 25,
	offset: 0,
	selectedConfig: {},
} as never;

beforeEach(() => jest.clearAllMocks());

describe("listMetricRecords", () => {
	it("uses the same adapter contract for the built-in ClickHouse source", async () => {
		const listMetricSeries = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				{
					metricName: "m",
					serviceName: "api",
					timestamp: "2026-07-01T00:00:00.000Z",
					value: 10,
					attributes: {},
					resourceAttributes: {},
				},
			],
		});
		mockResolveCtx.mockResolvedValue({
			adapter: { listMetricSeries },
			descriptor: { dbConfigId: "db-1" },
			isBuiltIn: true,
		});

		const res = await listMetricRecords(params);
		expect(listMetricSeries).toHaveBeenCalled();
		expect(res).toMatchObject({
			err: null,
			records: [expect.objectContaining({ metricName: "m", latestValue: 10 })],
		});
		expect(mockGetMetrics).not.toHaveBeenCalled();
	});

	it("folds external metric points into grouped list rows", async () => {
		const listMetricSeries = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				{
					metricName: "m",
					serviceName: "api",
					timestamp: "2026-07-01T00:00:00.000Z",
					value: 10,
					attributes: {},
					resourceAttributes: {},
				},
				{
					metricName: "m",
					serviceName: "api",
					timestamp: "2026-07-01T00:01:00.000Z",
					value: 20,
					attributes: {},
					resourceAttributes: {},
				},
			],
		});
		mockResolveCtx.mockResolvedValue({
			adapter: { listMetricSeries },
			descriptor: {},
			isBuiltIn: false,
		});

		const res = await listMetricRecords(params);
		expect(listMetricSeries).toHaveBeenCalled();
		expect(res.err).toBeNull();
		expect(res.records).toHaveLength(1);
		expect(res.records).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					metricName: "m",
					latestValue: 20,
					avgValue: 15,
				}),
			])
		);
		expect(mockGetMetrics).not.toHaveBeenCalled();
	});

	it("rethrows AdapterError so routes can return 503", async () => {
		const listMetricSeries = jest
			.fn()
			.mockRejectedValue(new AdapterError("EXECUTION_FAILED", "prometheus down"));
		mockResolveCtx.mockResolvedValue({
			adapter: { listMetricSeries },
			descriptor: {},
			isBuiltIn: false,
		});

		await expect(listMetricRecords(params)).rejects.toBeInstanceOf(AdapterError);
	});
});

describe("getMetricsSummary", () => {
	it("requests a count aggregation and maps value to count", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			fields: [],
			rows: [
				{ timestamp: "2026-07-01T00:00:00.000Z", value: 12 },
				{ timestamp: "2026-07-01T00:00:00.000Z", value: 3 },
				{ timestamp: "2026-07-01T01:00:00.000Z", value: 8 },
			],
		});
		mockResolveCtx.mockResolvedValue({
			adapter: { metricTimeSeries },
			descriptor: {},
			isBuiltIn: false,
		});

		const res = await getMetricsSummary(params);
		expect(metricTimeSeries).toHaveBeenCalledWith(
			expect.objectContaining({
				aggregations: [{ fn: "count", field: "value" }],
			})
		);
		expect(res).toMatchObject({
			err: null,
			total: 23,
			peak: 15,
			buckets: [
				{ label: "2026-07-01T00:00:00.000Z", count: 15 },
				{ label: "2026-07-01T01:00:00.000Z", count: 8 },
			],
		});
	});

	it("keeps ClickHouse-style count buckets", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			fields: [],
			rows: [{ label: "2026-07-01T00:00:00.000Z", count: 4, metrics: 2, services: 1 }],
		});
		mockResolveCtx.mockResolvedValue({
			adapter: { metricTimeSeries },
			descriptor: { dbConfigId: "db-1" },
			isBuiltIn: true,
		});

		const res = await getMetricsSummary(params);
		expect(res).toMatchObject({
			err: null,
			total: 4,
			peak: 4,
			buckets: [{ label: "2026-07-01T00:00:00.000Z", count: 4 }],
		});
	});
});

describe("getMetricsFilterConfig", () => {
	it("returns services and metric names for the filter bar", async () => {
		mockResolveCtx.mockResolvedValue({
			adapter: {
				capabilities: () => ({ distinctValues: true }),
				metricNames: jest.fn().mockResolvedValue(["up", "go_goroutines"]),
				distinctValues: jest.fn().mockResolvedValue(["prometheus-local"]),
			},
			descriptor: {},
			isBuiltIn: false,
		});

		const res = await getMetricsFilterConfig(params);
		expect(res).toEqual({
			err: null,
			data: [
				{
					services: ["prometheus-local"],
					metricNames: ["go_goroutines", "up"],
					metricTypes: [],
					totalRows: 0,
				},
			],
		});
	});

	it("falls back to job when service.name is empty", async () => {
		const distinctValues = jest.fn(async (key: string) =>
			key === "service.name" ? [] : key === "job" ? ["prometheus"] : []
		);
		mockResolveCtx.mockResolvedValue({
			adapter: {
				capabilities: () => ({ distinctValues: true }),
				metricNames: jest.fn().mockResolvedValue(["up"]),
				distinctValues,
			},
			descriptor: {},
			isBuiltIn: false,
		});

		const res = await getMetricsFilterConfig(params);
		expect(res.data?.[0]?.services).toEqual(["prometheus"]);
	});
});

describe("getMetricAttributeKeysRecord", () => {
	it("exposes Prometheus labels under metric and resource attribute keys", async () => {
		mockResolveCtx.mockResolvedValue({
			adapter: {
				attributeKeys: jest.fn().mockResolvedValue(["service_name", "job"]),
			},
			descriptor: {},
			isBuiltIn: false,
		});

		const res = await getMetricAttributeKeysRecord(params);
		expect(res).toMatchObject({
			metricAttributeKeys: ["service_name", "job"],
			resourceAttributeKeys: ["service_name", "job"],
		});
	});
});
