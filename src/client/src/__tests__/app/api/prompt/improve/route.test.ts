jest.mock("ai", () => ({ generateText: jest.fn() }));
jest.mock("@/lib/db-config", () => ({ getDBConfigByUser: jest.fn() }));
jest.mock("@/lib/platform/chat/config", () => ({ getChatConfigWithApiKey: jest.fn() }));
jest.mock("@/lib/platform/chat/otter-runs", () => ({ saveOtterRun: jest.fn() }));
jest.mock("@/lib/platform/chat/stream", () => ({ getModelInstance: jest.fn() }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/utils/asaw", () =>
	jest.fn(async (promise: Promise<any>) => {
		try {
			const result = await promise;
			return [null, result];
		} catch (error) {
			return [error, null];
		}
	})
);

import { generateText } from "ai";
import { POST } from "@/app/api/prompt/improve/route";
import { getDBConfigByUser } from "@/lib/db-config";
import { getChatConfigWithApiKey } from "@/lib/platform/chat/config";
import { saveOtterRun } from "@/lib/platform/chat/otter-runs";
import { getModelInstance } from "@/lib/platform/chat/stream";
import { getCurrentUser } from "@/lib/session";

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

describe("POST /api/prompt/improve", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
		(getDBConfigByUser as jest.Mock).mockResolvedValue({ id: "db-1" });
		(getChatConfigWithApiKey as jest.Mock).mockResolvedValue({
			data: { provider: "openai", model: "gpt-4o", apiKey: "sk-test" },
		});
		(getModelInstance as jest.Mock).mockReturnValue({ provider: "openai", model: "gpt-4o" });
		(saveOtterRun as jest.Mock).mockResolvedValue({ data: "run-1" });
		(generateText as jest.Mock).mockResolvedValue({
			text: JSON.stringify({
				suggestions: [
					{
						id: "tighten-role",
						dimension: "Clarity",
						rationale: "Sets a clearer task.",
						original: "Write a summary",
						replacement: "Write a concise summary",
					},
					{
						id: "missing-original",
						dimension: "Invalid",
						rationale: "Should be filtered.",
						original: "Not in prompt",
						replacement: "Ignored",
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 25 },
		});
	});

	it("returns 401 when the user is not authenticated", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValueOnce(null);

		const response = await POST(makeRequest({ prompt: "Write a summary" }));

		expect(response.status).toBe(401);
		expect(saveOtterRun).not.toHaveBeenCalled();
	});

	it("rejects an empty prompt before calling the model", async () => {
		const response = await POST(makeRequest({ prompt: "" }));
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ err: "Prompt content is required" });
		expect(generateText).not.toHaveBeenCalled();
	});

	it("saves usage for an unsaved prompt improvement without attaching a prompt id", async () => {
		const response = await POST(makeRequest({ prompt: "Write a summary" }));
		const body = await response.json() as any;

		expect(response.status).toBe(200);
		expect(body.data.suggestions).toHaveLength(1);
		expect(body.data.usage).toEqual({
			promptTokens: 100,
			completionTokens: 25,
			cost: 0.000675,
		});
		expect(saveOtterRun).toHaveBeenCalledWith(
			expect.objectContaining({
				runType: "prompt_improvement",
				targetType: "unsaved_prompt",
				targetId: "",
				inputSnapshot: "Write a summary",
				summary: "Prompt improvement generated 1 suggestion.",
				modelProvider: "openai",
				modelName: "gpt-4o",
				promptTokens: 100,
				completionTokens: 25,
				meta: expect.objectContaining({
					source: "prompt_new",
					suggestionCount: 1,
				}),
			}),
			"db-1"
		);
	});

	it("saves usage against the existing prompt id on edit", async () => {
		await POST(makeRequest({ prompt: "Write a summary", promptId: "prompt-1" }));

		expect(saveOtterRun).toHaveBeenCalledWith(
			expect.objectContaining({
				targetType: "prompt",
				targetId: "prompt-1",
				meta: expect.objectContaining({ source: "prompt_edit" }),
			}),
			"db-1"
		);
	});
});
