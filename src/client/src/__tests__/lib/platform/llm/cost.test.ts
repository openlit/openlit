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

import { dataCollector } from "@/lib/platform/common";
import {
	getCostByApplication,
	getCostByModel,
	getCostByProvider,
	getCostPerTime,
} from "@/lib/platform/llm/cost";

const mockedDataCollector = dataCollector as jest.MockedFunction<typeof dataCollector>;

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
				query: expect.stringContaining("request_time"),
			})
		);
	});
});
