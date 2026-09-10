jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));

jest.mock("@/helpers/server/platform", () => ({
	dateTruncGroupingLogic: jest.fn(() => "hour"),
	getFilterPreviousParams: jest.fn((params) => params),
	getFilterWhereCondition: jest.fn(() => "1 = 1"),
}));

jest.mock("@/helpers/server/trace", () => ({
	getTraceMappingKeyFullPath: jest.fn((key: string) => {
		if (key === "cost") return "gen_ai.usage.cost";
		if (key === "model") return "gen_ai.request.model";
		if (key === "applicationName") return "service.name";
		return key;
	}),
	getTraceMappingKeyFullPaths: jest.fn(() => ["gen_ai.provider.name", "gen_ai.system"]),
}));

jest.mock("@/lib/platform/llm/external", () => ({
	externalTotalCost: jest.fn(async () => null),
	externalAverageCost: jest.fn(async () => null),
	externalCostByApplication: jest.fn(async () => null),
	externalCostByEnvironment: jest.fn(async () => null),
}));

import { dataCollector } from "@/lib/platform/common";
import {
	getAverageCost,
	getCostByApplication,
	getCostByEnvironment,
	getCostByModel,
	getCostByProvider,
	getCostPerTime,
	getTotalCost,
} from "@/lib/platform/llm/cost";
import * as external from "@/lib/platform/llm/external";

const mockedDataCollector = dataCollector as jest.MockedFunction<typeof dataCollector>;
const mockedExternalTotalCost = external.externalTotalCost as jest.MockedFunction<
	typeof external.externalTotalCost
>;
const mockedExternalAverageCost = external.externalAverageCost as jest.MockedFunction<
	typeof external.externalAverageCost
>;
const mockedExternalCostByApplication =
	external.externalCostByApplication as jest.MockedFunction<
		typeof external.externalCostByApplication
	>;
const mockedExternalCostByEnvironment =
	external.externalCostByEnvironment as jest.MockedFunction<
		typeof external.externalCostByEnvironment
	>;

const params = {
	timeLimit: {
		start: new Date("2024-01-01"),
		end: new Date("2024-01-02"),
		type: "custom",
	},
};

describe("llm cost analytics queries", () => {
	beforeEach(() => {
		mockedDataCollector.mockReset();
		mockedDataCollector.mockResolvedValue({ data: [] });
		mockedExternalTotalCost.mockReset().mockResolvedValue(null);
		mockedExternalAverageCost.mockReset().mockResolvedValue(null);
		mockedExternalCostByApplication.mockReset().mockResolvedValue(null);
		mockedExternalCostByEnvironment.mockReset().mockResolvedValue(null);
	});

	it("queries total cost via the built-in ClickHouse path when there is no external source", async () => {
		await getTotalCost(params);
		const query = mockedDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("total_usage_cost");
		expect(query).toContain("previous_total_usage_cost");
		expect(query).toContain("gen_ai.usage.cost");
	});

	it("returns the external total cost result directly when available", async () => {
		mockedExternalTotalCost.mockResolvedValue({
			err: null,
			data: [{ total_usage_cost: 12, previous_total_usage_cost: 8 }],
		});

		const result = await getTotalCost(params);

		expect(result).toEqual({
			err: null,
			data: [{ total_usage_cost: 12, previous_total_usage_cost: 8 }],
		});
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("queries average cost via the built-in ClickHouse path when there is no external source", async () => {
		await getAverageCost(params);
		const query = mockedDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("average_usage_cost");
		expect(query).toContain("previous_average_usage_cost");
	});

	it("returns the external average cost result directly when available", async () => {
		mockedExternalAverageCost.mockResolvedValue({
			err: null,
			data: [{ average_usage_cost: 4 }],
		});

		const result = await getAverageCost(params);

		expect(result).toEqual({ err: null, data: [{ average_usage_cost: 4 }] });
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("maps the external cost-by-application result to applicationName/cost", async () => {
		mockedExternalCostByApplication.mockResolvedValue({
			err: null,
			data: [{ application: "svc-a", total_cost: 3 }],
		});

		const result = await getCostByApplication(params);

		expect(result).toEqual({
			err: null,
			data: [{ applicationName: "svc-a", cost: 3 }],
		});
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("defaults to an empty list when the external cost-by-application data is missing", async () => {
		mockedExternalCostByApplication.mockResolvedValue({
			err: "boom",
			data: undefined,
		} as any);

		const result = await getCostByApplication(params);

		expect(result).toEqual({ err: "boom", data: [] });
	});

	it("queries cost by environment via the built-in ClickHouse path when there is no external source", async () => {
		await getCostByEnvironment(params);
		const query = mockedDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("as environment");
		expect(query).toContain("deployment.environment");
	});

	it("returns the external cost-by-environment result directly when available", async () => {
		mockedExternalCostByEnvironment.mockResolvedValue({
			err: null,
			data: [{ environment: "prod", cost: 9 }],
		});

		const result = await getCostByEnvironment(params);

		expect(result).toEqual({ err: null, data: [{ environment: "prod", cost: 9 }] });
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("queries cost by application via ServiceName fallbacks", async () => {
		await getCostByApplication(params);
		const query = mockedDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("AS applicationName");
		expect(query).toContain("ServiceName");
		expect(query).toContain("ResourceAttributes['service.name']");
		expect(query).toContain("SpanAttributes['gen_ai.application_name']");
		expect(query).not.toContain(
			"ResourceAttributes['SpanAttributes.gen_ai.application_name']"
		);
	});

	it("queries cost by provider", async () => {
		await getCostByProvider(params);
		expect(mockedDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.stringContaining("AS provider"),
			})
		);
		expect(mockedDataCollector.mock.calls[0][0].query).toContain(
			"gen_ai.usage.cost"
		);
	});

	it("queries cost by model", async () => {
		await getCostByModel(params);
		expect(mockedDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.stringContaining("AS model"),
			})
		);
	});

	it("queries cost per time", async () => {
		await getCostPerTime(params);
		expect(mockedDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.stringContaining("AS request_time"),
			})
		);
	});
});
