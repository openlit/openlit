const mockResolveDescriptor = jest.fn();
const mockGetAdapter = jest.fn();
const mockReadSignalBucketRollup = jest.fn();
const mockReadLlmRollup = jest.fn();

jest.mock("@/lib/telemetry-source", () => ({
	resolveTelemetrySourceDescriptor: (...a: unknown[]) =>
		mockResolveDescriptor(...a),
	getTelemetryAdapter: (...a: unknown[]) => mockGetAdapter(...a),
}));

jest.mock("@/lib/platform/telemetry/rollups", () => ({
	readSignalBucketRollup: (...a: unknown[]) => mockReadSignalBucketRollup(...a),
	readLlmRollup: (...a: unknown[]) => mockReadLlmRollup(...a),
}));

import {
	externalTotalCost,
	externalAverageCost,
	externalCostPerTime,
	externalAverageTokens,
	externalTokensPerTime,
	externalGenerationByCategories,
	externalGenerationByProvider,
	externalTopModels,
	externalCostByApplication,
	externalCostByEnvironment,
	externalModelsPerTime,
} from "@/lib/platform/llm/external";

const tempo = {
	type: "tempo",
	id: "src-tempo",
	isBuiltIn: false,
	settings: {},
	signals: ["traces"],
	name: "Tempo",
	dbConfigId: "db-1",
};

const builtin = {
	type: "clickhouse",
	id: "builtin:db-1",
	isBuiltIn: true,
	settings: {},
	signals: ["traces"],
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

function serverAggregationAdapter() {
	return {
		capabilities: () => ({ serverAggregation: true }),
		aggregateSpans: jest.fn(),
		spanTimeSeries: jest.fn(),
	};
}

beforeEach(() => {
	jest.clearAllMocks();
	mockResolveDescriptor.mockResolvedValue(tempo);
});

describe("built-in ClickHouse routing", () => {
	it("returns null for the implicit built-in source so callers fall back to SQL", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		expect(await externalTotalCost(params)).toBeNull();
		expect(mockGetAdapter).not.toHaveBeenCalled();
	});

	it("returns null when the resolved type is clickhouse even if not flagged built-in", async () => {
		mockResolveDescriptor.mockResolvedValue({ ...tempo, isBuiltIn: false, type: "clickhouse" });
		expect(await externalAverageCost(params)).toBeNull();
	});

	it("resolves the adapter for the traces signal when the source is external", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [{ average_usage_cost: 1 }] });
		mockGetAdapter.mockResolvedValue(adapter);
		await externalAverageCost(params);
		expect(mockGetAdapter).toHaveBeenCalledWith({ signal: "traces", environment: undefined });
	});

	it("returns null for every remaining export on the built-in source", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		expect(await externalCostPerTime(params)).toBeNull();
		expect(await externalAverageTokens(params)).toBeNull();
		expect(await externalTokensPerTime(params)).toBeNull();
		expect(await externalGenerationByCategories(params)).toBeNull();
		expect(await externalGenerationByProvider(params)).toBeNull();
		expect(await externalTopModels(params)).toBeNull();
		expect(await externalCostByApplication(params)).toBeNull();
		expect(await externalCostByEnvironment(params)).toBeNull();
		expect(await externalModelsPerTime(params)).toBeNull();
		expect(mockGetAdapter).not.toHaveBeenCalled();
	});
});

describe("externalTotalCost", () => {
	it("aggregates current and previous window cost via the adapter", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans
			.mockResolvedValueOnce({ rows: [{ total_usage_cost: 120 }] })
			.mockResolvedValueOnce({ rows: [{ total_usage_cost: 80 }] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalTotalCost(params);
		expect(res).toEqual({
			err: null,
			data: [{ total_usage_cost: 120, previous_total_usage_cost: 80 }],
		});
	});

	it("defaults to zero when the aggregation returns no rows", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalTotalCost(params);
		expect(res).toEqual({
			err: null,
			data: [{ total_usage_cost: 0, previous_total_usage_cost: 0 }],
		});
	});

	it("returns a stringified error when the adapter throws a non-Error value", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockRejectedValue("boom");
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalTotalCost(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});

	it("returns the Error message when the adapter throws an Error", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockRejectedValue(new Error("tempo down"));
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalTotalCost(params);
		expect(res).toEqual({ err: "tempo down", data: [] });
	});

	it("prefers the L2 rollup total when the adapter has no server aggregation", async () => {
		const adapter = { capabilities: () => ({ serverAggregation: false }), aggregateSpans: jest.fn() };
		mockGetAdapter.mockResolvedValue(adapter);
		mockReadSignalBucketRollup.mockResolvedValue({
			rows: [{ cost: 10 }, { cost: 15 }],
			meta: { freshness: "accelerated" },
		});

		const res = await externalTotalCost(params);
		expect(mockReadSignalBucketRollup).toHaveBeenCalled();
		expect(adapter.aggregateSpans).not.toHaveBeenCalled();
		expect(res).toEqual({
			err: null,
			data: [{ total_usage_cost: 25, previous_total_usage_cost: 25 }],
		});
	});

	it("treats a missing per-row cost as zero in the rollup reducer", async () => {
		const adapter = { capabilities: () => ({ serverAggregation: false }), aggregateSpans: jest.fn() };
		mockGetAdapter.mockResolvedValue(adapter);
		mockReadSignalBucketRollup.mockResolvedValue({ rows: [{}], meta: {} });

		const res = await externalTotalCost(params);
		expect(res).toEqual({
			err: null,
			data: [{ total_usage_cost: 0, previous_total_usage_cost: 0 }],
		});
	});

	it("falls back to the adapter when the rollup reports no series", async () => {
		const adapter = {
			capabilities: () => ({ serverAggregation: false }),
			aggregateSpans: jest.fn().mockResolvedValue({ rows: [{ total_usage_cost: 42 }] }),
		};
		mockGetAdapter.mockResolvedValue(adapter);
		mockReadSignalBucketRollup.mockResolvedValue(null);

		const res = await externalTotalCost(params);
		expect(adapter.aggregateSpans).toHaveBeenCalled();
		expect(res).toEqual({
			err: null,
			data: [{ total_usage_cost: 42, previous_total_usage_cost: 42 }],
		});
	});
});

describe("externalAverageCost", () => {
	it("returns the average cost from the adapter", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [{ average_usage_cost: 3.5 }] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalAverageCost(params);
		expect(res).toEqual({ err: null, data: [{ average_usage_cost: 3.5 }] });
	});

	it("defaults to zero without rows", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalAverageCost(params);
		expect(res).toEqual({ err: null, data: [{ average_usage_cost: 0 }] });
	});

	it("returns an error payload on failure", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalAverageCost(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});
});

describe("externalCostPerTime", () => {
	it("maps a time series of cost buckets", async () => {
		const adapter = serverAggregationAdapter();
		adapter.spanTimeSeries.mockResolvedValue({
			rows: [
				{ total_cost: 10, request_time: "2026-07-01 00:00" },
				{ cost: 5, label: "2026-07-01 01:00" },
			],
		});
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostPerTime(params);
		expect(res).toEqual({
			err: null,
			data: [
				{ total_cost: 10, request_time: "2026-07-01 00:00" },
				{ total_cost: 5, request_time: "2026-07-01 01:00" },
			],
		});
	});

	it("returns an error payload on failure", async () => {
		const adapter = serverAggregationAdapter();
		adapter.spanTimeSeries.mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostPerTime(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});

	it("falls back to the bucket label and zero cost when fields are absent", async () => {
		const adapter = serverAggregationAdapter();
		adapter.spanTimeSeries.mockResolvedValue({ rows: [{ bucket: "2026-07-01 02:00" }] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostPerTime(params);
		expect(res).toEqual({
			err: null,
			data: [{ total_cost: 0, request_time: "2026-07-01 02:00" }],
		});
	});

	it("prefers the L2 rollup series when supported", async () => {
		const adapter = { capabilities: () => ({ serverAggregation: false }), spanTimeSeries: jest.fn() };
		mockGetAdapter.mockResolvedValue(adapter);
		mockReadSignalBucketRollup.mockResolvedValue({
			rows: [{ total_cost: 7, request_time: "2026-07-01 00:00" }],
			meta: {},
		});

		const res = await externalCostPerTime(params);
		expect(adapter.spanTimeSeries).not.toHaveBeenCalled();
		expect(res).toEqual({
			err: null,
			data: [{ total_cost: 7, request_time: "2026-07-01 00:00" }],
		});
	});
});

describe("externalAverageTokens", () => {
	it("uses the prompt token field", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [{ total_tokens: 11 }] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalAverageTokens({ ...params, type: "prompt" });
		expect(res).toEqual({ err: null, data: [{ total_tokens: 11 }] });
	});

	it("uses the completion token field", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [{ total_tokens: 22 }] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalAverageTokens({ ...params, type: "completion" });
		expect(res).toEqual({ err: null, data: [{ total_tokens: 22 }] });
	});

	it("adds the previous window when type is total", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans
			.mockResolvedValueOnce({ rows: [{ total_tokens: 30 }] })
			.mockResolvedValueOnce({ rows: [{ total_tokens: 20 }] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalAverageTokens({ ...params, type: "total" });
		expect(res).toEqual({
			err: null,
			data: [{ total_tokens: 30, previous_total_tokens: 20 }],
		});
	});

	it("returns an error payload on failure", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalAverageTokens({ ...params, type: "total" });
		expect(res).toEqual({ err: "boom", data: [] });
	});

	it("defaults current and previous totals to zero without rows", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalAverageTokens({ ...params, type: "total" });
		expect(res).toEqual({
			err: null,
			data: [{ total_tokens: 0, previous_total_tokens: 0 }],
		});
	});
});

describe("externalTokensPerTime", () => {
	it("maps a time series of token buckets", async () => {
		const adapter = serverAggregationAdapter();
		adapter.spanTimeSeries.mockResolvedValue({
			rows: [
				{ total_tokens: 10, request_time: "2026-07-01 00:00" },
				{ tokens: 4, bucket: "2026-07-01 01:00" },
			],
		});
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalTokensPerTime(params);
		expect(res).toEqual({
			err: null,
			data: [
				{ total_tokens: 10, request_time: "2026-07-01 00:00" },
				{ total_tokens: 4, request_time: "2026-07-01 01:00" },
			],
		});
	});

	it("returns an error payload on failure", async () => {
		const adapter = serverAggregationAdapter();
		adapter.spanTimeSeries.mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalTokensPerTime(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});

	it("prefers the L2 rollup series when supported", async () => {
		const adapter = { capabilities: () => ({ serverAggregation: false }), spanTimeSeries: jest.fn() };
		mockGetAdapter.mockResolvedValue(adapter);
		mockReadSignalBucketRollup.mockResolvedValue({
			rows: [{ total_tokens: 9, request_time: "2026-07-01 00:00" }],
			meta: {},
		});

		const res = await externalTokensPerTime(params);
		expect(adapter.spanTimeSeries).not.toHaveBeenCalled();
		expect(res).toEqual({
			err: null,
			data: [{ total_tokens: 9, request_time: "2026-07-01 00:00" }],
		});
	});

	it("falls back to the bucket label and zero tokens when fields are absent", async () => {
		const adapter = serverAggregationAdapter();
		adapter.spanTimeSeries.mockResolvedValue({ rows: [{ bucket: "2026-07-01 02:00" }] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalTokensPerTime(params);
		expect(res).toEqual({
			err: null,
			data: [{ total_tokens: 0, request_time: "2026-07-01 02:00" }],
		});
	});
});

describe("externalGenerationByCategories / ByProvider / TopModels", () => {
	it("groups by operation name for categories", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({
			rows: [{ group_value: "chat", count: 4 }],
		});
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalGenerationByCategories(params);
		expect(res).toEqual({ err: null, data: [{ category: "chat", count: 4 }] });
	});

	it("groups by gen_ai.system for provider", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({
			rows: [{ g0: "openai", count: 2 }],
		});
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalGenerationByProvider(params);
		expect(res).toEqual({ err: null, data: [{ provider: "openai", count: 2 }] });
	});

	it("groups by request model for top models", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({
			rows: [{ "gen_ai.request.model": "gpt-4o", count: 9 }],
		});
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalTopModels(params);
		expect(res).toEqual({ err: null, data: [{ model: "gpt-4o", count: 9 }] });
	});

	it("defaults to an empty label and zero count when missing", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [{}] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalTopModels(params);
		expect(res).toEqual({ err: null, data: [{ model: "", count: 0 }] });
	});

	it("returns an error payload on failure", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalGenerationByCategories(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});

	it("prefers the L2 rollup series when supported", async () => {
		const adapter = { capabilities: () => ({ serverAggregation: false }), aggregateSpans: jest.fn() };
		mockGetAdapter.mockResolvedValue(adapter);
		mockReadLlmRollup.mockResolvedValue({
			rows: [{ group_value: "chat", count: 6 }],
			meta: {},
		});

		const res = await externalGenerationByCategories(params);
		expect(adapter.aggregateSpans).not.toHaveBeenCalled();
		expect(res).toEqual({ err: null, data: [{ category: "chat", count: 6 }] });
	});
});

describe("externalCostByApplication", () => {
	it("groups cost by service name", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({
			rows: [{ group_value: "api", total_cost: 15 }],
		});
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostByApplication(params);
		expect(res).toEqual({ err: null, data: [{ application: "api", total_cost: 15 }] });
	});

	it("returns an error payload on failure", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostByApplication(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});

	it("falls back to the raw service.name field and zero cost when absent", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [{ "service.name": "api" }] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostByApplication(params);
		expect(res).toEqual({ err: null, data: [{ application: "api", total_cost: 0 }] });
	});

	it("defaults to an empty application label when no field is present", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [{}] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostByApplication(params);
		expect(res).toEqual({ err: null, data: [{ application: "", total_cost: 0 }] });
	});

	it("prefers the L2 rollup series when supported", async () => {
		const adapter = { capabilities: () => ({ serverAggregation: false }), aggregateSpans: jest.fn() };
		mockGetAdapter.mockResolvedValue(adapter);
		mockReadLlmRollup.mockResolvedValue({
			rows: [{ group_value: "worker", total_cost: 3 }],
			meta: {},
		});

		const res = await externalCostByApplication(params);
		expect(adapter.aggregateSpans).not.toHaveBeenCalled();
		expect(res).toEqual({ err: null, data: [{ application: "worker", total_cost: 3 }] });
	});
});

describe("externalCostByEnvironment", () => {
	it("groups cost by deployment environment", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({
			rows: [{ "deployment.environment": "prod", total_cost: 8 }],
		});
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostByEnvironment(params);
		expect(res).toEqual({ err: null, data: [{ environment: "prod", cost: 8 }] });
	});

	it("defaults to an empty environment label when missing", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [{ total_cost: 2 }] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostByEnvironment(params);
		expect(res).toEqual({ err: null, data: [{ environment: "", cost: 2 }] });
	});

	it("returns an error payload on failure", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostByEnvironment(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});

	it("falls back to the raw deployment.environment field and zero cost when absent", async () => {
		const adapter = serverAggregationAdapter();
		adapter.aggregateSpans.mockResolvedValue({ rows: [{ "deployment.environment": "staging" }] });
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalCostByEnvironment(params);
		expect(res).toEqual({ err: null, data: [{ environment: "staging", cost: 0 }] });
	});

	it("prefers the L2 rollup series when supported", async () => {
		const adapter = { capabilities: () => ({ serverAggregation: false }), aggregateSpans: jest.fn() };
		mockGetAdapter.mockResolvedValue(adapter);
		mockReadLlmRollup.mockResolvedValue({
			rows: [{ group_value: "staging", total_cost: 1 }],
			meta: {},
		});

		const res = await externalCostByEnvironment(params);
		expect(adapter.aggregateSpans).not.toHaveBeenCalled();
		expect(res).toEqual({ err: null, data: [{ environment: "staging", cost: 1 }] });
	});
});

describe("externalModelsPerTime", () => {
	it("buckets model counts per time bucket, sorted by time", async () => {
		const adapter = serverAggregationAdapter();
		adapter.spanTimeSeries.mockResolvedValue({
			rows: [
				{ request_time: "2026-07-01 01:00", "gen_ai.request.model": "gpt-4o", model_count: 3 },
				{ request_time: "2026-07-01 00:00", g0: "gpt-4o-mini", count: 2 },
				{ request_time: "2026-07-01 00:00", group_value: "", model_count: 5 },
			],
		});
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalModelsPerTime(params);
		expect(res?.err).toBeNull();
		expect(res?.data).toEqual([
			{
				request_time: "2026-07-01 00:00",
				models: ["gpt-4o-mini"],
				model_counts: [2],
				total_model_count: 7,
			},
			{
				request_time: "2026-07-01 01:00",
				models: ["gpt-4o"],
				model_counts: [3],
				total_model_count: 3,
			},
		]);
	});

	it("returns an error payload on failure", async () => {
		const adapter = serverAggregationAdapter();
		adapter.spanTimeSeries.mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalModelsPerTime(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});

	it("falls back to label/bucket time keys and a count field, skipping unnamed models", async () => {
		const adapter = serverAggregationAdapter();
		adapter.spanTimeSeries.mockResolvedValue({
			rows: [{ label: "2026-07-01 03:00", count: 4 }],
		});
		mockGetAdapter.mockResolvedValue(adapter);

		const res = await externalModelsPerTime(params);
		expect(res).toEqual({
			err: null,
			data: [
				{
					request_time: "2026-07-01 03:00",
					models: [],
					model_counts: [],
					total_model_count: 4,
				},
			],
		});
	});
});
