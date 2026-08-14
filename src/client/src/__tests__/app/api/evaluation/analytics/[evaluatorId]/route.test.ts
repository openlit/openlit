jest.mock("@/lib/platform/evaluation/analytics", () => ({
	getEvaluationEvaluatorAnalytics: jest.fn(),
}));

jest.mock("@/helpers/server/platform", () => ({
	validateMetricsRequest: jest.fn(),
	validateMetricsRequestType: {
		GET_EVALUATION_ANALYTICS: "GET_EVALUATION_ANALYTICS",
	},
}));

class TestResponse {
	status: number;
	private body: unknown;

	constructor(body?: unknown, init?: { status?: number }) {
		this.body = body;
		this.status = init?.status ?? 200;
	}

	static json(body: unknown, init?: { status?: number }) {
		return new TestResponse(body, init);
	}

	async json() {
		return this.body;
	}
}

(global as any).Response = TestResponse;

import { POST } from "@/app/api/evaluation/analytics/[evaluatorId]/route";
import { getEvaluationEvaluatorAnalytics } from "@/lib/platform/evaluation/analytics";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

function makeRequest(body: unknown) {
	return {
		json: async () => body,
	} as any;
}

describe("POST /api/evaluation/analytics/[evaluatorId]", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 400 for invalid JSON", async () => {
		const request = {
			json: async () => {
				throw new Error("bad json");
			},
		} as any;

		const res = await POST(request, { params: { evaluatorId: "bias" } });
		expect(res.status).toBe(400);
		expect(await res.json()).toBe("Invalid JSON body");
	});

	it("returns 400 when evaluator id is missing", async () => {
		const res = await POST(makeRequest({ timeLimit: {} }), {
			params: { evaluatorId: "  " },
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toBe("Evaluator id missing!");
	});

	it("returns 400 when validation fails", async () => {
		(validateMetricsRequest as jest.Mock).mockReturnValue({
			success: false,
			err: "Start date or End date missing!",
		});

		const res = await POST(makeRequest({}), {
			params: { evaluatorId: "bias" },
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toBe("Start date or End date missing!");
		expect(validateMetricsRequest).toHaveBeenCalledWith(
			expect.objectContaining({ timeLimit: undefined }),
			validateMetricsRequestType.GET_EVALUATION_ANALYTICS
		);
	});

	it("returns 404 when evaluator is not found", async () => {
		(validateMetricsRequest as jest.Mock).mockReturnValue({ success: true });
		(getEvaluationEvaluatorAnalytics as jest.Mock).mockResolvedValue({
			configured: true,
			found: false,
		});

		const res = await POST(
			makeRequest({
				timeLimit: { start: "2024-01-01", end: "2024-01-02", type: "24H" },
			}),
			{ params: { evaluatorId: "unknown" } }
		);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ configured: true, found: false });
	});

	it("returns evaluator analytics on success", async () => {
		(validateMetricsRequest as jest.Mock).mockReturnValue({ success: true });
		(getEvaluationEvaluatorAnalytics as jest.Mock).mockResolvedValue({
			configured: true,
			found: true,
			evaluator: { id: "bias", label: "Bias", enabled: true },
			data: [{ executions: 10 }],
			timeseries: [],
			recentResults: [],
		});

		const res = await POST(
			makeRequest({
				timeLimit: { start: "2024-01-01", end: "2024-01-02", type: "24H" },
			}),
			{ params: { evaluatorId: "bias" } }
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.found).toBe(true);
		expect(body.evaluator.id).toBe("bias");
		expect(getEvaluationEvaluatorAnalytics).toHaveBeenCalledWith(
			expect.objectContaining({
				timeLimit: expect.objectContaining({ start: "2024-01-01" }),
			}),
			"bias"
		);
	});
});
