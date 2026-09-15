jest.mock("@/lib/platform/evaluation/config", () => ({
	getEvaluationConfig: jest.fn(),
}));
jest.mock("@/lib/platform/evaluation/sync-rule-entities", () => ({
	syncRuleEntitiesFromConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/posthog", () => ({
	__esModule: true,
	default: {
		fireEvent: jest.fn(),
	},
}));
jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: jest.fn(() => ({
		EVALUATION_THRESHOLD_SCORE_INVALID:
			"Threshold score must be a number between 0 and 1.",
	})),
}));
jest.mock("@/utils/json", () => ({
	jsonParse: jest.fn((v: string) => {
		try {
			return JSON.parse(v);
		} catch {
			return {};
		}
	}),
	jsonStringify: jest.fn((v: unknown) => JSON.stringify(v)),
}));
jest.mock("@/utils/asaw", () =>
	jest.fn(async (promise: Promise<any>) => {
		try {
			const result = await promise;
			return [null, result];
		} catch (err) {
			return [err, null];
		}
	})
);
jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		evaluationConfigs: {
			update: jest.fn().mockResolvedValue({}),
		},
	},
}));

import { GET, POST } from "@/app/api/evaluation/types/route";
import { getEvaluationConfig } from "@/lib/platform/evaluation/config";
import { syncRuleEntitiesFromConfig } from "@/lib/platform/evaluation/sync-rule-entities";
import prisma from "@/lib/prisma";

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

function makeRequest(body: Record<string, unknown>) {
	return {
		json: jest.fn().mockResolvedValue(body),
	} as unknown as Request;
}

function makeInvalidJsonRequest() {
	return {
		json: jest.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
	} as unknown as Request;
}

describe("GET /api/evaluation/types", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns the configured evaluation types", async () => {
		(getEvaluationConfig as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			evaluationTypes: [{ id: "hallucination", enabled: true }],
		});

		const response = await GET(undefined as any);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data).toEqual([{ id: "hallucination", enabled: true }]);
	});

	it("returns empty data with an error when config is not found", async () => {
		(getEvaluationConfig as jest.Mock).mockRejectedValue(new Error("not found"));

		const response = await GET(undefined as any);
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data).toEqual([]);
		expect(data.err).toBeDefined();
	});
});

describe("POST /api/evaluation/types", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 400 on invalid JSON body", async () => {
		const response = await POST(makeInvalidJsonRequest() as any);
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Invalid JSON body");
	});

	it("returns 400 when types is not an array", async () => {
		const response = await POST(makeRequest({ types: "not-an-array" }) as any);
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Invalid types array");
	});

	it("rejects a non-numeric thresholdScore without calling getEvaluationConfig", async () => {
		const response = await POST(
			makeRequest({
				types: [{ id: "toxicity", enabled: true, thresholdScore: "not-a-number" }],
			}) as any
		);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Threshold score must be a number between 0 and 1.");
		expect(getEvaluationConfig).not.toHaveBeenCalled();
	});

	it("returns 400 when evaluation config is not found", async () => {
		(getEvaluationConfig as jest.Mock).mockRejectedValue(new Error("not found"));

		const response = await POST(
			makeRequest({ types: [{ id: "hallucination", enabled: true }] }) as any
		);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Evaluation config not found");
	});

	it("clamps out-of-range thresholdScore values into [0, 1] and persists them", async () => {
		(getEvaluationConfig as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			meta: "{}",
		});

		const response = await POST(
			makeRequest({
				types: [
					{ id: "toxicity", enabled: true, thresholdScore: 1.5 },
					{ id: "bias", enabled: true, thresholdScore: -0.2 },
				],
			}) as any
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data).toEqual([
			expect.objectContaining({ id: "toxicity", thresholdScore: 1 }),
			expect.objectContaining({ id: "bias", thresholdScore: 0 }),
		]);
		const updateCall = (prisma.evaluationConfigs.update as jest.Mock).mock.calls[0][0];
		expect(updateCall.where).toEqual({ id: "cfg-1" });
		const persistedMeta = JSON.parse(updateCall.data.meta);
		expect(persistedMeta.evaluationTypes).toEqual([
			expect.objectContaining({ id: "toxicity", thresholdScore: 1 }),
			expect.objectContaining({ id: "bias", thresholdScore: 0 }),
		]);
		expect(syncRuleEntitiesFromConfig).toHaveBeenCalled();
	});

	it("omits thresholdScore when not provided", async () => {
		(getEvaluationConfig as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			meta: "{}",
		});

		const response = await POST(
			makeRequest({ types: [{ id: "hallucination", enabled: true }] }) as any
		);

		const data = await response.json();
		expect(data.data[0]).not.toHaveProperty("thresholdScore");
	});
});
