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

	it("clamps the limit between 1 and 100 and defaults to 25", async () => {
		mockedDataCollector.mockResolvedValue({ data: [{}] });

		await getPricingCronAnalytics(params, { limit: 500 });
		expect(mockedDataCollector.mock.calls[2][0].query).toContain("LIMIT 100");

		mockedDataCollector.mockClear();
		mockedDataCollector.mockResolvedValue({ data: [{}] });
		await getPricingCronAnalytics(params, { limit: 0 });
		expect(mockedDataCollector.mock.calls[2][0].query).toContain("LIMIT 1");

		mockedDataCollector.mockClear();
		mockedDataCollector.mockResolvedValue({ data: [{}] });
		await getPricingCronAnalytics(params);
		expect(mockedDataCollector.mock.calls[2][0].query).toContain("LIMIT 25");
	});

	it("returns zeroed summaries and surfaces the error when the current period query fails", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ err: "clickhouse down", data: [] })
			.mockResolvedValueOnce({ data: [{ totalRuns: 1, successfulRuns: 1, totalUpdated: 1, totalSpans: 1 }] })
			.mockResolvedValueOnce({ data: [] });

		const res = await getPricingCronAnalytics(params);

		expect(res.data[0]).toEqual(
			expect.objectContaining({
				total_runs: 0,
				successful_runs: 0,
				total_updated: 0,
				total_spans: 0,
			})
		);
		expect(res.err).toBe("clickhouse down");
	});

	it("surfaces the error from the previous period query when only it fails", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [{ totalRuns: 2, successfulRuns: 2, totalUpdated: 2, totalSpans: 2 }] })
			.mockResolvedValueOnce({ err: "previous failed", data: [] })
			.mockResolvedValueOnce({ data: [] });

		const res = await getPricingCronAnalytics(params);

		expect(res.data[0].previous_total_runs).toBe(0);
		expect(res.err).toBe("previous failed");
	});

	it("surfaces the runs-query error when both summaries succeed", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [{ totalRuns: 1, successfulRuns: 1, totalUpdated: 1, totalSpans: 1 }] })
			.mockResolvedValueOnce({ data: [{ totalRuns: 1, successfulRuns: 1, totalUpdated: 1, totalSpans: 1 }] })
			.mockResolvedValueOnce({ err: "runs query failed", data: [] });

		const res = await getPricingCronAnalytics(params);

		expect(res.runs).toEqual([]);
		expect(res.err).toBe("runs query failed");
	});

	it("defaults missing numeric fields to 0 and handles an empty runs result set", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [{}] })
			.mockResolvedValueOnce({ data: [{}] })
			.mockResolvedValueOnce({ data: undefined });

		const res = await getPricingCronAnalytics(params);

		expect(res.data[0]).toEqual({
			total_runs: 0,
			previous_total_runs: 0,
			successful_runs: 0,
			previous_successful_runs: 0,
			total_updated: 0,
			previous_total_updated: 0,
			total_spans: 0,
			previous_total_spans: 0,
		});
		expect(res.runs).toEqual([]);
		expect(res.err).toBeUndefined();
	});

	it("coerces non-finite row fields (missing startedAt/duration) to safe defaults", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [{}] })
			.mockResolvedValueOnce({ data: [{}] })
			.mockResolvedValueOnce({
				data: [
					{
						duration: "not-a-number",
						totalSpans: undefined,
					},
				],
			});

		const res = await getPricingCronAnalytics(params);

		expect(res.runs[0]).toEqual({
			startedAt: "",
			finishedAt: "",
			duration: 0,
			runStatus: "",
			totalSpans: 0,
			totalUpdated: 0,
			totalFailed: 0,
			totalSkipped: 0,
		});
	});

	it("treats a non-array summary data payload as an empty row", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: undefined })
			.mockResolvedValueOnce({ data: [{}] })
			.mockResolvedValueOnce({ data: [] });

		const res = await getPricingCronAnalytics(params);

		expect(res.data[0].total_runs).toBe(0);
	});
});
