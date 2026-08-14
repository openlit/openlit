jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/memory/read", () => ({
	queryProjectMemories: jest.fn(),
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

import { GET } from "@/app/api/memory/route";
import { getCurrentUser } from "@/lib/session";
import { queryProjectMemories } from "@/lib/platform/connectors/memory/read";
import { MEMORY_CONNECTOR_NOT_FOUND, MEMORY_INVALID_LIMIT } from "@/constants/messages/en";

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function makeRequest(query = "") {
	const url = `http://localhost/api/memory${query}`;
	return {
		url,
		nextUrl: { searchParams: new URL(url).searchParams },
	} as any;
}

describe("GET /api/memory", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await GET(makeRequest());
		expect(response.status).toBe(401);
		expect(queryProjectMemories).not.toHaveBeenCalled();
	});

	it("rejects an invalid limit", async () => {
		const response = await GET(makeRequest("?limit=999"));
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(MEMORY_INVALID_LIMIT);
		expect(queryProjectMemories).not.toHaveBeenCalled();
	});

	it("returns memories without secretRef", async () => {
		(queryProjectMemories as jest.Mock).mockResolvedValue({
			connectors: [{ id: "memory:abc", name: "Mem0", hasSecret: true }],
			connector: { id: "memory:abc", name: "Mem0", hasSecret: true },
			memories: [{ id: "m1", content: "hello", kind: "summary" }],
			stats: { total: 1 },
			graph: { nodes: [], edges: [] },
		});
		const response = await GET(makeRequest("?connectorId=memory:abc"));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.memories[0].id).toBe("m1");
		expect(JSON.stringify(body)).not.toContain("secretRef");
		expect(queryProjectMemories).toHaveBeenCalledWith(
			expect.objectContaining({ connectorId: "memory:abc" })
		);
	});

	it("returns 404 when the connector is missing", async () => {
		(queryProjectMemories as jest.Mock).mockRejectedValue(
			new Error(MEMORY_CONNECTOR_NOT_FOUND)
		);
		const response = await GET(makeRequest("?connectorId=memory:missing"));
		expect(response.status).toBe(404);
	});
});
