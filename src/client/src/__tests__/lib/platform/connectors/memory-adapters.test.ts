jest.mock("@/lib/platform/connectors/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
	selfHostedNetworkOptions: () => ({ allowHttp: true, allowPrivateNetwork: true }),
}));
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn().mockResolvedValue({
		raw: "secret-key",
		credentials: { apiKey: "secret-key" },
	}),
	redactableSecretValues: (secret: { raw?: string; credentials?: Record<string, string> }) =>
		[secret.raw, ...Object.values(secret.credentials || {})].filter(Boolean),
}));

const mockSafeFetch = jest.fn();

import { Mem0Adapter, mem0AdapterFactory } from "@/lib/platform/connectors/memory/mem0/adapter";
import { ZepAdapter, zepAdapterFactory } from "@/lib/platform/connectors/memory/zep/adapter";
import type { MemorySourceDescriptor } from "@/lib/platform/connectors/memory/types";

function descriptor(
	type: "mem0" | "zep",
	settings: Record<string, unknown> = {}
): MemorySourceDescriptor {
	return {
		type,
		id: `memory:${type}`,
		settings: {
			url: type === "mem0" ? "https://api.mem0.ai" : "https://api.getzep.com",
			...settings,
		},
		secretRef: "vault-1",
		name: type,
		projectId: "proj-1",
	};
}

beforeEach(() => {
	mockSafeFetch.mockReset();
});

describe("Mem0 adapter", () => {
	it("describes a self-contained config schema", () => {
		const described = mem0AdapterFactory.describe();
		expect(described.type).toBe("mem0");
		expect(described.capabilities).toEqual({
			add: true,
			search: true,
			get: true,
			list: true,
			update: true,
			delete: true,
		});
		expect(described.configFields.map((field) => field.key)).toEqual(
			expect.arrayContaining(["url", "apiKey", "orgId", "projectId"])
		);
		expect(described.configFields.find((field) => field.key === "apiKey")?.group).toBe(
			"credentials"
		);
	});

	it("health-checks entities and sends Token auth", async () => {
		mockSafeFetch.mockResolvedValue({ results: [] });
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toContain("https://api.mem0.ai/v1/entities/");
		expect(options.headers.Authorization).toBe("Token secret-key");
	});

	it("adds a memory from content and normalizes the response", async () => {
		mockSafeFetch.mockResolvedValue({
			results: [{ id: "mem-1", memory: "User likes tea", user_id: "u1" }],
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		const records = await adapter.add({ content: "User likes tea", userId: "u1" });
		expect(records).toEqual([
			expect.objectContaining({ id: "mem-1", content: "User likes tea", userId: "u1" }),
		]);
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(options.method).toBe("POST");
		expect(JSON.parse(options.body)).toEqual(
			expect.objectContaining({
				messages: [{ role: "user", content: "User likes tea" }],
				user_id: "u1",
			})
		);
	});

	it("searches memories through the v2 search API", async () => {
		mockSafeFetch.mockResolvedValue({
			results: [{ id: "mem-1", memory: "tea", score: 0.9 }],
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		const records = await adapter.search({ query: "tea", userId: "u1", limit: 5 });
		expect(records[0]).toEqual(expect.objectContaining({ id: "mem-1", score: 0.9 }));
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toContain("/v2/memories/search/");
		expect(JSON.parse(options.body)).toEqual(
			expect.objectContaining({
				query: "tea",
				filters: { user_id: "u1" },
				top_k: 5,
			})
		);
	});

	it("does not list memories until a user, agent, or session is provided", async () => {
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.list({})).rejects.toThrow(/user, agent, or session/i);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("lists filter options from entities", async () => {
		mockSafeFetch.mockResolvedValue({
			results: [
				{ id: "e1", name: "ada", type: "user", email: "ada@example.com" },
				{ name: "run-9", type: "run" },
				{ name: "researcher", entity_type: "agent" },
			],
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [{ id: "ada", label: "ada@example.com" }],
			sessions: [{ id: "run-9", label: "run-9" }],
			agents: [{ id: "researcher", label: "researcher" }],
		});
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("/v1/entities/");
	});

	it("gets a memory by id including categories, input, and history", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) {
				return [
					{
						id: "h1",
						event: "ADD",
						new_memory: "User's name is Alex",
						input: [{ role: "user", content: "I'm Alex" }],
						created_at: "2026-08-15T02:17:47Z",
					},
				];
			}
			return {
				id: "mem-1",
				memory: "User's name is Alex",
				user_id: "alex",
				categories: ["personal_details", "health"],
				created_at: "2026-08-15T02:17:47Z",
				updated_at: "2026-08-15T02:18:27Z",
				metadata: { memory_type: "profile" },
			};
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({
				id: "mem-1",
				content: "User's name is Alex",
				userId: "alex",
				categories: ["personal_details", "health"],
				input: [{ role: "user", content: "I'm Alex" }],
				history: [
					expect.objectContaining({
						id: "h1",
						event: "ADD",
						newMemory: "User's name is Alex",
					}),
				],
			})
		);
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("/v1/memories/mem-1/");
		expect(String(mockSafeFetch.mock.calls[1][0])).toContain(
			"/v1/memories/mem-1/history/"
		);
	});

	it("still returns a memory when history cannot be loaded", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) {
				throw new Error("history unavailable");
			}
			return { id: "mem-1", memory: "hello", user_id: "alex" };
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({
				id: "mem-1",
				content: "hello",
				userId: "alex",
			})
		);
	});
});

describe("Zep adapter", () => {
	it("describes session-oriented capabilities", () => {
		const described = zepAdapterFactory.describe();
		expect(described.type).toBe("zep");
		expect(described.capabilities.get).toBe(false);
		expect(described.capabilities.update).toBe(false);
		expect(described.configFields.map((field) => field.key)).toEqual(
			expect.arrayContaining(["url", "apiKey"])
		);
	});

	it("health-checks users with Api-Key auth", async () => {
		mockSafeFetch.mockResolvedValue({ users: [] });
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toContain("https://api.getzep.com/api/v2/users");
		expect(options.headers.Authorization).toBe("Api-Key secret-key");
	});

	it("adds session memory and requires a session id", async () => {
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.add({ content: "hello" })).rejects.toThrow(/session id/i);
		mockSafeFetch.mockResolvedValue({
			messages: [{ uuid: "m1", content: "hello", session_id: "s1" }],
		});
		const records = await adapter.add({ content: "hello", sessionId: "s1" });
		expect(records[0]).toEqual(
			expect.objectContaining({ id: "m1", content: "hello", sessionId: "s1" })
		);
	});

	it("lists users and sessions for filter dropdowns", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/users")) {
				return { users: [{ user_id: "ada", email: "ada@example.com" }] };
			}
			return { sessions: [{ session_id: "s1", user_id: "ada" }] };
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [{ id: "ada", label: "ada@example.com" }],
			sessions: [{ id: "s1", label: "s1", userId: "ada" }],
			agents: [],
		});
	});
});
