jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));

jest.mock("@/helpers/server/platform", () => ({
	getFilterPreviousParams: jest.fn((params) => ({
		...params,
		timeLimit: {
			...params.timeLimit,
			start: new Date("2023-12-31"),
			end: new Date("2024-01-01"),
		},
	})),
}));

import { dataCollector } from "@/lib/platform/common";
import { getFilterPreviousParams } from "@/helpers/server/platform";
import { getCodingAgentsTotalCost } from "@/lib/platform/coding-agents/cost";

const mockedDataCollector = dataCollector as jest.MockedFunction<
	typeof dataCollector
>;
const mockedGetFilterPreviousParams =
	getFilterPreviousParams as jest.MockedFunction<
		typeof getFilterPreviousParams
	>;

const params = {
	timeLimit: {
		start: new Date("2024-01-01T00:00:00.000Z"),
		end: new Date("2024-01-02T00:00:00.000Z"),
		type: "custom",
	},
};

describe("getCodingAgentsTotalCost", () => {
	beforeEach(() => {
		mockedDataCollector.mockReset();
		mockedGetFilterPreviousParams.mockClear();
		mockedDataCollector.mockResolvedValue({
			data: [{ total_cost: 2.5, previous_total_cost: 1.1 }],
		});
	});

	it("queries current and previous coding-agent costs joined by start date", async () => {
		const res = await getCodingAgentsTotalCost(params);

		expect(mockedGetFilterPreviousParams).toHaveBeenCalledWith(params);
		expect(mockedDataCollector).toHaveBeenCalledTimes(1);

		const query = mockedDataCollector.mock.calls[0][0].query as string;
		expect(query).toContain("otel_traces");
		expect(query).toContain("total_cost");
		expect(query).toContain("previous_total_cost");
		expect(query).toContain("coding_agent.");
		expect(query).toContain(String(params.timeLimit.start));
		expect(res).toEqual({
			data: [{ total_cost: 2.5, previous_total_cost: 1.1 }],
		});
	});

	it("returns dataCollector errors unchanged", async () => {
		const err = new Error("clickhouse down");
		mockedDataCollector.mockResolvedValueOnce({ data: null, err });

		const res = await getCodingAgentsTotalCost(params);

		expect(res).toEqual({ data: null, err });
	});
});
