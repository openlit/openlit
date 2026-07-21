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
});
