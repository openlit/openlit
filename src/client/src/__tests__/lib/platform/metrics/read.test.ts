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

jest.mock("@/lib/platform/datasource/facade", () => ({
	resolveSignalReadContext: (...a: unknown[]) => mockResolveCtx(...a),
	facadeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { listMetricRecords } from "@/lib/platform/metrics/read";

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
	it("delegates to ClickHouse getMetrics for the built-in source", async () => {
		mockResolveCtx.mockResolvedValue({ adapter: {}, isBuiltIn: true });
		mockGetMetrics.mockResolvedValue({ records: [{ metricName: "m" }], total: 1 });

		const res = await listMetricRecords(params);
		expect(mockGetMetrics).toHaveBeenCalledWith(params);
		expect(res).toEqual({ records: [{ metricName: "m" }], total: 1 });
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
});
