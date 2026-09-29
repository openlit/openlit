jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/memory/port", () => ({
	copyProjectMemories: jest.fn(),
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

import { POST } from "@/app/api/memory/copy/route";
import { getCurrentUser } from "@/lib/session";
import { copyProjectMemories } from "@/lib/platform/connectors/memory/port";
import {
	MEMORY_COPY_SAME_CONNECTOR,
	MEMORY_INVALID_JSON,
} from "@/constants/messages/en";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function makePostRequest(body: unknown) {
	const url = "http://localhost/api/memory/copy";
	return {
		url,
		nextUrl: { searchParams: new URL(url).searchParams },
		json: async () => {
			if (body === "__invalid__") throw new SyntaxError("Unexpected token");
			return body;
		},
	} as any;
}

describe("POST /api/memory/copy", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await POST(
			makePostRequest({
				sourceConnectorId: "memory:src",
				targetConnectorId: "memory:dst",
			})
		);
		expect(response.status).toBe(401);
		expect(copyProjectMemories).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON", async () => {
		const response = await POST(makePostRequest("__invalid__"));
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(MEMORY_INVALID_JSON);
	});

	it("copies without leaking secretRef", async () => {
		(copyProjectMemories as jest.Mock).mockResolvedValue({
			source: { id: "memory:src", name: "Mem0", type: "mem0" },
			target: { id: "memory:dst", name: "Zep", type: "zep" },
			copied: 1,
			failed: [],
			memories: [{ id: "z1", content: "Prefers tabs", port: { sourceMemoryId: "m1" } }],
		});
		const response = await POST(
			makePostRequest({
				sourceConnectorId: "memory:src",
				targetConnectorId: "memory:dst",
				memoryIds: ["m1"],
			})
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.copied).toBe(1);
		expect(JSON.stringify(body)).not.toContain("secretRef");
		expect(copyProjectMemories).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceConnectorId: "memory:src",
				targetConnectorId: "memory:dst",
				memoryIds: ["m1"],
			})
		);
	});

	it("returns 400 when source and destination are the same", async () => {
		(copyProjectMemories as jest.Mock).mockRejectedValue(
			new Error(MEMORY_COPY_SAME_CONNECTOR)
		);
		const response = await POST(
			makePostRequest({
				sourceConnectorId: "memory:src",
				targetConnectorId: "memory:src",
			})
		);
		expect(response.status).toBe(400);
	});
});
