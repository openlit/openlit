jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/memory/read", () => ({
	submitProjectMemoryFeedback: jest.fn(),
}));
jest.mock("@/utils/asaw", () =>
	jest.fn(async (promise: Promise<unknown>) => {
		try {
			return [null, await promise];
		} catch (error) {
			return [error, null];
		}
	})
);

import { POST } from "@/app/api/memory/[id]/feedback/route";
import { getCurrentUser } from "@/lib/session";
import { submitProjectMemoryFeedback } from "@/lib/platform/connectors/memory/read";
import {
	MEMORY_FEEDBACK_INVALID,
	MEMORY_INVALID_FILTER,
	MEMORY_INVALID_JSON,
} from "@/constants/messages/en";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function makeRequest(body: unknown, query = "") {
	const url = `http://localhost/api/memory/mem-1/feedback${query}`;
	return {
		url,
		nextUrl: { searchParams: new URL(url).searchParams },
		json: async () => {
			if (body === "__invalid__") throw new SyntaxError("Unexpected token");
			return body;
		},
	} as any;
}

describe("POST /api/memory/[id]/feedback", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await POST(makeRequest({ rating: "positive" }), {
			params: { id: "mem-1" },
		});
		expect(response.status).toBe(401);
		expect(submitProjectMemoryFeedback).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON", async () => {
		const response = await POST(makeRequest("__invalid__"), {
			params: { id: "mem-1" },
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(MEMORY_INVALID_JSON);
		expect(submitProjectMemoryFeedback).not.toHaveBeenCalled();
	});

	it("rejects an invalid rating", async () => {
		const response = await POST(makeRequest({ rating: "meh" }), {
			params: { id: "mem-1" },
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(MEMORY_FEEDBACK_INVALID);
		expect(submitProjectMemoryFeedback).not.toHaveBeenCalled();
	});

	it("rejects a control-character id", async () => {
		const response = await POST(makeRequest({ rating: "positive" }), {
			params: { id: "mem\u0000-1" },
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(MEMORY_INVALID_FILTER);
		expect(submitProjectMemoryFeedback).not.toHaveBeenCalled();
	});

	it("submits vendor-neutral feedback", async () => {
		(submitProjectMemoryFeedback as jest.Mock).mockResolvedValue({
			feedback: { rating: "very_negative", reason: "Wrong person" },
			memory: { id: "mem-1", feedback: { rating: "very_negative" } },
			connector: { id: "memory:abc", name: "Mem0" },
			capabilities: { feedback: true },
		});
		const response = await POST(
			makeRequest(
				{ rating: "very_negative", reason: "Wrong person" },
				"?connectorId=memory:abc"
			),
			{ params: { id: "mem-1" } }
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.feedback.rating).toBe("very_negative");
		expect(JSON.stringify(body)).not.toContain("secretRef");
		expect(submitProjectMemoryFeedback).toHaveBeenCalledWith({
			id: "mem-1",
			connectorId: "memory:abc",
			rating: "very_negative",
			reason: "Wrong person",
		});
	});
});
