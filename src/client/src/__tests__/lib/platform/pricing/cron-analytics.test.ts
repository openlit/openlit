jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));

jest.mock("@/helpers/server/platform", () => ({
	getFilterPreviousParams: jest.fn((params) => ({
		...params,
		timeLimit: {
			...params.timeLimit,
			start: "2024-01-01T00:00:00.000Z",
			end: "2024-01-01T12:00:00.000Z",
		},
	})),
}));

import { dataCollector } from "@/lib/platform/common";
import { getPricingCronAnalytics } from "@/lib/platform/pricing/cron-analytics";

const mockedDataCollector = dataCollector as jest.MockedFunction<
	typeof dataCollector
>;

const params = {
	timeLimit: {
		start: "2024-01-01T12:00:00.000Z",
		end: "2024-01-02T12:00:00.000Z",
		type: "24H",
	},
};

describe("getPricingCronAnalytics", () => {
	beforeEach(() => {
		mockedDataCollector.mockReset();
	});

	it("returns summary stats and recent runs with costs applied", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({
				data: [
					{
						totalRuns: 4,
						successfulRuns: 3,
						totalUpdated: 12,
						totalSpans: 40,
					},
				],
			})
			.mockResolvedValueOnce({
				data: [
					{
						totalRuns: 2,
						successfulRuns: 2,
						totalUpdated: 5,
						totalSpans: 20,
					},
				],
			})
			.mockResolvedValueOnce({
				data: [
					{
						startedAt: "2024-01-02 10:00:00",
						finishedAt: "2024-01-02 10:00:05",
						duration: 5,
						runStatus: "SUCCESS",
						totalSpans: 10,
						totalUpdated: 4,
						totalFailed: 0,
						totalSkipped: 6,
					},
				],
			});

		const res = await getPricingCronAnalytics(params);

		expect(res.data[0]).toEqual({
			total_runs: 4,
			previous_total_runs: 2,
			successful_runs: 3,
			previous_successful_runs: 2,
			total_updated: 12,
			previous_total_updated: 5,
			total_spans: 40,
			previous_total_spans: 20,
		});
		expect(res.runs).toHaveLength(1);
		expect(res.runs[0].totalUpdated).toBe(4);
		expect(mockedDataCollector.mock.calls[2][0].query).toContain(
			"totalUpdated"
		);
	});
});
