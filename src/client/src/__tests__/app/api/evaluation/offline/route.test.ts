jest.mock("@/lib/platform/api-keys", () => ({
	getAPIKeyInfo: jest.fn(),
}));
jest.mock("@/lib/platform/evaluation/config", () => ({
	getEvaluationConfigByDbConfigId: jest.fn(),
}));
jest.mock("@/lib/platform/evaluation", () => ({
	runOfflineEvaluation: jest.fn(),
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
	})),
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

import { POST, OPTIONS } from "@/app/api/evaluation/offline/route";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getEvaluationConfigByDbConfigId } from "@/lib/platform/evaluation/config";
import { runOfflineEvaluation } from "@/lib/platform/evaluation";

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
}) {
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

describe("POST /api/evaluation/offline", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 401 when no Bearer token is provided", async () => {
		const response = await POST(makeRequest({ authorization: "" }));
		expect(response.status).toBe(401);
	});

	it("returns 401 when API key is invalid", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([
			new Error("Not found"),
			null,
		]);

		const response = await POST(
			makeRequest({
				body: { prompt: "test", response: "test" },
			})
		);
		expect(response.status).toBe(401);
	});

	it("returns 400 when prompt is missing", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([
			null,
			{ databaseConfigId: "db-1" },
		]);

		const response = await POST(
			makeRequest({ body: { response: "some response" } })
		);
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toContain("prompt");
	});

	it("returns 400 when response is missing", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([
			null,
			{ databaseConfigId: "db-1" },
		]);

		const response = await POST(
			makeRequest({ body: { prompt: "some prompt" } })
		);
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toContain("response");
	});

	it("returns 400 when evaluation config is not found", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([
			null,
			{ databaseConfigId: "db-1" },
		]);
		(getEvaluationConfigByDbConfigId as jest.Mock).mockRejectedValue(
			new Error("Not found")
		);

		const response = await POST(
			makeRequest({
				body: { prompt: "test", response: "test" },
			})
		);
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.err).toContain("Evaluation not configured");
	});

	it("returns evaluation results on success", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([
			null,
			{ databaseConfigId: "db-1" },
		]);
		(getEvaluationConfigByDbConfigId as jest.Mock).mockResolvedValue({
			id: "config-1",
			provider: "openai",
			model: "gpt-4o",
			databaseConfigId: "db-1",
			secret: { value: "sk-test" },
		});
		(runOfflineEvaluation as jest.Mock).mockResolvedValue({
			success: true,
			evaluations: [
				{
					evaluation: "hallucination",
					score: 0.1,
					verdict: "no",
					classification: "none",
					explanation: "OK",
				},
			],
			contextApplied: {
				ruleMatched: false,
				matchingRuleIds: [],
				contextEntityIds: [],
				userContextsCount: 0,
			},
			metadata: {
				model: "openai/gpt-4o",
				evalTypesRun: ["hallucination"],
			},
		});

		const response = await POST(
			makeRequest({
				body: {
					prompt: "What is Paris?",
					response: "The capital of France.",
					eval_types: ["hallucination"],
				},
			})
		);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.success).toBe(true);
		expect(data.evaluations).toHaveLength(1);
		expect(data.evaluations[0].type).toBe("hallucination");
		expect(data.evaluations[0].score).toBe(0.1);
	});

	it("passes attributes to runOfflineEvaluation", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([
			null,
			{ databaseConfigId: "db-1" },
		]);
		(getEvaluationConfigByDbConfigId as jest.Mock).mockResolvedValue({
			id: "config-1",
			provider: "openai",
			model: "gpt-4o",
			databaseConfigId: "db-1",
			secret: { value: "sk-test" },
		});
		(runOfflineEvaluation as jest.Mock).mockResolvedValue({
			success: true,
			evaluations: [],
			metadata: {},
		});

		await POST(
			makeRequest({
				body: {
					prompt: "test",
					response: "test",
					attributes: {
						"service.name": "my-app",
						"deployment.environment": "staging",
					},
				},
			})
		);

		expect(runOfflineEvaluation).toHaveBeenCalledWith(
			expect.objectContaining({
				attributes: {
					"service.name": "my-app",
					"deployment.environment": "staging",
				},
			}),
			expect.anything(),
			"db-1"
		);
	});
});

describe("OPTIONS /api/evaluation/offline", () => {
	it("returns 200 with CORS headers", async () => {
		const response = await OPTIONS();
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
			"POST"
		);
		expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
			"Authorization"
		);
	});
});
