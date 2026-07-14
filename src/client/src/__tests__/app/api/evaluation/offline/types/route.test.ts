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

import { GET, POST, OPTIONS } from "@/app/api/evaluation/offline/types/route";
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

describe("GET /api/evaluation/offline/types", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 401 when no Bearer token is provided", async () => {
		const response = await GET(makeRequest({ authorization: "" }));
		expect(response.status).toBe(401);
	});

	it("returns 401 when API key is invalid", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([new Error("Not found"), null]);
		const response = await GET(makeRequest());
		expect(response.status).toBe(401);
	});

	it("returns configured:false when evaluation config is not found", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		(getEvaluationConfigByDbConfigId as jest.Mock).mockRejectedValue(new Error("not found"));

		const response = await GET(makeRequest());
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.configured).toBe(false);
		expect(data.eval_types).toEqual([]);
	});

	it("returns the configured evaluation types", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		(getEvaluationConfigByDbConfigId as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			evaluationTypes: [
				{ id: "hallucination", label: "Hallucination", enabled: true, isCustom: false },
			],
		});

		const response = await GET(makeRequest());
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.eval_types).toEqual([
			{ id: "hallucination", label: "Hallucination", description: "", enabled: true, is_custom: false },
		]);
	});
});

describe("POST /api/evaluation/offline/types", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 401 when no Bearer token is provided", async () => {
		const response = await POST(makeRequest({ authorization: "" }));
		expect(response.status).toBe(401);
	});

	it("returns 401 when API key is invalid", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([new Error("Not found"), null]);
		const response = await POST(makeRequest({ body: { types: [] } }));
		expect(response.status).toBe(401);
	});

	it("returns 400 on invalid JSON body", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		const response = await POST(makeInvalidJsonRequest());
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Invalid JSON body");
	});

	it("returns 400 when types is not an array", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		const response = await POST(makeRequest({ body: { types: "not-an-array" } }));
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Invalid types array");
	});

	it("rejects a non-numeric thresholdScore without calling getEvaluationConfigByDbConfigId", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		const response = await POST(
			makeRequest({
				body: { types: [{ id: "toxicity", enabled: true, thresholdScore: "bad" }] },
			})
		);
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe("Threshold score must be a number between 0 and 1.");
		expect(getEvaluationConfigByDbConfigId).not.toHaveBeenCalled();
	});

	it("returns 400 when evaluation config is not found", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		(getEvaluationConfigByDbConfigId as jest.Mock).mockRejectedValue(new Error("not found"));

		const response = await POST(
			makeRequest({ body: { types: [{ id: "hallucination", enabled: true }] } })
		);
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toBe(
			"Evaluation not configured. Set up evaluation in the OpenLIT dashboard first."
		);
	});

	it("normalizes and persists types scoped to the API key's own database config", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: "db-1" }]);
		(getEvaluationConfigByDbConfigId as jest.Mock).mockResolvedValue({
			id: "cfg-1",
			meta: "{}",
		});

		const response = await POST(
			makeRequest({
				body: {
					types: [{ id: "toxicity", enabled: true, thresholdScore: 1.5 }],
				},
			})
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data).toEqual([
			expect.objectContaining({ id: "toxicity", enabled: true, thresholdScore: 1 }),
		]);
		expect(getEvaluationConfigByDbConfigId).toHaveBeenCalledWith("db-1", true);
		const updateCall = (prisma.evaluationConfigs.update as jest.Mock).mock.calls[0][0];
		expect(updateCall.where).toEqual({ id: "cfg-1" });
	});
});

describe("OPTIONS /api/evaluation/offline/types", () => {
	it("allows GET, POST, and OPTIONS", async () => {
		const response = await OPTIONS();
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
	});
});
