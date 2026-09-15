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

import { PATCH } from "@/app/api/evaluation/types/[id]/route";
import { getEvaluationConfig } from "@/lib/platform/evaluation/config";
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

describe("PATCH /api/evaluation/types/[id]", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 400 on invalid JSON body", async () => {
		const response = await PATCH(makeInvalidJsonRequest() as any, {
			params: { id: "toxicity" },
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Invalid JSON body");
	});

	it("rejects a non-numeric thresholdScore without calling getEvaluationConfig", async () => {
		const response = await PATCH(
			makeRequest({ thresholdScore: "not-a-number" }) as any,
			{ params: { id: "toxicity" } }
		);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Threshold score must be a number between 0 and 1.");
		expect(getEvaluationConfig).not.toHaveBeenCalled();
	});

	it("returns 400 when evaluation config is not found", async () => {
		(getEvaluationConfig as jest.Mock).mockRejectedValue(new Error("not found"));

		const response = await PATCH(makeRequest({ enabled: true }) as any, {
			params: { id: "toxicity" },
		});

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Evaluation config not found");
	});

	it("clamps an out-of-range thresholdScore and persists it for an existing type", async () => {
		(getEvaluationConfig as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			meta: JSON.stringify({
				evaluationTypes: [{ id: "toxicity", enabled: true, rules: [] }],
			}),
		});

		const response = await PATCH(
			makeRequest({ thresholdScore: 1.5 }) as any,
			{ params: { id: "toxicity" } }
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data.thresholdScore).toBe(1);

		const updateCall = (prisma.evaluationConfigs.update as jest.Mock).mock.calls[0][0];
		const persistedMeta = JSON.parse(updateCall.data.meta);
		expect(persistedMeta.evaluationTypes[0]).toMatchObject({
			id: "toxicity",
			thresholdScore: 1,
		});
	});

	it("preserves the existing thresholdScore when the body omits it", async () => {
		(getEvaluationConfig as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			meta: JSON.stringify({
				evaluationTypes: [
					{ id: "toxicity", enabled: true, rules: [], thresholdScore: 0.8 },
				],
			}),
		});

		const response = await PATCH(makeRequest({ enabled: false }) as any, {
			params: { id: "toxicity" },
		});

		const data = await response.json();
		expect(data.data.thresholdScore).toBe(0.8);
	});

	it("clears the existing thresholdScore when the body sends null", async () => {
		(getEvaluationConfig as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			meta: JSON.stringify({
				evaluationTypes: [
					{ id: "toxicity", enabled: true, rules: [], thresholdScore: 0.8 },
				],
			}),
		});

		const response = await PATCH(
			makeRequest({ thresholdScore: null }) as any,
			{ params: { id: "toxicity" } }
		);

		const data = await response.json();
		expect(data.data.thresholdScore).toBeUndefined();
	});
});
