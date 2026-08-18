jest.mock("@/lib/platform/connectors/datasource/http/safe-fetch", () => {
	class SourceResponseError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.name = "SourceResponseError";
			this.status = status;
		}
	}
	return {
		safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
		selfHostedNetworkOptions: () => ({ allowHttp: true, allowPrivateNetwork: true }),
		SourceResponseError,
	};
});
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn().mockResolvedValue({
		raw: "secret-key",
		credentials: { apiKey: "secret-key" },
	}),
	redactableSecretValues: (secret: { raw?: string; credentials?: Record<string, string> }) =>
		[secret.raw, ...Object.values(secret.credentials || {})].filter(Boolean),
}));

const mockSafeFetch = jest.fn();

import { ClaudeAdapter, claudeAdapterFactory } from "@/lib/platform/connectors/memory/claude/adapter";
import { Mem0Adapter, mem0AdapterFactory } from "@/lib/platform/connectors/memory/mem0/adapter";
import { ZepAdapter, zepAdapterFactory } from "@/lib/platform/connectors/memory/zep/adapter";
import { SourceResponseError } from "@/lib/platform/connectors/datasource/http/safe-fetch";
import type { MemorySourceDescriptor } from "@/lib/platform/connectors/memory/types";

function defaultUrl(type: "claude" | "mem0" | "zep"): string {
	if (type === "claude") return "https://api.anthropic.com";
	if (type === "mem0") return "https://api.mem0.ai";
	return "https://api.getzep.com";
}

function descriptor(
	type: "claude" | "mem0" | "zep",
	settings: Record<string, unknown> = {}
): MemorySourceDescriptor {
	return {
		type,
		id: `memory:${type}`,
		settings: {
			url: defaultUrl(type),
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
			feedback: true,
		});
		expect(described.configFields.map((field) => field.key)).toEqual(
			expect.arrayContaining(["url", "apiKey", "orgId", "projectId"])
		);
		expect(described.configFields.find((field) => field.key === "apiKey")?.group).toBe(
			"credentials"
		);
		expect(described.filterFields?.map((field) => field.key)).toEqual([
			"userId",
			"sessionId",
			"agentId",
		]);
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
		expect(String(mockSafeFetch.mock.calls[0][0])).toBe(
			"https://api.mem0.ai/v1/memories/mem-1/"
		);
		expect(String(mockSafeFetch.mock.calls[1][0])).toBe(
			"https://api.mem0.ai/v1/memories/mem-1/history/"
		);
	});

	it("retries get without a trailing slash after a redirect budget error", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			const href = String(url);
			if (href.endsWith("/mem-1/")) {
				throw new Error("Data source exceeded the maximum number of redirects");
			}
			if (href.includes("/history")) {
				return [];
			}
			if (href.endsWith("/mem-1")) {
				return { id: "mem-1", memory: "hello", user_id: "alex" };
			}
			throw new Error(`unexpected ${href}`);
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({
				id: "mem-1",
				content: "hello",
				userId: "alex",
			})
		);
		expect(String(mockSafeFetch.mock.calls[0][0])).toBe(
			"https://api.mem0.ai/v1/memories/mem-1/"
		);
		expect(String(mockSafeFetch.mock.calls[1][0])).toBe(
			"https://api.mem0.ai/v1/memories/mem-1"
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

	it("submits and clears memory feedback through the v1 feedback API", async () => {
		mockSafeFetch.mockResolvedValue({
			id: "fb-1",
			feedback: "NEGATIVE",
			feedback_reason: "Outdated",
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(
			adapter.feedback("mem-1", { rating: "negative", reason: "Outdated" })
		).resolves.toEqual({
			rating: "negative",
			reason: "Outdated",
		});
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toBe("https://api.mem0.ai/v1/feedback/");
		expect(options.method).toBe("POST");
		expect(JSON.parse(options.body)).toEqual({
			memory_id: "mem-1",
			feedback: "NEGATIVE",
			feedback_reason: "Outdated",
		});

		mockSafeFetch.mockResolvedValue({ id: "fb-1", feedback: null, feedback_reason: null });
		await expect(adapter.feedback("mem-1", { rating: null })).resolves.toEqual({});
		expect(JSON.parse(mockSafeFetch.mock.calls[1][1].body)).toEqual({
			memory_id: "mem-1",
			feedback: null,
			feedback_reason: null,
		});
	});

	it("reads existing feedback from a memory payload", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) return [];
			return {
				id: "mem-1",
				memory: "hello",
				feedback: "POSITIVE",
				feedback_reason: "Accurate",
			};
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({
				id: "mem-1",
				feedback: { rating: "positive", reason: "Accurate" },
			})
		);
	});
});

describe("Zep adapter", () => {
	it("describes graph get and session add capabilities", () => {
		const described = zepAdapterFactory.describe();
		expect(described.type).toBe("zep");
		expect(described.capabilities.get).toBe(true);
		expect(described.capabilities.feedback).toBe(false);
		expect(described.capabilities.update).toBe(false);
		expect(described.configFields.map((field) => field.key)).toEqual(
			expect.arrayContaining(["url", "apiKey"])
		);
		expect(described.filterFields?.map((field) => field.key)).toEqual([
			"userId",
			"sessionId",
		]);
		expect(described.filterFields?.[0]).toMatchObject({
			key: "userId",
			required: true,
			allowCustom: true,
		});
		expect(described.filterFields?.[1]).toMatchObject({
			key: "sessionId",
			writeRequired: true,
			allowCustom: true,
		});
	});

	it("health-checks users with Api-Key auth", async () => {
		mockSafeFetch.mockResolvedValue({ users: [] });
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toContain("https://api.getzep.com/api/v2/users-ordered");
		expect(options.headers.Authorization).toBe("Api-Key secret-key");
	});

	it("adds session memory and requires a session id", async () => {
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.add({ content: "hello" })).rejects.toThrow(/session id/i);
		mockSafeFetch.mockResolvedValue({
			facts: [{ uuid: "f1", fact: "User likes tea" }],
			messages: [{ uuid: "m1", content: "hello", role: "user", session_id: "s1" }],
		});
		const records = await adapter.add({ content: "hello", sessionId: "s1" });
		expect(records[0]).toEqual(
			expect.objectContaining({
				id: "f1",
				content: "User likes tea",
				sessionId: "s1",
				input: [{ role: "user", content: "hello" }],
			})
		);
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain(
			"/api/v2/threads/s1/messages"
		);
	});

	it("does not list until a user or session is provided", async () => {
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.list({})).rejects.toThrow(/user, agent, or session/i);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("lists user graph facts from a raw edge array", async () => {
		mockSafeFetch.mockResolvedValue([
			{
				uuid: "e1",
				fact: "Ada prefers TypeScript",
				name: "PREFERS",
				created_at: "2026-08-16T00:00:00Z",
			},
		]);
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.list({ userId: "ada" })).resolves.toEqual([
			expect.objectContaining({
				id: "e1",
				content: "Ada prefers TypeScript",
				userId: "ada",
			}),
		]);
	});

	it("maps edge endpoints and keeps entity nodes off the memory list", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/user/")) {
				return [
					{
						uuid: "e1",
						fact: "Sarah lives in Austin",
						name: "LIVES_IN",
						source_node_uuid: "n-user",
						target_node_uuid: "n-loc",
						source_node_name: "Sarah Smith",
						target_node_name: "Austin",
						source_node_labels: ["User"],
						target_node_labels: ["Location"],
					},
				];
			}
			if (String(url).includes("/graph/node/user/")) {
				return [
					{
						uuid: "n-topic",
						name: "Observability",
						summary: "Talks about tracing",
						labels: ["Topic"],
					},
				];
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada" });
		expect(records).toEqual([
			expect.objectContaining({
				id: "e1",
				relation: {
					source: {
						id: "n-user",
						label: "Sarah Smith",
						types: ["User"],
					},
					target: {
						id: "n-loc",
						label: "Austin",
						types: ["Location"],
					},
					name: "LIVES_IN",
				},
			}),
			expect.objectContaining({
				id: "n-topic",
				graphOnly: true,
				categories: ["Topic"],
			}),
		]);
	});

	it("falls back to /users and /sessions when ordered/thread endpoints are missing", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/users-ordered") || String(url).includes("/threads")) {
				throw new Error("not found");
			}
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

	it("lists user graph facts and falls back to nodes", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/user/")) {
				return {
					edges: [
						{
							uuid: "e1",
							fact: "Ada prefers TypeScript",
							name: "PREFERS",
							created_at: "2026-08-16T00:00:00Z",
						},
					],
				};
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.list({ userId: "ada" })).resolves.toEqual([
			expect.objectContaining({
				id: "e1",
				content: "Ada prefers TypeScript",
				userId: "ada",
				categories: ["PREFERS"],
			}),
		]);
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain(
			"/api/v2/graph/edge/user/ada"
		);
	});

	it("lists the user graph even when a session is selected", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/user/ada")) {
				return [{ uuid: "e1", fact: "Ada prefers TypeScript", created_at: "2026-08-16T00:00:00Z" }];
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ sessionId: "s1", userId: "ada" });
		expect(records).toEqual([
			expect.objectContaining({
				id: "e1",
				content: "Ada prefers TypeScript",
				userId: "ada",
			}),
		]);
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain(
			"/api/v2/graph/edge/user/ada"
		);
	});

	it("resolves the thread user then lists that user's graph", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/threads/s1/messages")) {
				return { messages: [], user_id: "ada" };
			}
			if (String(url).includes("/graph/edge/user/ada")) {
				return [{ uuid: "e1", fact: "Ada prefers TypeScript" }];
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ sessionId: "s1" });
		expect(records).toEqual([
			expect.objectContaining({ id: "e1", userId: "ada" }),
		]);
	});

	it("gets a fact by graph edge uuid and falls back to nodes", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/")) {
				throw new Error("not found");
			}
			if (String(url).includes("/graph/node/")) {
				return {
					uuid: "n1",
					name: "Ada",
					summary: "Engineer who drinks tea",
					labels: ["user"],
					attributes: { role: "engineer" },
				};
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("n1")).resolves.toEqual(
			expect.objectContaining({
				id: "n1",
				content: "Engineer who drinks tea",
				categories: ["user"],
				structuredAttributes: { role: "engineer" },
			})
		);
	});

	it("attaches changelog and source episodes when getting an edge", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/e1") && !String(url).includes("/user/")) {
				return {
					uuid: "e1",
					fact: "The Enterprise Sandbox Tier 3 plan is Active.",
					name: "HAS_PLAN",
					created_at: "2026-08-17T00:00:00Z",
					valid_at: "2026-08-17T01:00:00Z",
					episodes: ["ep-1"],
				};
			}
			if (String(url).includes("/graph/episodes/ep-1")) {
				return { uuid: "ep-1", content: "Our plan is active", role: "user" };
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("e1")).resolves.toEqual(
			expect.objectContaining({
				id: "e1",
				input: [{ role: "user", content: "Our plan is active" }],
				history: [
					expect.objectContaining({
						event: "ADD",
						createdAt: "2026-08-17T00:00:00Z",
					}),
					expect.objectContaining({
						event: "UPDATE",
						createdAt: "2026-08-17T01:00:00Z",
					}),
				],
			})
		);
	});

	it("gets thread context when the id is not a graph uuid", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/") || String(url).includes("/graph/node/")) {
				throw new Error("not found");
			}
			if (String(url).includes("/threads/s1/context")) {
				return { context: "Ada likes tea.", messages: [{ role: "user", content: "I like tea" }] };
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("s1")).resolves.toEqual(
			expect.objectContaining({
				id: "s1",
				content: "Ada likes tea.",
				input: [{ role: "user", content: "I like tea" }],
			})
		);
	});

	it("pages user graph edges with uuid_cursor", async () => {
		mockSafeFetch.mockImplementation(async (url: string, options?: { body?: string }) => {
			if (!String(url).includes("/graph/edge/user/ada")) {
				throw new Error(`unexpected ${url}`);
			}
			const body = JSON.parse(String(options?.body || "{}")) as { uuid_cursor?: string };
			if (!body.uuid_cursor) {
				return Array.from({ length: 50 }, (_, index) => ({
					uuid: `e${index}`,
					fact: `Fact ${index}`,
				}));
			}
			return [{ uuid: "e50", fact: "Fact 50" }];
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada", limit: 51 });
		expect(records).toHaveLength(51);
		expect(records[50]?.id).toBe("e50");
		expect(JSON.parse(String(mockSafeFetch.mock.calls[1][1].body)).uuid_cursor).toBe("e49");
	});

	it("deletes a graph edge instead of the whole session", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new ZepAdapter(descriptor("zep"));
		await adapter.delete("e1");
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("/api/v2/graph/edge/e1");
		expect(mockSafeFetch.mock.calls[0][1].method).toBe("DELETE");
	});

	it("lists users and threads for filter dropdowns", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/users-ordered") || String(url).includes("/users")) {
				return { users: [{ user_id: "ada", email: "ada@example.com" }] };
			}
			if (String(url).includes("/threads")) {
				return { threads: [{ thread_id: "s1", user_id: "ada" }] };
			}
			return { sessions: [{ session_id: "s1", user_id: "ada" }] };
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [{ id: "ada", label: "ada@example.com" }],
			sessions: [{ id: "s1", label: "s1", userId: "ada" }],
			agents: [],
		});
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("/api/v2/users-ordered");
		expect(String(mockSafeFetch.mock.calls[1][0])).toContain("/api/v2/threads");
	});
});

describe("Claude adapter", () => {
	it("describes memory-store config", () => {
		const described = claudeAdapterFactory.describe();
		expect(described.type).toBe("claude");
		expect(described.capabilities).toEqual({
			add: true,
			search: true,
			get: true,
			list: true,
			update: true,
			delete: true,
			feedback: false,
		});
		expect(described.configFields.map((field) => field.key)).toEqual(
			expect.arrayContaining(["url", "apiKey"])
		);
		expect(described.configFields.map((field) => field.key)).not.toContain("storeId");
		expect(described.configFields.find((field) => field.key === "apiKey")?.group).toBe(
			"credentials"
		);
		expect(described.filterFields?.map((field) => field.key)).toEqual([
			"userId",
			"sessionId",
		]);
		expect(described.filterFields?.[1]).toMatchObject({
			key: "sessionId",
			required: true,
		});
	});

	it("health-checks stores with Anthropic memory headers", async () => {
		mockSafeFetch.mockResolvedValue({ data: [] });
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toContain("https://api.anthropic.com/v1/memory_stores");
		expect(options.headers["x-api-key"]).toBe("secret-key");
		expect(options.headers["anthropic-version"]).toBe("2023-06-01");
		expect(options.headers["anthropic-beta"]).toBe("agent-memory-2026-07-22");
	});

	it("lists memory stores as session filters", async () => {
		mockSafeFetch.mockResolvedValue({
			data: [
				{
					id: "memstore_1",
					name: "User Preferences",
					metadata: { user_id: "ada" },
				},
			],
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [{ id: "ada", label: "ada" }],
			sessions: [{ id: "memstore_1", label: "User Preferences", userId: "ada" }],
			agents: [],
		});
	});

	it("lists memories from a store with view=full", async () => {
		mockSafeFetch.mockResolvedValue({
			data: [
				{
					id: "mem_1",
					type: "memory",
					path: "/projects/foo/notes.md",
					content: "Prefers TypeScript",
					memory_store_id: "memstore_1",
					created_at: "2026-08-01T00:00:00Z",
				},
				{ type: "memory_prefix", path: "/archive/" },
			],
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.list({ sessionId: "memstore_1" })).resolves.toEqual([
			expect.objectContaining({
				id: "memstore_1:mem_1",
				content: "Prefers TypeScript",
				sessionId: "memstore_1",
				categories: ["projects", "foo", "notes.md"],
			}),
		]);
		const [url] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toContain(
			"https://api.anthropic.com/v1/memory_stores/memstore_1/memories?"
		);
		expect(String(url)).toContain("view=full");
	});

	it("requires a store when more than one exists", async () => {
		mockSafeFetch.mockResolvedValue({
			data: [
				{ id: "memstore_1", name: "One" },
				{ id: "memstore_2", name: "Two" },
			],
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.list({})).rejects.toThrow(/user, agent, or session/i);
	});

	it("gets a memory by composite id and attaches changelog", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/memory_versions")) {
				return {
					data: [
						{
							id: "memver_2",
							operation: "modified",
							content: "Prefers bun",
							created_by: { type: "api_actor", api_key_id: "key_1" },
						},
						{
							id: "memver_1",
							operation: "created",
							content: "Prefers TypeScript",
						},
					],
				};
			}
			return {
				id: "mem_1",
				type: "memory",
				path: "/notes.md",
				content: "Prefers bun",
				memory_store_id: "memstore_1",
			};
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.get("memstore_1:mem_1")).resolves.toEqual(
			expect.objectContaining({
				id: "memstore_1:mem_1",
				content: "Prefers bun",
				history: [
					expect.objectContaining({
						id: "memver_2",
						event: "UPDATE",
						newMemory: "Prefers bun",
						actorId: "key_1",
					}),
					expect.objectContaining({ id: "memver_1", event: "ADD" }),
				],
			})
		);
	});

	it("searches listed memories locally", async () => {
		mockSafeFetch.mockResolvedValue({
			data: [
				{
					id: "mem_1",
					type: "memory",
					path: "/a.md",
					content: "Prefers TypeScript",
					memory_store_id: "memstore_1",
				},
				{
					id: "mem_2",
					type: "memory",
					path: "/b.md",
					content: "Uses bun",
					memory_store_id: "memstore_1",
				},
			],
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		const records = await adapter.search({ query: "typescript" });
		expect(records).toEqual([
			expect.objectContaining({ content: "Prefers TypeScript" }),
		]);
	});

	it("creates a memory under /openlit when no path is given", async () => {
		mockSafeFetch.mockResolvedValue({
			id: "mem_9",
			type: "memory",
			path: "/openlit/prefers-tabs.md",
			content: "Prefers tabs",
			memory_store_id: "memstore_1",
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await expect(adapter.add({ content: "Prefers tabs" })).resolves.toEqual([
			expect.objectContaining({ id: "memstore_1:mem_9", content: "Prefers tabs" }),
		]);
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(options.method).toBe("POST");
		expect(JSON.parse(options.body)).toEqual({
			path: "/openlit/prefers-tabs.md",
			content: "Prefers tabs",
		});
	});
});
