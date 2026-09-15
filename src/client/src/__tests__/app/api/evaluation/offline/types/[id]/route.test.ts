jest.mock("@/lib/platform/api-keys", () => ({
	getAPIKeyInfo: jest.fn(),
}));
jest.mock("@/lib/platform/evaluation/config", () => ({
	getEvaluationConfigByDbConfigId: jest.fn(),
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
		NO_API_KEY: "No API key provided",
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

import { PATCH, OPTIONS } from "@/app/api/evaluation/offline/types/[id]/route";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getEvaluationConfigByDbConfigId } from "@/lib/platform/evaluation/config";
import prisma from "@/lib/prisma";

class TestHeaders {
	private values = new Map<string, string>();

	constructor(headers?: Record<string, string>) {
		Object.entries(headers || {}).forEach(([key, value]) => {
			this.values.set(key.toLowerCase(), value);
		});
	}

	get(key: string) {
		return this.values.get(key.toLowerCase()) ?? null;
	}
}

class TestResponse {
	status: number;
	headers: TestHeaders;
	private body: unknown;

	constructor(
		body?: unknown,
		init?: { status?: number; headers?: Record<string, string> }
	) {
		this.body = body;
		this.status = init?.status ?? 200;
		this.headers = new TestHeaders(init?.headers);
	}

	static json(
		body: unknown,
		init?: { status?: number; headers?: Record<string, string> }
	) {
		return new TestResponse(body, init);
	}

	async json() {
		return this.body;
	}
}

(global as any).Response = TestResponse;

function makeRequest({
	authorization = "Bearer openlit-test-key",
	body = {},
}: {
	authorization?: string;
	body?: Record<string, unknown>;
} = {}) {
	return {
		headers: {
			get: (key: string) => {
				if (key.toLowerCase() === "authorization") return authorization;
				return null;
			},
		},
		json: jest.fn().mockResolvedValue(body),
	} as unknown as Request;
}

function makeInvalidJsonRequest(authorization = "Bearer openlit-test-key") {
	return {
		headers: {
			get: (key: string) => (key.toLowerCase() === "authorization" ? authorization : null),
		},
		json: jest.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
	} as unknown as Request;
}

describe("PATCH /api/evaluation/offline/types/[id]", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 401 when no Bearer token is provided", async () => {
		const response = await PATCH(makeRequest({ authorization: "" }), {
			params: { id: "toxicity" },
		});
		expect(response.status).toBe(401);
	});

	it("returns 401 when API key is invalid", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([new Error("Not found"), null]);
		const response = await PATCH(makeRequest({ body: { enabled: true } }), {
			params: { id: "toxicity" },
		});
		expect(response.status).toBe(401);
	});

	it("returns 400 on invalid JSON body", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		const response = await PATCH(makeInvalidJsonRequest(), {
			params: { id: "toxicity" },
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Invalid JSON body");
	});

	it("rejects a non-numeric thresholdScore without calling getEvaluationConfigByDbConfigId", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		const response = await PATCH(
			makeRequest({ body: { thresholdScore: "bad" } }),
			{ params: { id: "toxicity" } }
		);
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Threshold score must be a number between 0 and 1.");
		expect(getEvaluationConfigByDbConfigId).not.toHaveBeenCalled();
	});

	it("returns 400 when evaluation config is not found", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		(getEvaluationConfigByDbConfigId as jest.Mock).mockRejectedValue(new Error("not found"));

		const response = await PATCH(makeRequest({ body: { enabled: true } }), {
			params: { id: "toxicity" },
		});
		expect(response.status).toBe(400);
	});

	it("scopes the update to the API key's own database config and clamps thresholdScore", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		(getEvaluationConfigByDbConfigId as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			meta: JSON.stringify({
				evaluationTypes: [{ id: "toxicity", enabled: true, rules: [] }],
			}),
		});

		const response = await PATCH(
			makeRequest({ body: { thresholdScore: 1.5 } }),
			{ params: { id: "toxicity" } }
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data.thresholdScore).toBe(1);
		expect(getEvaluationConfigByDbConfigId).toHaveBeenCalledWith("db-1", true);

		const updateCall = (prisma.evaluationConfigs.update as jest.Mock).mock.calls[0][0];
		expect(updateCall.where).toEqual({ id: "cfg-1" });
		const persistedMeta = JSON.parse(updateCall.data.meta);
		expect(persistedMeta.evaluationTypes[0]).toMatchObject({
			id: "toxicity",
			thresholdScore: 1,
		});
	});

	it("creates a new type entry when the id doesn't already exist", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		(getEvaluationConfigByDbConfigId as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			meta: JSON.stringify({ evaluationTypes: [] }),
		});

		const response = await PATCH(
			makeRequest({
				body: { isCustom: true, label: "Custom Check", enabled: true },
			}),
			{ params: { id: "custom_check" } }
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data).toMatchObject({
			id: "custom_check",
			isCustom: true,
			label: "Custom Check",
			enabled: true,
		});
	});
});

describe("OPTIONS /api/evaluation/offline/types/[id]", () => {
	it("allows PATCH and OPTIONS", async () => {
		const response = await OPTIONS();
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
	});
});
