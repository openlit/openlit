jest.mock("@/lib/platform/evaluation/config", () => ({
	getEvaluationConfig: jest.fn(),
}));

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
	dateTruncGroupingLogic: jest.fn(() => "hour"),
}));

jest.mock("@/utils/asaw", () => jest.fn());

import asaw from "@/utils/asaw";
import { dataCollector } from "@/lib/platform/common";
import { getEvaluationConfig } from "@/lib/platform/evaluation/config";
import {
	getEvaluationAnalytics,
	getEvaluationAnalyticsSummary,
	getEvaluationAnalyticsByType,
} from "@/lib/platform/evaluation/analytics";

const params = {
	timeLimit: {
		start: "2024-01-01T12:00:00.000Z",
		end: "2024-01-02T12:00:00.000Z",
		type: "24H",
	},
};

describe("evaluation analytics", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns configured:false when evaluation config is missing", async () => {
		(asaw as jest.Mock).mockResolvedValue(["not found", null]);

		const result = await getEvaluationAnalytics(params as any);
		expect(result).toEqual({ configured: false });
		expect(dataCollector).not.toHaveBeenCalled();
	});

	it("aggregates summary metrics from clickhouse rows", async () => {
		(asaw as jest.Mock).mockResolvedValue([
			null,
			{
				id: "cfg-1",
				evaluationTypes: [
					{ id: "hallucination", enabled: true, label: "Hallucination" },
					{ id: "bias", enabled: false, label: "Bias" },
				],
			},
		]);
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [
					{
						tracesEvaluated: 5,
						executions: 8,
						totalCost: 0.12,
						avgPassRate: 75,
						failedScores: 3,
					},
				],
			})
			.mockResolvedValueOnce({
				data: [
					{
						tracesEvaluated: 2,
						executions: 4,
						totalCost: 0.05,
						avgPassRate: 50,
						failedScores: 1,
					},
				],
			});

		const result = await getEvaluationAnalyticsSummary(params as any);
		expect(result.err).toBeUndefined();
		expect(result.data).toMatchObject({
			tracesEvaluated: 5,
			executions: 8,
			totalCost: 0.12,
			avgPassRate: 75,
			failedScores: 3,
			previous_tracesEvaluated: 2,
			evaluations: 2,
			active: 1,
		});

		const firstQuery = (dataCollector as jest.Mock).mock.calls[0][0].query as string;
		expect(firstQuery).toContain("evaluationData.evaluation IN");
		expect(firstQuery).toContain("'hallucination'");
		expect(firstQuery).toContain("'Hallucination'");
	});

	it("maps by-type rows with previous pass rates", async () => {
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [
					{
						evaluation: "hallucination",
						executions: 10,
						passRate: 80,
						failedScores: 2,
					},
				],
			})
			.mockResolvedValueOnce({
				data: [
					{
						evaluation: "hallucination",
						executions: 5,
						passRate: 70,
						failedScores: 1,
					},
				],
			});

		const result = await getEvaluationAnalyticsByType(params as any);
		expect(result.data?.[0]).toMatchObject({
			evaluation: "hallucination",
			executions: 10,
			passRate: 80,
			previousPassRate: 70,
		});
	});

	it("returns full analytics when configured", async () => {
		(asaw as jest.Mock).mockResolvedValue([
			null,
			{ id: "cfg-1", evaluationTypes: [{ id: "hallucination", enabled: true }] },
		]);
		(getEvaluationConfig as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			evaluationTypes: [{ id: "hallucination", enabled: true }],
		});
		(dataCollector as jest.Mock).mockResolvedValue({ data: [] });

		const result = await getEvaluationAnalytics(params as any);
		expect(result.configured).toBe(true);
		expect(result.data?.[0]).toMatchObject({
			traces_evaluated: expect.any(Number),
			executions: expect.any(Number),
		});
		expect(result.timeseries).toEqual([]);
		expect(result.byType).toEqual([]);
	});
});
