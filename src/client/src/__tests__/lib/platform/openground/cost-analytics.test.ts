jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));

jest.mock("@/lib/db-config", () => ({
	getDBConfigByUser: jest.fn(),
}));

jest.mock("@/utils/asaw", () => ({
	__esModule: true,
	default: jest.fn(),
}));

jest.mock("@/helpers/server/platform", () => ({
	getFilterPreviousParams: jest.fn((params) => params),
}));

import { dataCollector } from "@/lib/platform/common";
import asaw from "@/utils/asaw";
import {
	getOpengroundCostByProvider,
	getOpengroundTotalCost,
} from "@/lib/platform/openground/cost-analytics";

const mockedDataCollector = dataCollector as jest.MockedFunction<typeof dataCollector>;
const mockedAsaw = asaw as jest.MockedFunction<typeof asaw>;

const params = {
	timeLimit: {
		start: new Date("2024-01-01"),
		end: new Date("2024-01-02"),
		type: "custom",
	},
};

describe("openground cost analytics", () => {
	beforeEach(() => {
		mockedDataCollector.mockReset();
		mockedAsaw.mockReset();
		mockedAsaw.mockResolvedValue([null, { id: "db-1" }]);
		mockedDataCollector.mockResolvedValue({ data: [] });
	});

	it("returns zeros when no active database config", async () => {
		mockedAsaw.mockResolvedValueOnce([null, null]);
		const res = await getOpengroundTotalCost(params);
		expect(res).toEqual({
			data: [{ total_cost: 0, previous_total_cost: 0 }],
		});
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("queries total openground cost for the active database", async () => {
		await getOpengroundTotalCost(params);
		const query = mockedDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("openlit_openground_providers");
		// Float64 cost columns must not use toFloat64OrZero (ClickHouse rejects it).
		expect(query).not.toContain("toFloat64OrZero");
		expect(query).toContain("sum(ifNull(p.cost, 0))");
		expect(mockedDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({ query }),
			"query",
			"db-1"
		);
	});

	it("queries openground cost by provider", async () => {
		await getOpengroundCostByProvider(params);
		const query = mockedDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("AS provider");
		expect(query).not.toContain("toFloat64OrZero");
		expect(query).toContain("SUM(ifNull(p.cost, 0))");
		expect(mockedDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({ query }),
			"query",
			"db-1"
		);
	});
});
