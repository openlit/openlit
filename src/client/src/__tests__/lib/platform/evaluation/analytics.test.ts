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
	getEvaluationAnalyticsTimeseries,
	getEvaluationEvaluatorAnalytics,
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

	it("maps timeseries rows and surfaces collector errors", async () => {
		(asaw as jest.Mock).mockResolvedValue([
			null,
			{
				id: "cfg-1",
				evaluationTypes: [{ id: "hallucination", enabled: true, label: "Hallucination" }],
			},
		]);
		(dataCollector as jest.Mock).mockResolvedValueOnce({
			data: [{ timestamp: "2024/01/01 12:00", executions: "4", passRate: "90" }],
		});

		const ok = await getEvaluationAnalyticsTimeseries(params as any);
		expect(ok.err).toBeUndefined();
		expect(ok.data).toEqual([
			{ timestamp: "2024/01/01 12:00", executions: 4, passRate: 90 },
		]);
		expect((dataCollector as jest.Mock).mock.calls[0][0].query).toContain(
			"DATE_TRUNC('hour'"
		);

		(dataCollector as jest.Mock).mockResolvedValueOnce({
			err: new Error("timeseries failed"),
			data: [],
		});
		const failed = await getEvaluationAnalyticsTimeseries(params as any);
		expect(failed.err).toEqual(expect.any(Error));
	});

	it("returns evaluator analytics for a configured type", async () => {
		(asaw as jest.Mock).mockResolvedValue([
			null,
			{
				id: "cfg-1",
				evaluationTypes: [
					{
						id: "hallucination",
						label: "Hallucination",
						enabled: true,
						description: "Detects hallucinations",
					},
				],
			},
		]);
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [
					{
						executions: 8,
						totalCost: 0.2,
						avgPassRate: 75,
						failedScores: 2,
						tracesEvaluated: 5,
					},
				],
			})
			.mockResolvedValueOnce({
				data: [
					{
						executions: 3,
						totalCost: 0.1,
						avgPassRate: 50,
						failedScores: 1,
						tracesEvaluated: 2,
					},
				],
			})
			.mockResolvedValueOnce({
				data: [{ timestamp: "2024/01/01 12:00", executions: 2, passRate: 80 }],
			})
			.mockResolvedValueOnce({
				data: [
					{
						id: "run-1",
						spanId: "span-1",
						createdAt: "2024-01-01T12:00:00.000Z",
						verdict: "no",
						score: 0.9,
						classification: "pass",
						explanation: "ok",
						source: "auto",
						cost: 0.01,
					},
				],
			});

		const result = await getEvaluationEvaluatorAnalytics(
			params as any,
			"hallucination"
		);
		expect(result).toMatchObject({
			configured: true,
			found: true,
			evaluator: {
				id: "hallucination",
				label: "Hallucination",
				enabled: true,
			},
			data: [
				{
					executions: 8,
					previous_executions: 3,
					avg_pass_rate: 75,
					previous_avg_pass_rate: 50,
					failed_scores: 2,
					previous_failed_scores: 1,
					total_cost: 0.2,
					previous_total_cost: 0.1,
					traces_evaluated: 5,
					previous_traces_evaluated: 2,
				},
			],
			timeseries: [{ timestamp: "2024/01/01 12:00", executions: 2, passRate: 80 }],
			recentResults: [
				expect.objectContaining({
					id: "run-1",
					spanId: "span-1",
					verdict: "no",
					score: 0.9,
					source: "auto",
				}),
			],
		});
	});

	it("handles missing evaluator config and collector errors", async () => {
		(asaw as jest.Mock).mockResolvedValueOnce(["missing", null]);
		await expect(
			getEvaluationEvaluatorAnalytics(params as any, "hallucination")
		).resolves.toEqual({ configured: false, found: false });

		(asaw as jest.Mock).mockResolvedValueOnce([
			null,
			{ id: "cfg-1", evaluationTypes: [{ id: "hallucination", enabled: true }] },
		]);
		await expect(
			getEvaluationEvaluatorAnalytics(params as any, "not-a-real-evaluator")
		).resolves.toEqual({ configured: true, found: false });

		(asaw as jest.Mock).mockResolvedValue([
			null,
			{ id: "cfg-1", evaluationTypes: [{ id: "hallucination", enabled: true }] },
		]);
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ err: new Error("summary failed"), data: [] })
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({ data: [] });

		const errored = await getEvaluationEvaluatorAnalytics(
			params as any,
			"hallucination"
		);
		expect(errored).toMatchObject({
			configured: true,
			found: true,
			data: [],
			timeseries: [],
			recentResults: [],
		});
	});

	it("falls back to built-in evaluation types when config types are empty", async () => {
		(asaw as jest.Mock).mockResolvedValue([
			null,
			{ id: "cfg-1", evaluationTypes: [] },
		]);
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [{}] })
			.mockResolvedValueOnce({ data: [{}] });

		const result = await getEvaluationAnalyticsSummary(params as any);
		expect(result.err).toBeUndefined();
		expect(result.data?.evaluations).toBeGreaterThan(0);
		expect(result.data?.active).toBe(0);
		const query = (dataCollector as jest.Mock).mock.calls[0][0].query as string;
		expect(query).toContain("evaluationData.evaluation IN");
	});

	it("uses 1 = 0 when all configured evaluator ids are empty", async () => {
		(asaw as jest.Mock).mockResolvedValue([
			null,
			{ id: "cfg-1", evaluationTypes: [{ id: "", label: "Broken" }] },
		]);
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [{}] })
			.mockResolvedValueOnce({ data: [{}] });

		await getEvaluationAnalyticsSummary(params as any);
		const query = (dataCollector as jest.Mock).mock.calls[0][0].query as string;
		expect(query).toContain("1 = 0");
	});

	it("surfaces summary and by-type collector errors", async () => {
		(asaw as jest.Mock).mockResolvedValue([
			null,
			{ id: "cfg-1", evaluationTypes: [{ id: "hallucination", enabled: true }] },
		]);
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ err: new Error("current failed"), data: [] })
			.mockResolvedValueOnce({ data: [] });
		await expect(getEvaluationAnalyticsSummary(params as any)).resolves.toEqual({
			err: expect.any(Error),
		});

		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({ err: new Error("previous failed"), data: [] });
		await expect(getEvaluationAnalyticsSummary(params as any)).resolves.toEqual({
			err: expect.any(Error),
		});

		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ err: new Error("by-type failed"), data: [] })
			.mockResolvedValueOnce({ data: [] });
		await expect(getEvaluationAnalyticsByType(params as any)).resolves.toEqual({
			err: expect.any(Error),
		});

		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [{ evaluation: "x", executions: 1, passRate: 50 }] })
			.mockResolvedValueOnce({ err: new Error("prev by-type"), data: [] });
		await expect(getEvaluationAnalyticsByType(params as any)).resolves.toEqual({
			err: expect.any(Error),
		});
	});

	it("fills analytics defaults when summary data is missing", async () => {
		(asaw as jest.Mock).mockResolvedValue([
			null,
			{ id: "cfg-1", evaluationTypes: [{ id: "hallucination", enabled: true }] },
		]);
		(dataCollector as jest.Mock).mockResolvedValue({ data: [] });

		const result = await getEvaluationAnalytics(params as any);
		expect(result.configured).toBe(true);
		expect(result.data?.[0]).toMatchObject({
			evaluations: expect.any(Number),
			active: expect.any(Number),
			traces_evaluated: expect.any(Number),
			executions: expect.any(Number),
		});
		expect(Array.isArray(result.timeseries)).toBe(true);
		expect(Array.isArray(result.byType)).toBe(true);
	});

	it("resolves built-in-only evaluators and empty recent source", async () => {
		(asaw as jest.Mock).mockResolvedValue([
			null,
			{ id: "cfg-1", evaluationTypes: [] },
		]);
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({
				data: [
					{
						executions: 1,
						totalCost: 0,
						avgPassRate: 100,
						failedScores: 0,
						tracesEvaluated: 1,
					},
				],
			})
			.mockResolvedValueOnce({ data: [{}] })
			.mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce({
				data: [
					{
						id: "run-2",
						spanId: "span-2",
						createdAt: "2024-01-01T12:00:00.000Z",
						verdict: "yes",
						score: 0.1,
						classification: "fail",
						explanation: "bad",
						source: "",
						cost: 0,
					},
				],
			});

		const result = await getEvaluationEvaluatorAnalytics(
			params as any,
			"hallucination"
		);
		expect(result.found).toBe(true);
		expect(result.evaluator?.id).toBe("hallucination");
		expect(result.evaluator?.label).toBeTruthy();
		expect(result.recentResults?.[0].source).toBeUndefined();
	});

	it("escapes quotes in evaluator name variants", async () => {
		(asaw as jest.Mock).mockResolvedValue([
			null,
			{
				id: "cfg-1",
				evaluationTypes: [{ id: "custom", label: "O'Brien Judge", enabled: true }],
			},
		]);
		(dataCollector as jest.Mock)
			.mockResolvedValueOnce({ data: [{}] })
			.mockResolvedValueOnce({ data: [{}] });

		await getEvaluationAnalyticsSummary(params as any);
		const query = (dataCollector as jest.Mock).mock.calls[0][0].query as string;
		expect(query).toContain("O\\'Brien Judge");
	});
});
