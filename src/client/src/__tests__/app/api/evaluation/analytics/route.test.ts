jest.mock("@/lib/platform/evaluation/analytics", () => ({
	getEvaluationAnalytics: jest.fn(),
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

import { POST } from "@/app/api/evaluation/analytics/route";
import { getEvaluationAnalytics } from "@/lib/platform/evaluation/analytics";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";

function makeRequest(body: unknown) {
	return {
		json: async () => body,
	} as any;
}

describe("POST /api/evaluation/analytics", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 400 for invalid JSON", async () => {
		const request = {
			json: async () => {
				throw new Error("bad json");
			},
		} as any;

		const res = await POST(request);
		expect(res.status).toBe(400);
		expect(await res.json()).toBe("Invalid JSON body");
	});

	it("returns 400 when timeLimit is missing", async () => {
		(validateMetricsRequest as jest.Mock).mockReturnValue({
			success: false,
			err: "Start date or End date missing!",
		});

		const res = await POST(makeRequest({}));
		expect(res.status).toBe(400);
		expect(await res.json()).toBe("Start date or End date missing!");
		expect(validateMetricsRequest).toHaveBeenCalledWith(
			expect.objectContaining({ timeLimit: undefined }),
			validateMetricsRequestType.GET_EVALUATION_ANALYTICS
		);
	});

	it("returns analytics payload on success", async () => {
		(validateMetricsRequest as jest.Mock).mockReturnValue({ success: true });
		(getEvaluationAnalytics as jest.Mock).mockResolvedValue({
			configured: true,
			summary: {
				evaluations: 8,
				active: 3,
				tracesEvaluated: 10,
				executions: 12,
				totalCost: 0.05,
				avgPassRate: 80,
				failedScores: 2,
			},
			timeseries: [],
			byType: [],
		});

		const body = {
			timeLimit: {
				start: "2024-01-01",
				end: "2024-01-02",
				type: "24H",
			},
		};
		const res = await POST(makeRequest(body));
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.configured).toBe(true);
		expect(json.summary.tracesEvaluated).toBe(10);
		expect(getEvaluationAnalytics).toHaveBeenCalled();
	});
});
