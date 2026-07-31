jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));

jest.mock("@/helpers/server/platform", () => ({
	getFilterWhereCondition: jest.fn(() => "1 = 1"),
}));

jest.mock("@/helpers/server/trace", () => ({
	getTraceMappingKeyFullPath: jest.fn(() => "gen_ai.usage.cost"),
}));

jest.mock("@/lib/platform/pricing/config", () => ({
	getPricingConfig: jest.fn(),
}));

import { dataCollector } from "@/lib/platform/common";
import { getPricingConfig } from "@/lib/platform/pricing/config";
import { getCostPricingGuidance } from "@/lib/platform/pricing/guidance";

const mockedDataCollector = dataCollector as jest.MockedFunction<
	typeof dataCollector
>;
const mockedGetPricingConfig = getPricingConfig as jest.MockedFunction<
	typeof getPricingConfig
>;

const params = {
	timeLimit: {
		start: "2024-01-01T00:00:00.000Z",
		end: "2024-01-02T00:00:00.000Z",
		type: "24H",
	},
};

describe("getCostPricingGuidance", () => {
	beforeEach(() => {
		mockedDataCollector.mockReset();
		mockedGetPricingConfig.mockReset();
	});

	it("shows backfill banner when auto pricing is off and missing costs exist", async () => {
		mockedGetPricingConfig.mockResolvedValue({ auto: false } as never);
		mockedDataCollector.mockResolvedValue({
			data: [{ missing_cost_spans: 12 }],
		});

		const res = await getCostPricingGuidance(params);

		expect(res).toEqual({
			autoEnabled: false,
			missingCostSpans: 12,
			showBackfillBanner: true,
		});
	});

	it("hides banner when auto pricing is already enabled", async () => {
		mockedGetPricingConfig.mockResolvedValue({ auto: true } as never);
		mockedDataCollector.mockResolvedValue({
			data: [{ missing_cost_spans: 12 }],
		});

		const res = await getCostPricingGuidance(params);

		expect(res.showBackfillBanner).toBe(false);
		expect(res.autoEnabled).toBe(true);
	});

	it("hides banner when there are no missing costs", async () => {
		mockedGetPricingConfig.mockResolvedValue({ auto: false } as never);
		mockedDataCollector.mockResolvedValue({
			data: [{ missing_cost_spans: 0 }],
		});

		const res = await getCostPricingGuidance(params);

		expect(res.showBackfillBanner).toBe(false);
	});
});
