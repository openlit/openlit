jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/memory/read", () => ({
	getProjectMemory: jest.fn(),
}));
jest.mock("@/lib/platform/connectors/memory/write", () => ({
	updateProjectMemory: jest.fn(),
	deleteProjectMemory: jest.fn(),
	parseMemoryMetadata: (value: unknown) => value,
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

import { DELETE, GET, PATCH } from "@/app/api/memory/[id]/route";
import { getCurrentUser } from "@/lib/session";
import { getProjectMemory } from "@/lib/platform/connectors/memory/read";
import {
	deleteProjectMemory,
	updateProjectMemory,
} from "@/lib/platform/connectors/memory/write";
import {
	MEMORY_DETAIL_NOT_FOUND,
	MEMORY_INVALID_FILTER,
	MEMORY_INVALID_JSON,
} from "@/constants/messages/en";

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

function makeBodyRequest(body: unknown, query = "") {
	const url = `http://localhost/api/memory/mem-1${query}`;
	return {
		url,
		nextUrl: { searchParams: new URL(url).searchParams },
		json: async () => {
			if (body === "__invalid__") throw new SyntaxError("Unexpected token");
			return body;
		},
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

describe("PATCH /api/memory/[id]", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await PATCH(makeBodyRequest({ content: "updated" }), {
			params: { id: "mem-1" },
		});
		expect(response.status).toBe(401);
		expect(updateProjectMemory).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON", async () => {
		const response = await PATCH(makeBodyRequest("__invalid__"), {
			params: { id: "mem-1" },
		});
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toBe(MEMORY_INVALID_JSON);
		expect(updateProjectMemory).not.toHaveBeenCalled();
	});

	it("updates the memory", async () => {
		(updateProjectMemory as jest.Mock).mockResolvedValue({
			memory: { id: "mem-1", content: "updated", kind: "profile" },
			connector: { id: "memory:abc", name: "Mem0" },
			capabilities: { update: true },
		});
		const response = await PATCH(
			makeBodyRequest({ content: "updated" }, "?connectorId=memory:abc"),
			{ params: { id: "mem-1" } }
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.memory.content).toBe("updated");
		expect(updateProjectMemory).toHaveBeenCalledWith({
			id: "mem-1",
			connectorId: "memory:abc",
			content: "updated",
			metadata: undefined,
		});
	});
});

describe("DELETE /api/memory/[id]", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user-1" });
	});

	it("requires authentication", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await DELETE(makeRequest(), { params: { id: "mem-1" } });
		expect(response.status).toBe(401);
		expect(deleteProjectMemory).not.toHaveBeenCalled();
	});

	it("deletes the memory", async () => {
		(deleteProjectMemory as jest.Mock).mockResolvedValue({
			ok: true,
			connector: { id: "memory:abc" },
			capabilities: { delete: true },
		});
		const response = await DELETE(makeRequest("?connectorId=memory:abc"), {
			params: { id: "mem-1" },
		});
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		expect(deleteProjectMemory).toHaveBeenCalledWith({
			id: "mem-1",
			connectorId: "memory:abc",
		});
	});
});
