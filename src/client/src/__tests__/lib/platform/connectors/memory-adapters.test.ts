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
import { resolveSourceSecret } from "@/lib/platform/connectors/datasource/http/secret";
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
		expect(described.filterFields?.[1]).toMatchObject({
			key: "sessionId",
			label: "Run",
		});
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

	it("ORs multiple entity filters when searching", async () => {
		mockSafeFetch.mockResolvedValue({ results: [] });
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await adapter.search({ query: "tea", userId: "u1", agentId: "researcher" });
		expect(JSON.parse(mockSafeFetch.mock.calls[0][1].body)).toEqual(
			expect.objectContaining({
				filters: { OR: [{ user_id: "u1" }, { agent_id: "researcher" }] },
			})
		);
	});

	it("does not list memories until a user, agent, or session is provided", async () => {
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.list({})).rejects.toThrow(/user, agent, or session/i);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("lists memories through the v3 filters API", async () => {
		mockSafeFetch.mockResolvedValue({
			count: 1,
			results: [{ id: "mem-1", memory: "likes tea", user_id: "u1", run_id: "run-9" }],
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		const records = await adapter.list({ userId: "u1", sessionId: "run-9", limit: 10 });
		expect(records).toEqual([
			expect.objectContaining({
				id: "mem-1",
				content: "likes tea",
				userId: "u1",
				sessionId: "run-9",
			}),
		]);
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toContain("/v3/memories/?page=1&page_size=10");
		expect(options.method).toBe("POST");
		expect(JSON.parse(options.body)).toEqual(
			expect.objectContaining({
				filters: { OR: [{ user_id: "u1" }, { run_id: "run-9" }] },
			})
		);
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

	it("exposes capabilities directly on the adapter instance", () => {
		const adapter = new Mem0Adapter(descriptor("mem0"));
		expect(adapter.capabilities()).toEqual({
			add: true,
			search: true,
			get: true,
			list: true,
			update: true,
			delete: true,
			feedback: true,
		});
	});

	it("reports an unhealthy connection when the entities call fails", async () => {
		mockSafeFetch.mockRejectedValue(new Error("boom"));
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringContaining("boom") })
		);
	});

	it("rejects adding a memory with no content or messages", async () => {
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.add({})).rejects.toThrow(/content/i);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("adds a memory from an explicit messages array", async () => {
		mockSafeFetch.mockResolvedValue({
			results: [{ id: "mem-2", memory: "hi there" }],
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await adapter.add({
			messages: [{ role: "user", content: "hi there" }],
			userId: "u1",
		});
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(JSON.parse(options.body)).toEqual(
			expect.objectContaining({
				messages: [{ role: "user", content: "hi there" }],
			})
		);
	});

	it("normalizes a bare array response and a single-object response", async () => {
		mockSafeFetch.mockResolvedValue([{ id: "mem-1", memory: "tea" }]);
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.search({ query: "tea" })).resolves.toEqual([
			expect.objectContaining({ id: "mem-1", content: "tea" }),
		]);

		mockSafeFetch.mockResolvedValue({ id: "mem-1", memory: "tea", user_id: "u1" });
		await expect(adapter.search({ query: "tea" })).resolves.toEqual([
			expect.objectContaining({ id: "mem-1", content: "tea", userId: "u1" }),
		]);
	});

	it("falls back to the text field and nested data when memory is missing", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) return [];
			return { data: { id: "mem-9", text: "nested content" } };
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-9")).resolves.toEqual(
			expect.objectContaining({ id: "mem-9", content: "nested content" })
		);
	});

	it("reads history wrapped in a results or history envelope", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) {
				return { results: [{ id: "h1", event: "ADD", new_memory: "hi" }] };
			}
			return { id: "mem-1", memory: "hi" };
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({
				history: [expect.objectContaining({ id: "h1", event: "ADD" })],
			})
		);

		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) {
				return { history: [{ id: "h2", event: "UPDATE", new_memory: "hi2" }] };
			}
			return { id: "mem-1", memory: "hi2" };
		});
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({
				history: [expect.objectContaining({ id: "h2", event: "UPDATE" })],
			})
		);
	});

	it("lists entities from a bare array response", async () => {
		mockSafeFetch.mockResolvedValue([
			{ id: "e1", name: "ada", type: "user", email: "ada@example.com" },
		]);
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [{ id: "ada", label: "ada@example.com" }],
			sessions: [],
			agents: [],
		});
	});

	it("lists entities keyed by owner and falls back to an entities array", async () => {
		mockSafeFetch.mockResolvedValue({
			entities: [
				{ owner: "agent", run_id: "run-9" },
				{ id: "no-name-user" },
			],
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [{ id: "no-name-user", label: "no-name-user" }],
			sessions: [],
			agents: [{ id: "run-9", label: "run-9" }],
		});
	});

	it("returns empty filters when listing entities fails", async () => {
		mockSafeFetch.mockRejectedValue(new Error("entities unavailable"));
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [],
			sessions: [],
			agents: [],
		});
	});

	it("updates a memory and normalizes the response", async () => {
		mockSafeFetch.mockResolvedValue({ id: "mem-1", memory: "Prefers spaces" });
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(
			adapter.update("mem-1", { content: "Prefers spaces" })
		).resolves.toEqual(expect.objectContaining({ id: "mem-1", content: "Prefers spaces" }));
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toBe("https://api.mem0.ai/v1/memories/mem-1/");
		expect(options.method).toBe("PUT");
	});

	it("falls back to the input payload when an update response cannot be normalized", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(
			adapter.update("mem-1", { content: "Prefers spaces" })
		).resolves.toEqual({ id: "mem-1", content: "Prefers spaces", metadata: undefined });
	});

	it("deletes a memory through the slash-aware request helper", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await adapter.delete("mem-1");
		expect(String(mockSafeFetch.mock.calls[0][0])).toBe(
			"https://api.mem0.ai/v1/memories/mem-1/"
		);
		expect(mockSafeFetch.mock.calls[0][1].method).toBe("DELETE");
	});

	it("builds fallback feedback when the vendor response omits it", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(
			adapter.feedback("mem-1", { rating: "positive" })
		).resolves.toEqual({ rating: "positive" });
		await expect(
			adapter.feedback("mem-1", { rating: null, reason: "Outdated" })
		).resolves.toEqual({ reason: "Outdated" });
	});

	it("rejects an empty search query", async () => {
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.search({ query: "   " })).rejects.toThrow(/query/i);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("rejects feedback for a blank memory id", async () => {
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.feedback("  ", { rating: "positive" })).rejects.toThrow();
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("normalizes messages using the text field, defaults the role, and skips blank items", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) return [];
			return {
				id: "mem-1",
				memory: "hello",
				messages: [{}, { text: "fallback text" }],
			};
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({
				input: [{ role: "user", content: "fallback text" }],
			})
		);
	});

	it("normalizes history rows using action/newMemory aliases, history_id, and default event", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) {
				return [
					{},
					{ history_id: "h1", action: "restored", newMemory: "hi again" },
				];
			}
			return { id: "mem-1", memory: "hi again" };
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({
				history: [
					expect.objectContaining({
						id: "h1",
						event: "restored",
						newMemory: "hi again",
					}),
				],
			})
		);
	});

	it("resolves input from history when the record has no direct input", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) {
				return [
					{
						event: "ADD",
						input: [{ role: "user", content: "from history" }],
					},
				];
			}
			return { memory: "hello there" };
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({
				id: "hello there",
				input: [{ role: "user", content: "from history" }],
			})
		);
	});

	it("returns an empty list when a search result cannot be normalized", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.search({ query: "tea" })).resolves.toEqual([]);
	});

	it("deduplicates entity choices and skips the app entity type", async () => {
		mockSafeFetch.mockResolvedValue({
			results: [
				{ id: "e1", name: "ada", type: "user", email: "ada@example.com" },
				{ id: "e1", name: "ada", type: "user", email: "ada@example.com" },
				{ name: "billing-app", type: "app" },
				{},
			],
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [{ id: "ada", label: "ada@example.com" }],
			sessions: [],
			agents: [],
		});
	});

	it("returns empty entity rows when the response has no recognizable shape", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [],
			sessions: [],
			agents: [],
		});
	});

	it("defaults the list page size when no limit is provided", async () => {
		mockSafeFetch.mockResolvedValue({ results: [] });
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await adapter.list({ userId: "u1" });
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("page_size=25");
	});

	it("scopes requests to an org and project when configured", async () => {
		mockSafeFetch.mockResolvedValue({ results: [] });
		const adapter = new Mem0Adapter(
			descriptor("mem0", { orgId: "org-1", projectId: "proj-1" })
		);
		await adapter.listFilters();
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("org_id=org-1");
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("project_id=proj-1");

		await adapter.search({ query: "tea" });
		expect(JSON.parse(mockSafeFetch.mock.calls[1][1].body)).toEqual(
			expect.objectContaining({ org_id: "org-1", project_id: "proj-1" })
		);
	});

	it("rejects adding a memory when content is only whitespace", async () => {
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.add({ content: "   " })).rejects.toThrow(/content/i);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("falls back to content for the id when the vendor id is only whitespace", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) return [];
			return { id: "   ", memory: "hello" };
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({ id: "hello", content: "hello" })
		);
	});

	it("captures a boolean synthesized flag on the record", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) return [];
			return { id: "mem-1", memory: "hello", synthesized: true };
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({ synthesized: true })
		);
	});

	it("captures feedback with only a rating, and separately with only a reason", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) return [];
			return { id: "mem-1", memory: "hello", feedback: "POSITIVE" };
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({ feedback: { rating: "positive" } })
		);

		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) return [];
			return { id: "mem-2", memory: "hello again", feedback_reason: "Just because" };
		});
		await expect(adapter.get("mem-2")).resolves.toEqual(
			expect.objectContaining({ feedback: { reason: "Just because" } })
		);
	});

	it("defaults history events to UPDATE when the row lacks an explicit event", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/history")) {
				return [{ new_memory: "no event field" }];
			}
			return { id: "mem-1", memory: "hello" };
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.get("mem-1")).resolves.toEqual(
			expect.objectContaining({
				history: [
					expect.objectContaining({ event: "UPDATE", newMemory: "no event field" }),
				],
			})
		);
	});

	it("retries without a trailing slash when the redirect error is not an Error instance", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			const href = String(url);
			if (href.endsWith("/mem-1/")) {
				throw "exceeded the maximum number of redirects";
			}
			return { id: "mem-1", memory: "hello" };
		});
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(
			adapter.update("mem-1", { content: "hello" })
		).resolves.toEqual(expect.objectContaining({ id: "mem-1", content: "hello" }));
		expect(String(mockSafeFetch.mock.calls[1][0])).toBe(
			"https://api.mem0.ai/v1/memories/mem-1"
		);
	});

	it("falls back to secret.raw for the Authorization header when credentials lack an apiKey", async () => {
		(resolveSourceSecret as jest.Mock).mockResolvedValueOnce({
			raw: "raw-secret",
			credentials: {},
		});
		mockSafeFetch.mockResolvedValue({ results: [] });
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await adapter.healthCheck();
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(options.headers.Authorization).toBe("Token raw-secret");
	});

	it("omits the Authorization header when the secret has no usable value", async () => {
		(resolveSourceSecret as jest.Mock).mockResolvedValueOnce({
			raw: "",
			credentials: {},
		});
		mockSafeFetch.mockResolvedValue({ results: [] });
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await adapter.healthCheck();
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(options.headers.Authorization).toBeUndefined();
	});

	it("uses the raw rejection value as the message when it has no .message property", async () => {
		mockSafeFetch.mockRejectedValue("entities down");
		const adapter = new Mem0Adapter(descriptor("mem0"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: "entities down" })
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

	it("exposes capabilities directly on the adapter instance", () => {
		const adapter = new ZepAdapter(descriptor("zep"));
		expect(adapter.capabilities()).toEqual({
			add: true,
			search: true,
			get: true,
			list: true,
			update: false,
			delete: true,
			feedback: false,
		});
	});

	it("reports an unhealthy connection when both user endpoints fail", async () => {
		mockSafeFetch.mockRejectedValue(new Error("network down"));
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringContaining("network down") })
		);
	});

	it("adds session memory from an explicit messages array", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new ZepAdapter(descriptor("zep"));
		await adapter.add({
			sessionId: "s1",
			messages: [{ role: "assistant", content: "hi there" }],
		});
		expect(JSON.parse(mockSafeFetch.mock.calls[0][1].body)).toEqual(
			expect.objectContaining({
				messages: [{ role: "assistant", content: "hi there" }],
			})
		);
	});

	it("requires content or messages when adding session memory", async () => {
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.add({ sessionId: "s1" })).rejects.toThrow(/content/i);
	});

	it("falls back to a synthesized record when the add response has no facts", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.add({ content: "hello there", sessionId: "s1" });
		expect(records).toEqual([
			expect.objectContaining({
				id: "s1",
				content: "hello there",
				sessionId: "s1",
			}),
		]);
	});

	it("searches session memory and falls through to graph search on failure without a user", async () => {
		mockSafeFetch.mockResolvedValue({
			facts: [{ uuid: "f1", fact: "Ada prefers tea" }],
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(
			adapter.search({ query: "tea", sessionId: "s1" })
		).resolves.toEqual([expect.objectContaining({ id: "f1" })]);
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("/sessions/s1/search");
	});

	it("rejects an empty search query", async () => {
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.search({ query: "  ", userId: "ada" })).rejects.toThrow(
			/query/i
		);
	});

	it("rethrows the session search error when no user id is available to fall back on", async () => {
		mockSafeFetch.mockRejectedValue(new Error("session search failed"));
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(
			adapter.search({ query: "tea", sessionId: "s1" })
		).rejects.toThrow("session search failed");
	});

	it("falls back to graph search when session search fails but a user id is present", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/sessions/")) throw new Error("no session memory");
			if (String(url).includes("/graph/search")) {
				return { facts: [{ uuid: "f2", fact: "Ada prefers coffee" }] };
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(
			adapter.search({ query: "coffee", sessionId: "s1", userId: "ada" })
		).resolves.toEqual([expect.objectContaining({ id: "f2" })]);
	});

	it("searches the user graph directly when no session id is given", async () => {
		mockSafeFetch.mockResolvedValue({
			facts: [{ uuid: "f3", fact: "Ada prefers dark mode" }],
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(
			adapter.search({ query: "dark mode", userId: "ada" })
		).resolves.toEqual([expect.objectContaining({ id: "f3" })]);
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("/graph/search");
	});

	it("treats string labels and single relevance scores as valid record fields", async () => {
		mockSafeFetch.mockResolvedValue([
			{
				uuid: "e1",
				fact: "Ada prefers TypeScript",
				labels: "Preference",
				relevance: 0.42,
			},
		]);
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada" });
		expect(records[0]).toEqual(
			expect.objectContaining({
				id: "e1",
				categories: ["Preference"],
				score: 0.42,
			})
		);
	});

	it("labels relation endpoints with their raw id when no name is present", async () => {
		mockSafeFetch.mockResolvedValue([
			{
				uuid: "e1",
				fact: "Sarah lives in Austin",
				source_node_uuid: "n-user",
				target_node_uuid: "n-loc",
			},
		]);
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada" });
		expect(records[0].relation).toEqual(
			expect.objectContaining({
				source: expect.objectContaining({ id: "n-user", label: "n-user" }),
				target: expect.objectContaining({ id: "n-loc", label: "n-loc" }),
			})
		);
	});

	it("falls back to raw session messages when there are no facts or context", async () => {
		mockSafeFetch.mockResolvedValue({
			messages: [{ uuid: "m1", role: "user", content: "hello there" }],
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ sessionId: "s1" });
		expect(records).toEqual([
			expect.objectContaining({
				id: "s1:0",
				content: "hello there",
				sessionId: "s1",
				metadata: { role: "user", memory_type: "temporal" },
			}),
		]);
	});

	it("normalizes session listFilters ids from a bare uuid", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/users")) return { users: [] };
			return { sessions: [{ uuid: "s9" }] };
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.listFilters()).resolves.toEqual(
			expect.objectContaining({ sessions: [{ id: "s9", label: "s9" }] })
		);
	});

	it("marks a graph edge deleted via invalid_at and falls back to expired_at", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/e1") && !String(url).includes("/user/")) {
				return {
					uuid: "e1",
					fact: "The plan lapsed",
					created_at: "2026-08-17T00:00:00Z",
					invalid_at: "2026-08-18T00:00:00Z",
				};
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("e1")).resolves.toEqual(
			expect.objectContaining({
				history: expect.arrayContaining([
					expect.objectContaining({ event: "DELETE", createdAt: "2026-08-18T00:00:00Z" }),
				]),
			})
		);

		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/e2") && !String(url).includes("/user/")) {
				return {
					uuid: "e2",
					fact: "The plan expired",
					created_at: "2026-08-17T00:00:00Z",
					expired_at: "2026-08-19T00:00:00Z",
				};
			}
			throw new Error(`unexpected ${url}`);
		});
		await expect(adapter.get("e2")).resolves.toEqual(
			expect.objectContaining({
				history: expect.arrayContaining([
					expect.objectContaining({ event: "DELETE", createdAt: "2026-08-19T00:00:00Z" }),
				]),
			})
		);
	});

	it("breaks user-graph pagination when a later page request fails", async () => {
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
			throw new Error("page failed");
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada", limit: 100 });
		expect(records).toHaveLength(50);
	});

	it("falls back to pure node listing when no user graph edges are collected", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/user/ada")) {
				throw new Error("edges unavailable");
			}
			if (String(url).includes("/graph/node/user/ada")) {
				return [{ uuid: "n1", name: "Topic", summary: "About tea" }];
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada" });
		expect(records).toEqual([expect.objectContaining({ id: "n1" })]);
	});

	it("returns just the facts when node enrichment fails after collecting edges", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/user/ada")) {
				return [{ uuid: "e1", fact: "Ada prefers tea" }];
			}
			if (String(url).includes("/graph/node/user/ada")) {
				throw new Error("nodes unavailable");
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada" });
		expect(records).toEqual([expect.objectContaining({ id: "e1" })]);
	});

	it("resolves the thread user from a nested session field", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/threads/s1/messages")) {
				return { session: { user_id: "ada" } };
			}
			if (String(url).includes("/graph/edge/user/ada")) {
				return [{ uuid: "e1", fact: "Ada prefers TypeScript" }];
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.list({ sessionId: "s1" })).resolves.toEqual([
			expect.objectContaining({ id: "e1", userId: "ada" }),
		]);
	});

	it("lists a session's raw thread context when the thread's user cannot be resolved", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/threads/s1/messages")) throw new Error("no user");
			if (String(url).includes("/sessions/s1")) throw new Error("no user");
			if (String(url).includes("/threads/s1/context")) {
				return { context: "Ada likes tea." };
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.list({ sessionId: "s1" })).resolves.toEqual([
			expect.objectContaining({ id: "s1", content: "Ada likes tea." }),
		]);
	});

	it("uses an explicit numeric score when the vendor provides one", async () => {
		mockSafeFetch.mockResolvedValue([
			{ uuid: "e1", fact: "Ada prefers TypeScript", score: 0.87 },
		]);
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada" });
		expect(records[0].score).toBe(0.87);
	});

	it("returns no filter choices when the vendor response has no recognizable rows", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [],
			sessions: [],
			agents: [],
		});
	});

	it("returns null when neither the graph nor the session memory can be fetched", async () => {
		mockSafeFetch.mockRejectedValue(new Error("unavailable"));
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("s1")).resolves.toBeNull();
	});

	it("clears user and session filters independently when both listings fail", async () => {
		mockSafeFetch.mockRejectedValue(new Error("vendor down"));
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [],
			sessions: [],
			agents: [],
		});
	});

	it("falls back to deleting the graph node when deleting the edge fails", async () => {
		mockSafeFetch.mockImplementation(async (url: string, options?: { method?: string }) => {
			if (String(url).includes("/graph/edge/e1") && options?.method === "DELETE") {
				throw new Error("edge not found");
			}
			return {};
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await adapter.delete("e1");
		expect(String(mockSafeFetch.mock.calls[1][0])).toContain("/api/v2/graph/node/e1");
		expect(mockSafeFetch.mock.calls[1][1].method).toBe("DELETE");
	});

	it("passes user id and metadata through when adding session memory", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new ZepAdapter(descriptor("zep"));
		await adapter.add({
			content: "hello",
			sessionId: "s1",
			userId: "ada",
			metadata: { source: "otter" },
		});
		expect(JSON.parse(mockSafeFetch.mock.calls[0][1].body)).toEqual(
			expect.objectContaining({
				user_id: "ada",
				metadata: { source: "otter" },
			})
		);
	});

	it("normalizes user and session filter rows with fallback id and label fields", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/users")) {
				return { users: [{ uuid: "u1", first_name: "Ada", last_name: "Lovelace" }] };
			}
			return { sessions: [{ session_id: "s1" }] };
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [{ id: "u1", label: "Ada Lovelace" }],
			sessions: [{ id: "s1", label: "s1", userId: undefined }],
			agents: [],
		});
	});

	it("normalizes session messages using the text field, defaults role, and skips blanks", async () => {
		mockSafeFetch.mockResolvedValue({
			context: "Ada likes tea.",
			messages: [{ uuid: "m0" }, { uuid: "m1", text: "fallback text" }],
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.add({ content: "hello", sessionId: "s1" });
		expect(records[0].input).toEqual([{ role: "user", content: "fallback text" }]);
	});

	it("captures the scope field on temporal facts", async () => {
		mockSafeFetch.mockResolvedValue([
			{ uuid: "e1", fact: "Ada prefers tea", scope: "project" },
		]);
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada" });
		expect(records[0].metadata).toEqual(
			expect.objectContaining({ scope: "project" })
		);
	});

	it("falls back to content as the id and leaves metadata empty for a bare node", async () => {
		mockSafeFetch.mockResolvedValue([{ uuid_: "", text: "raw text with no labels" }]);
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada" });
		expect(records[0]).toEqual(
			expect.objectContaining({ id: "raw text with no labels", metadata: undefined })
		);
	});

	it("deduplicates graph records that share the same id across groups", async () => {
		mockSafeFetch.mockResolvedValue({
			edges: [{ uuid: "e1", fact: "Ada prefers tea" }],
			facts: [{ uuid: "e1", fact: "Ada prefers tea" }],
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada" });
		expect(records).toHaveLength(1);
	});

	it("defaults empty ids/labels for users and sessions with no recognizable fields", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/users")) return { users: [{}] };
			return { sessions: [{}] };
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [],
			sessions: [],
			agents: [],
		});
	});

	it("returns null when getting a blank id", async () => {
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("   ")).resolves.toBeNull();
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("returns null when the session lookup succeeds but has no content", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/") || String(url).includes("/graph/node/")) {
				throw new Error("not found");
			}
			return {};
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("s1")).resolves.toBeNull();
	});

	it("returns no records when the first edge page is already empty", async () => {
		mockSafeFetch.mockResolvedValue([]);
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.list({ userId: "ada" })).resolves.toEqual([]);
	});

	it("returns null when deleting a blank id", async () => {
		const adapter = new ZepAdapter(descriptor("zep"));
		await adapter.delete("   ");
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("skips enriching a graph record that already carries input", async () => {
		mockSafeFetch.mockResolvedValue({
			uuid: "e1",
			fact: "Ada prefers tea",
			messages: [{ role: "user", content: "already here" }],
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("e1")).resolves.toEqual(
			expect.objectContaining({
				input: [{ role: "user", content: "already here" }],
			})
		);
	});

	it("leaves the record unchanged when every episode fetch fails", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/e1") && !String(url).includes("/user/")) {
				return { uuid: "e1", fact: "The plan is active", episodes: ["ep-1"] };
			}
			if (String(url).includes("/graph/episodes/")) throw new Error("gone");
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("e1")).resolves.toEqual(
			expect.objectContaining({ id: "e1", input: undefined })
		);
	});

	it("skips episodes with no content and falls back to role_type", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/e1") && !String(url).includes("/user/")) {
				return {
					uuid: "e1",
					fact: "The plan is active",
					episodes: ["ep-empty", "ep-role-type"],
				};
			}
			if (String(url).includes("/graph/episodes/ep-empty")) return { uuid: "ep-empty" };
			if (String(url).includes("/graph/episodes/ep-role-type")) {
				return { uuid: "ep-role-type", content: "renewed", role_type: "assistant" };
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("e1")).resolves.toEqual(
			expect.objectContaining({
				input: [{ role: "assistant", content: "renewed" }],
			})
		);
	});

	it("skips episodes that fail to load while enriching a graph record", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/e1") && !String(url).includes("/user/")) {
				return {
					uuid: "e1",
					fact: "The plan is active",
					episodes: ["ep-bad", "ep-good"],
				};
			}
			if (String(url).includes("/graph/episodes/ep-bad")) {
				throw new Error("episode missing");
			}
			if (String(url).includes("/graph/episodes/ep-good")) {
				return { uuid: "ep-good", content: "Plan renewed", role: "user" };
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("e1")).resolves.toEqual(
			expect.objectContaining({
				input: [{ role: "user", content: "Plan renewed" }],
			})
		);
	});

	it("coerces a numeric uuid to a string id", async () => {
		mockSafeFetch.mockResolvedValue([{ uuid: 501, fact: "Numeric id fact" }]);
		const adapter = new ZepAdapter(descriptor("zep"));
		const records = await adapter.list({ userId: "ada" });
		expect(records[0]).toEqual(expect.objectContaining({ id: "501" }));
	});

	it("reads a bare array response when listing users", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/users-ordered")) {
				return [{ user_id: "ada", email: "ada@example.com" }];
			}
			return { sessions: [] };
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.listFilters()).resolves.toEqual(
			expect.objectContaining({ users: [{ id: "ada", label: "ada@example.com" }] })
		);
	});

	it("falls back to secret.raw for the Api-Key header when credentials lack an apiKey", async () => {
		(resolveSourceSecret as jest.Mock).mockResolvedValueOnce({
			raw: "raw-secret",
			credentials: {},
		});
		mockSafeFetch.mockResolvedValue({ users: [] });
		const adapter = new ZepAdapter(descriptor("zep"));
		await adapter.healthCheck();
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(options.headers.Authorization).toBe("Api-Key raw-secret");
	});

	it("omits the Authorization header when the secret has no usable value", async () => {
		(resolveSourceSecret as jest.Mock).mockResolvedValueOnce({
			raw: "",
			credentials: {},
		});
		mockSafeFetch.mockResolvedValue({ users: [] });
		const adapter = new ZepAdapter(descriptor("zep"));
		await adapter.healthCheck();
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(options.headers.Authorization).toBeUndefined();
	});

	it("wraps a non-Error rejection into an Error when every health-check attempt fails", async () => {
		mockSafeFetch.mockImplementation(async () => {
			throw "vendor exploded";
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringContaining("vendor exploded") })
		);
	});

	it("uses the raw error value as the message when the wrapped error has no message text", async () => {
		mockSafeFetch.mockRejectedValue(new Error(""));
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: "Error" })
		);
	});

	it("defaults an episode's role to user when role and role_type are both missing", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/graph/edge/e1") && !String(url).includes("/user/")) {
				return { uuid: "e1", fact: "The plan is active", episodes: ["ep-1"] };
			}
			if (String(url).includes("/graph/episodes/ep-1")) {
				return { uuid: "ep-1", content: "Plan details" };
			}
			throw new Error(`unexpected ${url}`);
		});
		const adapter = new ZepAdapter(descriptor("zep"));
		await expect(adapter.get("e1")).resolves.toEqual(
			expect.objectContaining({
				input: [{ role: "user", content: "Plan details" }],
			})
		);
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
			"sessionId",
		]);
		expect(described.filterFields?.[0]).toMatchObject({
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
			users: [],
			sessions: [{ id: "memstore_1", label: "User Preferences" }],
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

	it("exposes capabilities directly on the adapter instance", () => {
		const adapter = new ClaudeAdapter(descriptor("claude"));
		expect(adapter.capabilities()).toEqual({
			add: true,
			search: true,
			get: true,
			list: true,
			update: true,
			delete: true,
			feedback: false,
		});
	});

	it("health-checks a specific store when storeId is configured", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		expect(String(mockSafeFetch.mock.calls[0][0])).toBe(
			"https://api.anthropic.com/v1/memory_stores/memstore_1"
		);
	});

	it("reports an unhealthy connection when the store request fails", async () => {
		mockSafeFetch.mockRejectedValue(new Error("store unreachable"));
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringContaining("store unreachable") })
		);
	});

	it("rejects adding a memory with no content or messages", async () => {
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await expect(adapter.add({})).rejects.toThrow(/content/i);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("includes content_size_bytes in metadata when the vendor reports it", async () => {
		mockSafeFetch.mockResolvedValue({
			id: "mem_1",
			path: "/a.md",
			content: "Prefers TypeScript",
			memory_store_id: "memstore_1",
			content_size_bytes: 42,
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await expect(adapter.add({ content: "Prefers TypeScript" })).resolves.toEqual([
			expect.objectContaining({
				metadata: expect.objectContaining({ content_size_bytes: 42 }),
			}),
		]);
	});

	it("paginates memory store listings using next_page", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("page=p2")) {
				return { data: [{ id: "memstore_2", name: "Two" }] };
			}
			return { data: [{ id: "memstore_1", name: "One" }], next_page: "p2" };
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [],
			sessions: [
				{ id: "memstore_1", label: "One" },
				{ id: "memstore_2", label: "Two" },
			],
			agents: [],
		});
	});

	it("returns empty filters when listing stores fails", async () => {
		mockSafeFetch.mockRejectedValue(new Error("stores unavailable"));
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [],
			sessions: [],
			agents: [],
		});
	});

	it("resolves a bare memory id using the configured store", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/memory_versions")) return { data: [] };
			return {
				id: "mem_1",
				path: "/a.md",
				content: "Prefers TypeScript",
				memory_store_id: "memstore_1",
			};
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await expect(adapter.get("mem_1")).resolves.toEqual(
			expect.objectContaining({ id: "memstore_1:mem_1" })
		);
	});

	it("returns null when a memory id cannot be resolved to a store", async () => {
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.get("mem_1")).resolves.toBeNull();
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("still returns the memory when the version history request fails", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/memory_versions")) throw new Error("no history");
			return {
				id: "mem_1",
				path: "/a.md",
				content: "Prefers TypeScript",
				memory_store_id: "memstore_1",
			};
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.get("memstore_1:mem_1")).resolves.toEqual(
			expect.objectContaining({ id: "memstore_1:mem_1", history: [] })
		);
	});

	it("reads a memory_versions response that is a raw array", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/memory_versions")) {
				return [{ id: "memver_1", operation: "created", content: "Prefers bun" }];
			}
			return {
				id: "mem_1",
				path: "/a.md",
				content: "Prefers bun",
				memory_store_id: "memstore_1",
			};
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.get("memstore_1:mem_1")).resolves.toEqual(
			expect.objectContaining({
				history: [expect.objectContaining({ id: "memver_1", event: "ADD" })],
			})
		);
	});

	it("updates a memory and merges a normalized path", async () => {
		mockSafeFetch.mockResolvedValue({
			id: "mem_1",
			path: "/renamed.md",
			content: "Prefers bun",
			memory_store_id: "memstore_1",
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(
			adapter.update("memstore_1:mem_1", {
				content: "Prefers bun",
				metadata: { path: "renamed.md" },
			})
		).resolves.toEqual(
			expect.objectContaining({ id: "memstore_1:mem_1", content: "Prefers bun" })
		);
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(JSON.parse(options.body)).toEqual({
			content: "Prefers bun",
			path: "/renamed.md",
		});
	});

	it("falls back to the input payload when an update response cannot be normalized", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(
			adapter.update("memstore_1:mem_1", { content: "Prefers bun" })
		).resolves.toEqual({
			id: "memstore_1:mem_1",
			content: "Prefers bun",
			sessionId: "memstore_1",
			metadata: undefined,
		});
	});

	it("rejects updating or deleting a memory whose id cannot be resolved", async () => {
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(
			adapter.update("mem_1", { content: "hello" })
		).rejects.toThrow(/could not be found/i);
		await expect(adapter.delete("mem_1")).rejects.toThrow(/could not be found/i);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("deletes a memory by composite id", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await adapter.delete("memstore_1:mem_1");
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toBe(
			"https://api.anthropic.com/v1/memory_stores/memstore_1/memories/mem_1"
		);
		expect(options.method).toBe("DELETE");
	});

	it("returns null when getting a blank memory id", async () => {
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await expect(adapter.get("   ")).resolves.toBeNull();
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("rejects an empty search query", async () => {
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await expect(adapter.search({ query: "   " })).rejects.toThrow(/query/i);
	});

	it("resolves a single store automatically when none is specified", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/memory_stores?")) {
				return { data: [{ id: "memstore_only", name: "Only" }] };
			}
			return { data: [] };
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.list({})).resolves.toEqual([]);
	});

	it("falls back to memory when a store row has no name and skips rows with no id", async () => {
		mockSafeFetch.mockResolvedValue({
			data: [{ id: "memstore_1" }, { name: "no id" }],
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [],
			sessions: [{ id: "memstore_1", label: "memstore_1" }],
			agents: [],
		});
	});

	it("paginates a store's memory listing using next_page", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("&page=p2")) {
				return {
					data: [
						{ id: "mem_2", content: "Second page", memory_store_id: "memstore_1" },
					],
				};
			}
			return {
				data: [
					{ id: "mem_1", content: "First page", memory_store_id: "memstore_1" },
				],
				next_page: "p2",
			};
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		const records = await adapter.list({});
		expect(records.map((record) => record.id)).toEqual([
			"memstore_1:mem_1",
			"memstore_1:mem_2",
		]);
	});

	it("normalizes memories missing a path or content, and captures version/sha metadata", async () => {
		mockSafeFetch.mockResolvedValue({
			id: "mem_1",
			memory_store_id: "memstore_1",
			memory_version_id: "v2",
			content_sha256: "abc123",
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await expect(adapter.add({ content: "irrelevant, path defaults" })).resolves.toEqual([
			expect.objectContaining({
				id: "memstore_1:mem_1",
				content: "",
				categories: undefined,
				metadata: expect.objectContaining({
					memory_version_id: "v2",
					content_sha256: "abc123",
				}),
			}),
		]);
	});

	it("returns an empty list when the created memory cannot be normalized", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await expect(adapter.add({ content: "hello" })).resolves.toEqual([]);
	});

	it("keeps an absolute metadata path unchanged when updating", async () => {
		mockSafeFetch.mockResolvedValue({
			id: "mem_1",
			path: "/already/slash.md",
			content: "hello",
			memory_store_id: "memstore_1",
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await adapter.update("memstore_1:mem_1", {
			content: "hello",
			metadata: { path: "/already/slash.md" },
		});
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(JSON.parse(options.body)).toEqual({
			content: "hello",
			path: "/already/slash.md",
		});
	});

	it("reads history rows with no operation and unmapped operations", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/memory_versions")) {
				return {
					data: [
						{ id: "v1", content: "no-op row" },
						{ id: "v2", operation: "archived", content: "unmapped op" },
					],
				};
			}
			return {
				id: "mem_1",
				content: "hello",
				memory_store_id: "memstore_1",
			};
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.get("memstore_1:mem_1")).resolves.toEqual(
			expect.objectContaining({
				history: [
					expect.objectContaining({ id: "v1", event: "UPDATE" }),
					expect.objectContaining({ id: "v2", event: "ARCHIVED" }),
				],
			})
		);
	});

	it("rejects adding a memory when content is only whitespace", async () => {
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await expect(adapter.add({ content: "   " })).rejects.toThrow(/content/i);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("falls back to a generic slug when the content has no alphanumeric characters", async () => {
		mockSafeFetch.mockResolvedValue({
			id: "mem_1",
			path: "/openlit/memory.md",
			content: "!!!",
			memory_store_id: "memstore_1",
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await adapter.add({ content: "!!!" });
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(JSON.parse(options.body)).toEqual({
			path: "/openlit/memory.md",
			content: "!!!",
		});
	});

	it("uses a metadata path when adding a memory, adding a leading slash if missing", async () => {
		mockSafeFetch.mockResolvedValue({
			id: "mem_1",
			path: "/notes/today.md",
			content: "Standup notes",
			memory_store_id: "memstore_1",
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await adapter.add({
			content: "Standup notes",
			metadata: { path: "notes/today.md" },
		});
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(JSON.parse(options.body)).toEqual({
			path: "/notes/today.md",
			content: "Standup notes",
		});
	});

	it("keeps an already-absolute metadata path unchanged when adding a memory", async () => {
		mockSafeFetch.mockResolvedValue({
			id: "mem_1",
			path: "/notes/today.md",
			content: "Standup notes",
			memory_store_id: "memstore_1",
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		await adapter.add({
			content: "Standup notes",
			metadata: { path: "/notes/today.md" },
		});
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(JSON.parse(options.body)).toEqual({
			path: "/notes/today.md",
			content: "Standup notes",
		});
	});

	it("returns an empty page when a store listing is neither wrapped nor a bare array", async () => {
		mockSafeFetch.mockResolvedValue({});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [],
			sessions: [],
			agents: [],
		});
	});

	it("treats a root-only path as having no categories", async () => {
		mockSafeFetch.mockResolvedValue({
			data: [
				{ id: "mem_1", path: "/", content: "root memory", memory_store_id: "memstore_1" },
			],
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		const records = await adapter.list({});
		expect(records[0]).toEqual(
			expect.objectContaining({ id: "memstore_1:mem_1", categories: undefined })
		);
	});

	it("matches search queries against a memory that has no categories", async () => {
		mockSafeFetch.mockResolvedValue({
			data: [
				{ id: "mem_1", content: "Uses vim keybindings", memory_store_id: "memstore_1" },
			],
		});
		const adapter = new ClaudeAdapter(
			descriptor("claude", { storeId: "memstore_1" })
		);
		const records = await adapter.search({ query: "vim" });
		expect(records).toEqual([
			expect.objectContaining({ id: "memstore_1:mem_1", categories: undefined }),
		]);
	});

	it("treats a version-history response with no data array as empty", async () => {
		mockSafeFetch.mockImplementation(async (url: string) => {
			if (String(url).includes("/memory_versions")) return {};
			return {
				id: "mem_1",
				path: "/a.md",
				content: "hello",
				memory_store_id: "memstore_1",
			};
		});
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.get("memstore_1:mem_1")).resolves.toEqual(
			expect.objectContaining({ history: [] })
		);
	});

	it("reads a bare array response when listing memory stores", async () => {
		mockSafeFetch.mockResolvedValue([{ id: "memstore_1", name: "Only" }]);
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.listFilters()).resolves.toEqual({
			users: [],
			sessions: [{ id: "memstore_1", label: "Only" }],
			agents: [],
		});
	});

	it("falls back to secret.raw for the x-api-key header when credentials lack an apiKey", async () => {
		(resolveSourceSecret as jest.Mock).mockResolvedValueOnce({
			raw: "raw-secret",
			credentials: {},
		});
		mockSafeFetch.mockResolvedValue({ data: [] });
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await adapter.healthCheck();
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(options.headers["x-api-key"]).toBe("raw-secret");
	});

	it("omits the x-api-key header when the secret has no usable value", async () => {
		(resolveSourceSecret as jest.Mock).mockResolvedValueOnce({
			raw: "",
			credentials: {},
		});
		mockSafeFetch.mockResolvedValue({ data: [] });
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await adapter.healthCheck();
		const [, options] = mockSafeFetch.mock.calls[0];
		expect(options.headers["x-api-key"]).toBeUndefined();
	});

	it("uses the raw rejection value as the message when it has no .message property", async () => {
		mockSafeFetch.mockRejectedValue("store down");
		const adapter = new ClaudeAdapter(descriptor("claude"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: "store down" })
		);
	});
});
