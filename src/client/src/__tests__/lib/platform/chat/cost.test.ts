jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
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
import { getOtterTotalCost } from "@/lib/platform/chat/cost";

const mockedDataCollector = dataCollector as jest.MockedFunction<
	typeof dataCollector
>;
const mockedGetFilterPreviousParams =
	getFilterPreviousParams as jest.MockedFunction<
		typeof getFilterPreviousParams
	>;

const params = {
	timeLimit: {
		start: new Date("2024-01-01"),
		end: new Date("2024-01-02"),
		type: "custom",
	},
};

describe("getOtterTotalCost", () => {
	beforeEach(() => {
		mockedDataCollector.mockReset();
		mockedGetFilterPreviousParams.mockClear();
	});

	it("sums current and previous period otter costs", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [{ total_cost: 1.25 }] })
			.mockResolvedValueOnce({ data: [{ total_cost: 0.5 }] });

		const res = await getOtterTotalCost(params);

		expect(mockedGetFilterPreviousParams).toHaveBeenCalledWith(params);
		expect(mockedDataCollector).toHaveBeenCalledTimes(2);
		expect(mockedDataCollector.mock.calls[0][0].query).toContain(
			"openlit_chat_conversation"
		);
		expect(mockedDataCollector.mock.calls[0][0].query).toContain(
			"openlit_trace_analysis"
		);
		expect(mockedDataCollector.mock.calls[0][0].query).toContain(
			"openlit_otter_runs"
		);
		expect(res).toEqual({
			data: [{ total_cost: 1.25, previous_total_cost: 0.5 }],
		});
	});

	it("returns 0 when dataCollector errors", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: null, err: new Error("fail") })
			.mockResolvedValueOnce({ data: null, err: new Error("fail") });

		const res = await getOtterTotalCost(params);

		expect(res).toEqual({
			data: [{ total_cost: 0, previous_total_cost: 0 }],
		});
	});

	it("returns 0 when data is empty or non-array", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({ data: { total_cost: 9 } as unknown as never[] });

		const res = await getOtterTotalCost(params);

		expect(res).toEqual({
			data: [{ total_cost: 0, previous_total_cost: 0 }],
		});
	});

	it("returns 0 when total_cost is missing or NaN", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [{}] })
			.mockResolvedValueOnce({ data: [{ total_cost: "not-a-number" }] });

		const res = await getOtterTotalCost(params);

		expect(res).toEqual({
			data: [{ total_cost: 0, previous_total_cost: 0 }],
		});
	});
});
