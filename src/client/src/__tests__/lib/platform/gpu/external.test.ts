const mockResolveDescriptor = jest.fn();
const mockGetAdapter = jest.fn();

jest.mock("@/lib/telemetry-source", () => ({
	resolveTelemetrySourceDescriptor: (...a: unknown[]) =>
		mockResolveDescriptor(...a),
	getTelemetryAdapter: (...a: unknown[]) => mockGetAdapter(...a),
}));

import {
	externalAverageUtilization,
	externalUtilizationParamsPerTime,
	externalAverageTemperature,
	externalAverageTemperatureParamsPerTime,
	externalAveragePowerDraw,
	externalPowerParamsPerTime,
	externalAverageMemoryUsage,
	externalMemoryParamsPerTime,
	externalFanspeedParamsPerTime,
} from "@/lib/platform/gpu/external";

const prometheus = {
	type: "prometheus",
	id: "src-prom",
	isBuiltIn: false,
	settings: {},
	signals: ["metrics"],
	name: "Prometheus",
	dbConfigId: "db-1",
};

const builtin = {
	type: "clickhouse",
	id: "builtin:db-1",
	isBuiltIn: true,
	settings: {},
	signals: ["metrics"],
	name: "CH",
	dbConfigId: "db-1",
};

const params = {
	timeLimit: {
		start: new Date("2026-07-01T00:00:00.000Z"),
		end: new Date("2026-07-01T01:00:00.000Z"),
		type: "CUSTOM",
	},
	limit: 10,
	offset: 0,
	selectedConfig: {},
};

beforeEach(() => {
	jest.clearAllMocks();
	mockResolveDescriptor.mockResolvedValue(prometheus);
});

describe("built-in ClickHouse routing", () => {
	it("returns null for every export on the built-in source", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		expect(await externalAverageUtilization(params)).toBeNull();
		expect(await externalUtilizationParamsPerTime(params)).toBeNull();
		expect(await externalAverageTemperature(params)).toBeNull();
		expect(await externalAverageTemperatureParamsPerTime(params)).toBeNull();
		expect(await externalAveragePowerDraw(params)).toBeNull();
		expect(await externalPowerParamsPerTime(params)).toBeNull();
		expect(await externalAverageMemoryUsage(params)).toBeNull();
		expect(await externalMemoryParamsPerTime(params)).toBeNull();
		expect(await externalFanspeedParamsPerTime(params)).toBeNull();
		expect(mockGetAdapter).not.toHaveBeenCalled();
	});

	it("returns null when the resolved type is clickhouse even if not flagged built-in", async () => {
		mockResolveDescriptor.mockResolvedValue({ ...prometheus, isBuiltIn: false, type: "clickhouse" });
		expect(await externalAverageUtilization(params)).toBeNull();
	});

	it("resolves the metrics adapter for an external source", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });
		await externalAverageUtilization(params);
		expect(mockGetAdapter).toHaveBeenCalledWith({ signal: "metrics", environment: undefined });
	});
});

describe("externalAverageUtilization", () => {
	it("averages utilization values and filters the metric name into the query", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			rows: [{ value: 10 }, { value: 20 }],
		});
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageUtilization(params);
		expect(res).toEqual({ err: null, data: [{ utilization: 15 }] });
		const query = metricTimeSeries.mock.calls[0][0];
		expect(query.filters).toEqual(
			expect.arrayContaining([
				{ target: "spanName", op: "in", value: ["gpu.utilization"] },
			])
		);
		expect(query.aggregations).toEqual([{ fn: "avg", as: "utilization" }]);
	});

	it("falls back to count when value is absent and rounds to two decimals", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			rows: [{ count: 1 }, { count: 2 }, { count: 3 }],
		});
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageUtilization(params);
		expect(res).toEqual({ err: null, data: [{ utilization: 2 }] });
	});

	it("ignores non-finite values and returns zero when nothing remains", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			rows: [{ value: Number.NaN }, { value: Number.POSITIVE_INFINITY }],
		});
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageUtilization(params);
		expect(res).toEqual({ err: null, data: [{ utilization: 0 }] });
	});

	it("defaults to zero when neither value nor count is present", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({ rows: [{}] });
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageUtilization(params);
		expect(res).toEqual({ err: null, data: [{ utilization: 0 }] });
	});

	it("returns zero for an empty row set", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageUtilization(params);
		expect(res).toEqual({ err: null, data: [{ utilization: 0 }] });
	});

	it("returns a stringified error when the adapter throws a non-Error value", async () => {
		const metricTimeSeries = jest.fn().mockRejectedValue("boom");
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageUtilization(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});

	it("returns the Error message when the adapter throws an Error", async () => {
		const metricTimeSeries = jest.fn().mockRejectedValue(new Error("prometheus down"));
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageUtilization(params);
		expect(res).toEqual({ err: "prometheus down", data: [] });
	});
});

describe("externalUtilizationParamsPerTime", () => {
	it("buckets values per time by mapped metric key", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			rows: [
				{ request_time: "00:00", metricName: "gpu.utilization", value: 10 },
				{ request_time: "00:00", __name__: "gpu.enc.utilization", value: 20 },
				{ request_time: "01:00", metricName: "gpu.dec.utilization", value: 30 },
			],
		});
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalUtilizationParamsPerTime(params);
		expect(res).toEqual({
			err: null,
			data: [
				{ request_time: "00:00", utilization: 10, enc_utilization: 20 },
				{ request_time: "01:00", dec_utilization: 30 },
			],
		});
	});

	it("skips rows missing a time label or a finite value", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			rows: [
				{ metricName: "gpu.utilization", value: 10 },
				{ request_time: "00:00", metricName: "gpu.utilization", value: Number.NaN },
				{ request_time: "00:00", metricName: "", value: 5 },
				{ request_time: "00:00", value: 5 },
			],
		});
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalUtilizationParamsPerTime(params);
		expect(res).toEqual({ err: null, data: [] });
	});

	it("uses timestamp/label fallbacks for the time bucket key", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			rows: [{ timestamp: "t1", metricName: "gpu.utilization", value: 1 }],
		});
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalUtilizationParamsPerTime(params);
		expect(res).toEqual({ err: null, data: [{ request_time: "t1", utilization: 1 }] });
	});

	it("returns an error payload on failure", async () => {
		const metricTimeSeries = jest.fn().mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalUtilizationParamsPerTime(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});
});

describe("externalAverageTemperature", () => {
	it("averages temperature values", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({ rows: [{ value: 50 }, { value: 60 }] });
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageTemperature(params);
		expect(res).toEqual({ err: null, data: [{ temperature: 55 }] });
	});
});

describe("externalAverageTemperatureParamsPerTime", () => {
	it("buckets temperature by time via bucketByTime", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			rows: [
				{ request_time: "01:00", value: 70 },
				{ request_time: "00:00", value: 50 },
				{ request_time: "00:00", value: 60 },
				{ label: "" },
				{ timestamp: "02:00", value: 80 },
				{ request_time: "02:00", value: Number.NaN },
			],
		});
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageTemperatureParamsPerTime(params);
		expect(res).toEqual({
			err: null,
			data: [
				{ request_time: "00:00", temperature: 55 },
				{ request_time: "01:00", temperature: 70 },
				{ request_time: "02:00", temperature: 80 },
			],
		});
	});

	it("returns an error payload on failure", async () => {
		const metricTimeSeries = jest.fn().mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageTemperatureParamsPerTime(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});
});

describe("externalAveragePowerDraw / externalPowerParamsPerTime", () => {
	it("averages power draw", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({ rows: [{ value: 100 }] });
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAveragePowerDraw(params);
		expect(res).toEqual({ err: null, data: [{ power_draw: 100 }] });
	});

	it("buckets power draw/limit series by mapped keys", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			rows: [
				{ request_time: "00:00", metricName: "gpu.power.draw", value: 12.345 },
				{ request_time: "00:00", metricName: "gpu.power.limit", value: 20 },
			],
		});
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalPowerParamsPerTime(params);
		expect(res).toEqual({
			err: null,
			data: [{ request_time: "00:00", power_draw: 12.345, power_limit: 20 }],
		});
	});

	it("returns an error payload on failure for power series", async () => {
		const metricTimeSeries = jest.fn().mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalPowerParamsPerTime(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});
});

describe("externalAverageMemoryUsage / externalMemoryParamsPerTime", () => {
	it("averages memory usage", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({ rows: [{ value: 40 }] });
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalAverageMemoryUsage(params);
		expect(res).toEqual({ err: null, data: [{ memory_used: 40 }] });
	});

	it("buckets each memory series by mapped key", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			rows: [
				{ request_time: "00:00", metricName: "gpu.memory.available", value: 1 },
				{ request_time: "00:00", metricName: "gpu.memory.total", value: 2 },
				{ request_time: "00:00", metricName: "gpu.memory.used", value: 3 },
				{ request_time: "00:00", metricName: "gpu.memory.free", value: 4 },
			],
		});
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalMemoryParamsPerTime(params);
		expect(res).toEqual({
			err: null,
			data: [
				{
					request_time: "00:00",
					memory_available: 1,
					memory_total: 2,
					memory_used: 3,
					memory_free: 4,
				},
			],
		});
	});

	it("returns an error payload on failure for memory series", async () => {
		const metricTimeSeries = jest.fn().mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalMemoryParamsPerTime(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});
});

describe("externalFanspeedParamsPerTime", () => {
	it("buckets fan speed values by time", async () => {
		const metricTimeSeries = jest.fn().mockResolvedValue({
			rows: [
				{ request_time: "00:00", value: 30 },
				{ request_time: "00:00", value: 40 },
			],
		});
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalFanspeedParamsPerTime(params);
		expect(res).toEqual({ err: null, data: [{ request_time: "00:00", fan_speed: 35 }] });
	});

	it("returns an error payload on failure", async () => {
		const metricTimeSeries = jest.fn().mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue({ metricTimeSeries });

		const res = await externalFanspeedParamsPerTime(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});
});
