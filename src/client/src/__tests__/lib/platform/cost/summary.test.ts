jest.mock("@/lib/platform/llm/cost", () => ({
	getTotalCost: jest.fn(),
}));

jest.mock("@/lib/platform/evaluation/analytics", () => ({
	getEvaluationAnalytics: jest.fn(),
}));

jest.mock("@/lib/platform/openground/cost-analytics", () => ({
	getOpengroundTotalCost: jest.fn(),
}));

jest.mock("@/lib/platform/coding-agents/cost", () => ({
	getCodingAgentsTotalCost: jest.fn(),
}));

jest.mock("@/lib/platform/chat/cost", () => ({
	getOtterTotalCost: jest.fn(),
}));

import { getTotalCost } from "@/lib/platform/llm/cost";
import { getEvaluationAnalytics } from "@/lib/platform/evaluation/analytics";
import { getOpengroundTotalCost } from "@/lib/platform/openground/cost-analytics";
import { getCodingAgentsTotalCost } from "@/lib/platform/coding-agents/cost";
import { getOtterTotalCost } from "@/lib/platform/chat/cost";
import { getCostSummary } from "@/lib/platform/cost/summary";

const mockedGetTotalCost = getTotalCost as jest.MockedFunction<typeof getTotalCost>;
const mockedGetEvaluationAnalytics =
	getEvaluationAnalytics as jest.MockedFunction<typeof getEvaluationAnalytics>;
const mockedGetOpengroundTotalCost =
	getOpengroundTotalCost as jest.MockedFunction<typeof getOpengroundTotalCost>;
const mockedGetCodingAgentsTotalCost =
	getCodingAgentsTotalCost as jest.MockedFunction<
		typeof getCodingAgentsTotalCost
	>;
const mockedGetOtterTotalCost = getOtterTotalCost as jest.MockedFunction<
	typeof getOtterTotalCost
>;

const params = {
	timeLimit: {
		start: new Date("2024-01-01"),
		end: new Date("2024-01-02"),
		type: "custom",
	},
};

describe("getCostSummary", () => {
	beforeEach(() => {
		mockedGetTotalCost.mockReset();
		mockedGetEvaluationAnalytics.mockReset();
		mockedGetOpengroundTotalCost.mockReset();
		mockedGetCodingAgentsTotalCost.mockReset();
		mockedGetOtterTotalCost.mockReset();
	});

	it("sums llm, coding agents, otter, evaluations, and openground costs", async () => {
		mockedGetTotalCost.mockResolvedValue({
			data: [{ total_usage_cost: 1.5, previous_total_usage_cost: 1 }],
		});
		mockedGetCodingAgentsTotalCost.mockResolvedValue({
			data: [{ total_cost: 0.4, previous_total_cost: 0.2 }],
		});
		mockedGetOtterTotalCost.mockResolvedValue({
			data: [{ total_cost: 0.1, previous_total_cost: 0.05 }],
		});
		mockedGetEvaluationAnalytics.mockResolvedValue({
			configured: true,
			data: [{ total_cost: 0.25, previous_total_cost: 0.1 }],
		} as Awaited<ReturnType<typeof getEvaluationAnalytics>>);
		mockedGetOpengroundTotalCost.mockResolvedValue({
			data: [{ total_cost: 0.75, previous_total_cost: 0.5 }],
		});

		const res = await getCostSummary(params);

		expect(res.data[0]).toEqual({
			total_platform_cost: 3.0,
			previous_total_platform_cost: 1.85,
			llm_cost: 1.5,
			previous_llm_cost: 1,
			coding_agents_cost: 0.4,
			previous_coding_agents_cost: 0.2,
			otter_cost: 0.1,
			previous_otter_cost: 0.05,
			evaluations_cost: 0.25,
			previous_evaluations_cost: 0.1,
			openground_cost: 0.75,
			previous_openground_cost: 0.5,
		});
	});

	it("zeros every bucket when data rows are empty", async () => {
		mockedGetTotalCost.mockResolvedValue({ data: [] });
		mockedGetCodingAgentsTotalCost.mockResolvedValue({ data: [] });
		mockedGetOtterTotalCost.mockResolvedValue({ data: [] });
		mockedGetEvaluationAnalytics.mockResolvedValue({
			configured: true,
			data: [],
		} as Awaited<ReturnType<typeof getEvaluationAnalytics>>);
		mockedGetOpengroundTotalCost.mockResolvedValue({ data: [] });

		const res = await getCostSummary(params);

		expect(res.data[0]).toEqual({
			total_platform_cost: 0,
			previous_total_platform_cost: 0,
			llm_cost: 0,
			previous_llm_cost: 0,
			coding_agents_cost: 0,
			previous_coding_agents_cost: 0,
			otter_cost: 0,
			previous_otter_cost: 0,
			evaluations_cost: 0,
			previous_evaluations_cost: 0,
			openground_cost: 0,
			previous_openground_cost: 0,
		});
	});

	it("treats missing and NaN cost fields as zero", async () => {
		mockedGetTotalCost.mockResolvedValue({
			data: [{ total_usage_cost: "bad", previous_total_usage_cost: undefined }],
		});
		mockedGetCodingAgentsTotalCost.mockResolvedValue({
			data: [{ total_cost: null, previous_total_cost: Number.NaN }],
		});
		mockedGetOtterTotalCost.mockResolvedValue({
			data: [{} as { total_cost: number; previous_total_cost: number }],
		});
		mockedGetEvaluationAnalytics.mockResolvedValue({
			configured: true,
			data: [{ total_cost: "" as unknown as number, previous_total_cost: "x" as unknown as number }],
		} as unknown as Awaited<ReturnType<typeof getEvaluationAnalytics>>);
		mockedGetOpengroundTotalCost.mockResolvedValue({
			data: [{ total_cost: 0, previous_total_cost: false as unknown as number }],
		});

		const res = await getCostSummary(params);

		expect(res.data[0].total_platform_cost).toBe(0);
		expect(res.data[0].previous_total_platform_cost).toBe(0);
		expect(res.data[0].llm_cost).toBe(0);
		expect(res.data[0].coding_agents_cost).toBe(0);
		expect(res.data[0].otter_cost).toBe(0);
		expect(res.data[0].evaluations_cost).toBe(0);
		expect(res.data[0].openground_cost).toBe(0);
	});

	it("falls back when firstRow data is non-array or non-object", async () => {
		mockedGetTotalCost.mockResolvedValue({
			data: null as unknown as never[],
		});
		mockedGetCodingAgentsTotalCost.mockResolvedValue({
			data: [null] as unknown as never[],
		});
		mockedGetOtterTotalCost.mockResolvedValue({
			data: ["not-an-object"] as unknown as never[],
		});
		mockedGetEvaluationAnalytics.mockResolvedValue({
			configured: false,
			data: undefined as unknown as never[],
		} as Awaited<ReturnType<typeof getEvaluationAnalytics>>);
		mockedGetOpengroundTotalCost.mockResolvedValue({
			data: { total_cost: 99 } as unknown as never[],
		});

		const res = await getCostSummary(params);

		expect(res.data[0]).toEqual({
			total_platform_cost: 0,
			previous_total_platform_cost: 0,
			llm_cost: 0,
			previous_llm_cost: 0,
			coding_agents_cost: 0,
			previous_coding_agents_cost: 0,
			otter_cost: 0,
			previous_otter_cost: 0,
			evaluations_cost: 0,
			previous_evaluations_cost: 0,
			openground_cost: 0,
			previous_openground_cost: 0,
		});
	});
});
