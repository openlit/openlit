jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/memory/read", () => ({
	getProjectMemory: jest.fn(),
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

import { GET } from "@/app/api/memory/[id]/route";
import { getCurrentUser } from "@/lib/session";
import { getProjectMemory } from "@/lib/platform/connectors/memory/read";
import { MEMORY_DETAIL_NOT_FOUND, MEMORY_INVALID_FILTER } from "@/constants/messages/en";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function makeRequest(query = "") {
	const url = `http://localhost/api/memory/mem-1${query}`;
	return {
		url,
		nextUrl: { searchParams: new URL(url).searchParams },
	} as any;
}

describe("GET /api/memory/[id]", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await GET(makeRequest(), { params: { id: "mem-1" } });
		expect(response.status).toBe(401);
		expect(getProjectMemory).not.toHaveBeenCalled();
	});

	it("rejects a control-character id", async () => {
		const response = await GET(makeRequest(), { params: { id: "mem\u0000-1" } });
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(MEMORY_INVALID_FILTER);
		expect(getProjectMemory).not.toHaveBeenCalled();
	});

	it("returns the memory without secretRef", async () => {
		(getProjectMemory as jest.Mock).mockResolvedValue({
			connector: { id: "memory:abc", name: "Mem0", hasSecret: true },
			capabilities: { get: true },
			memory: { id: "mem-1", content: "hello", kind: "profile", userId: "alex" },
		});
		const response = await GET(makeRequest("?connectorId=memory:abc"), {
			params: { id: "mem-1" },
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.memory.id).toBe("mem-1");
		expect(JSON.stringify(body)).not.toContain("secretRef");
		expect(getProjectMemory).toHaveBeenCalledWith(
			expect.objectContaining({ id: "mem-1", connectorId: "memory:abc" })
		);
	});

	it("returns 404 when the memory is missing", async () => {
		(getProjectMemory as jest.Mock).mockRejectedValue(new Error(MEMORY_DETAIL_NOT_FOUND));
		const response = await GET(makeRequest(), { params: { id: "mem-1" } });
		expect(response.status).toBe(404);
	});
});
