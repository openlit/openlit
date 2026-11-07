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
import { MemcodeAdapter, memcodeAdapterFactory } from "@/lib/platform/connectors/memory/memcode/adapter";
import { ZepAdapter, zepAdapterFactory } from "@/lib/platform/connectors/memory/zep/adapter";
import { CogneeAdapter, cogneeAdapterFactory } from "@/lib/platform/connectors/memory/cognee/adapter";
import {
	SupermemoryAdapter,
	supermemoryAdapterFactory,
} from "@/lib/platform/connectors/memory/supermemory/adapter";
import {
	LangGraphAdapter,
	langgraphAdapterFactory,
} from "@/lib/platform/connectors/memory/langgraph/adapter";
import { SourceResponseError } from "@/lib/platform/connectors/datasource/http/safe-fetch";
import { resolveSourceSecret } from "@/lib/platform/connectors/datasource/http/secret";
import type { MemorySourceDescriptor } from "@/lib/platform/connectors/memory/types";
import { UnsupportedMemoryCapabilityError } from "@/lib/platform/connectors/memory/types";

function defaultUrl(type: "claude" | "mem0" | "memcode" | "zep"): string {
	if (type === "claude") return "https://api.anthropic.com";
	if (type === "mem0") return "https://api.mem0.ai";
	if (type === "memcode") return "https://memory.memcode.in";
	return "https://api.getzep.com";
}

function descriptor(
	type: "claude" | "mem0" | "memcode" | "zep",
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

describe("Memcode adapter", () => {
	it("describes list with no page filters at all", () => {
		const described = memcodeAdapterFactory.describe();
		expect(described.type).toBe("memcode");
		expect(described.capabilities).toEqual({
			add: true,
			search: true,
			get: false,
			list: true,
			update: false,
			delete: false,
			feedback: false,
		});
		expect(described.configFields.map((field) => field.key)).toEqual(
			expect.arrayContaining(["url", "apiKey"])
		);
		// The API key is the tenant: Memory API v2 discards a client-sent user_id
		// in production, so offering a user control would be a lie.
		expect(described.filterFields).toEqual([]);
		// v2 has no get-by-id route, so a listed record is the whole record and
		// the detail sheet must not warn about a fetch it never needed.
		expect(described.detailFromList).toBe(true);
		expect(described.docsUrl).toBe("https://memcode.in/docs");
	});

	it("probes liveness then GET /v2/test, never the list route", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ status: "ok", data: { status: "ready" } })
			.mockResolvedValueOnce({
				status: "ok",
				data: {
					authenticated: true,
					principal_type: "legacy_user",
					user_id: "user-123",
					username: "ishaan",
				},
			});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		const urls = mockSafeFetch.mock.calls.map((call) => String(call[0]));
		expect(urls).toEqual([
			"https://memory.memcode.in/health",
			"https://memory.memcode.in/v2/test",
		]);
		// A limit=1 list still materialises the whole account server-side, so it
		// must never be the probe.
		expect(urls.some((url) => url.includes("/v2/memory"))).toBe(false);
		expect(mockSafeFetch.mock.calls[1][1].headers.Authorization).toBe(
			"Bearer secret-key"
		);
	});

	it("tells the operator when a deployment predates GET /v2/test", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ status: "ok", data: { status: "ready" } })
			.mockRejectedValueOnce(new SourceResponseError(404, "Not Found"));
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({
				ok: false,
				message: expect.stringMatching(/\/v2\/test/),
			})
		);
	});

	it("reports a rejected key instead of passing the connection", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ status: "ok", data: { status: "ready" } })
			.mockRejectedValueOnce(new SourceResponseError(401, "invalid api key"));
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringMatching(/rejected/i) })
		);
	});

	it("reports an out-of-credit account separately from a bad key", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({ status: "ok", data: { status: "ready" } })
			.mockRejectedValueOnce(new SourceResponseError(402, "insufficient credits"));
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringMatching(/credit/i) })
		);
	});

	it("fails a base URL that is not a Memory API", async () => {
		// A 404 is the credential probe's success answer, so without a decisive
		// liveness check a host that 404s everything would pass.
		mockSafeFetch.mockRejectedValue(new SourceResponseError(404, "not found"));
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({
				ok: false,
				message: expect.stringMatching(/No MemCode Memory API/i),
			})
		);
		// It never reaches the credential probe.
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	});

	it("reports a service that is up but still loading", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			status: "ok",
			data: { status: "loading" },
		});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringMatching(/starting up/i) })
		);
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
	});

	it("reports a 503 from /health as still starting up", async () => {
		mockSafeFetch.mockRejectedValue(new SourceResponseError(503, "not ready"));
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({
				ok: false,
				message: expect.stringMatching(/starting up/i),
			})
		);
	});

	it("passes on the live /health envelope shape", async () => {
		// Exactly what https://memory.memcode.in/health returns today.
		mockSafeFetch
			.mockResolvedValueOnce({
				status: "ok",
				request_id: null,
				data: {
					status: "ready",
					pipelines_ready: true,
					version: "1.0.0",
					uptime_seconds: 1035663.1,
					error: null,
				},
				error: null,
			})
			.mockResolvedValueOnce({
				status: "ok",
				data: { authenticated: true, principal_type: "legacy_user", user_id: "u1" },
			});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
	});

	it("omits user_id when no user filter is pinned", async () => {
		mockSafeFetch.mockResolvedValue({ status: "ok", data: { memory_results: [] } });
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await expect(adapter.search({ query: "berlin" })).resolves.toEqual([]);
		expect(JSON.parse(mockSafeFetch.mock.calls[0][1].body)).not.toHaveProperty(
			"user_id"
		);
	});

	it("forwards a pinned user id as a narrowing filter", async () => {
		mockSafeFetch.mockResolvedValue({ status: "ok", data: { memory_results: [] } });
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await adapter.search({ query: "berlin", userId: " user_42 " });
		expect(JSON.parse(mockSafeFetch.mock.calls[0][1].body)).toEqual(
			expect.objectContaining({ user_id: "user_42" })
		);
	});

	it("ingests without a user id when none is pinned", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({
				status: "ok",
				data: { job_id: "memory_ingest:1", status: "completed" },
			})
			.mockResolvedValueOnce({
				status: "ok",
				data: { job_id: "memory_ingest:1", status: "completed" },
			})
			.mockResolvedValueOnce({ status: "ok", data: { memory_results: [] } });
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await adapter.add({ content: "I moved to Berlin." });
		expect(JSON.parse(mockSafeFetch.mock.calls[0][1].body)).not.toHaveProperty(
			"user_id"
		);
	});

	it("searches v2 memory and maps domains onto records", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "ok",
			data: {
				memory_results: [
					{
						domain: "profile",
						content: "The user lives in Berlin.",
						score: 0.94,
						metadata: { source: "conversation" },
					},
				],
				original_chunks: [
					{
						domain: "original",
						content: "I moved to Berlin.",
						score: 0.89,
					},
				],
			},
		});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		const records = await adapter.search({ query: "where do they live", userId: "user_42" });
		expect(records).toHaveLength(2);
		expect(records[0]).toEqual(
			expect.objectContaining({
				content: "The user lives in Berlin.",
				userId: "user_42",
				categories: ["profile"],
				score: 0.94,
			})
		);
		expect(records[0].id).toContain("profile:");
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toBe("https://memory.memcode.in/v2/memory/search");
		expect(JSON.parse(options.body)).toEqual(
			expect.objectContaining({
				query: "where do they live",
				user_id: "user_42",
				domains: ["profile", "temporal", "summary"],
			})
		);
	});

	it("lists stored memories from GET /v2/memory without user_id", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "ok",
			data: {
				items: [
					{
						id: "mem_01K2",
						domain: "profile",
						content: "The user lives in Berlin.",
						content_complete: true,
						metadata: {},
						created_at: "2026-08-17T09:30:04Z",
						updated_at: "2026-08-17T09:30:04Z",
					},
				],
				total_memories: 1,
				limit: 100,
				offset: 0,
				has_more: false,
			},
		});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		const records = await adapter.list({ limit: 10 });
		expect(records).toEqual([
			expect.objectContaining({
				id: "mem_01K2",
				content: "The user lives in Berlin.",
				categories: ["profile"],
				createdAt: "2026-08-17T09:30:04Z",
				updatedAt: "2026-08-17T09:30:04Z",
			}),
		]);
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		const [url, options] = mockSafeFetch.mock.calls[0];
		expect(String(url)).toBe(
			"https://memory.memcode.in/v2/memory?limit=10&offset=0"
		);
		expect(options.method).toBe("GET");
		expect(options.body).toBeUndefined();
	});

	it("pages GET /v2/memory while has_more is true", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({
				status: "ok",
				data: {
					items: [
						{ id: "mem_1", domain: "profile", content: "Lives in Berlin." },
					],
					total_memories: 2,
					limit: 1,
					offset: 0,
					has_more: true,
				},
			})
			.mockResolvedValueOnce({
				status: "ok",
				data: {
					items: [
						{ id: "mem_2", domain: "temporal", content: "Prefers mornings." },
					],
					total_memories: 2,
					limit: 1,
					offset: 1,
					has_more: false,
				},
			});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		const records = await adapter.list({ limit: 2 });
		expect(records.map((record) => record.id)).toEqual(["mem_1", "mem_2"]);
		expect(String(mockSafeFetch.mock.calls[0][0])).toBe(
			"https://memory.memcode.in/v2/memory?limit=2&offset=0"
		);
		expect(String(mockSafeFetch.mock.calls[1][0])).toBe(
			"https://memory.memcode.in/v2/memory?limit=1&offset=1"
		);
	});

	it("pages GET /v2/memory past the 500-row page cap", async () => {
		const page = (offset: number, size: number) => ({
			status: "ok",
			data: {
				items: Array.from({ length: size }, (_, index) => ({
					id: `mem_${offset + index}`,
					domain: "summary",
					content: `Memory ${offset + index}`,
				})),
				total_memories: 1200,
				limit: size,
				offset,
				has_more: offset + size < 1200,
			},
		});
		mockSafeFetch
			.mockResolvedValueOnce(page(0, 500))
			.mockResolvedValueOnce(page(500, 500))
			.mockResolvedValueOnce(page(1000, 200));
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		const records = await adapter.list({ limit: 1200 });
		expect(records).toHaveLength(1200);
		expect(mockSafeFetch.mock.calls.map((call) => String(call[0]))).toEqual([
			"https://memory.memcode.in/v2/memory?limit=500&offset=0",
			"https://memory.memcode.in/v2/memory?limit=500&offset=500",
			"https://memory.memcode.in/v2/memory?limit=200&offset=1000",
		]);
	});

	it("reports total_memories and has_more from one list page", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "ok",
			data: {
				items: [{ id: "mem_1", domain: "profile", content: "Lives in Berlin." }],
				total_memories: 42,
				limit: 1,
				offset: 10,
				has_more: true,
			},
		});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		await expect(adapter.listPage({ limit: 1, offset: 10 })).resolves.toEqual({
			records: [expect.objectContaining({ id: "mem_1" })],
			total: 42,
			hasMore: true,
			nextOffset: 11,
		});
		expect(String(mockSafeFetch.mock.calls[0][0])).toBe(
			"https://memory.memcode.in/v2/memory?limit=1&offset=10"
		);
	});

	it("builds a weighted knowledge graph from GET /v2/memory-graph", async () => {
		mockSafeFetch.mockResolvedValue({
			status: "ok",
			data: {
				nodes: [
					{
						id: "memory_a",
						type: "profile",
						label: "Lives in Berlin",
						metadata: { content: "The user lives in Berlin." },
					},
					{
						id: "memory_b",
						type: "temporal",
						label: "Moved in May",
						metadata: { content: "Moved to Berlin in May." },
					},
				],
				edges: [
					{
						source: "memory_a",
						target: "memory_b",
						type: "related_to",
						domain: "profile",
						weight: 0.91,
						strength: 0.91,
					},
					// Endpoints outside the node page are dropped rather than drawn
					// as edges into nothing.
					{ source: "memory_a", target: "memory_z", type: "related_to", weight: 0.4 },
				],
				total_memories: 2,
				domains: ["profile", "temporal"],
				limit: 500,
				offset: 0,
				has_more: false,
				has_more_edges: false,
			},
		});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		const graph = await adapter.graph({});
		expect(String(mockSafeFetch.mock.calls[0][0])).toBe(
			"https://memory.memcode.in/v2/memory-graph?limit=5000&offset=0&edge_limit=10000&edge_offset=0"
		);
		expect(graph.kind).toBe("knowledge");
		expect(graph.weighted).toBe(true);
		expect(graph.totalMemories).toBe(2);
		expect(graph.domains).toEqual(["profile", "temporal"]);
		expect(graph.nodes).toEqual([
			expect.objectContaining({
				id: "memory_a",
				type: "memory",
				memoryId: "memory_a",
				kind: "profile",
			}),
			expect.objectContaining({
				id: "memory_b",
				type: "memory",
				memoryId: "memory_b",
				kind: "temporal",
			}),
		]);
		expect(graph.edges).toEqual([
			{
				from: "memory_a",
				to: "memory_b",
				label: "related_to",
				domain: "profile",
				weight: 0.91,
			},
		]);
	});

	it("drains graph edges before advancing the node cursor", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({
				status: "ok",
				data: {
					nodes: [
						{ id: "memory_a", type: "summary", label: "A" },
						{ id: "memory_b", type: "summary", label: "B" },
					],
					edges: [
						{ source: "memory_a", target: "memory_b", type: "related_to", weight: 0.7 },
					],
					total_memories: 4,
					domains: ["summary"],
					limit: 500,
					offset: 0,
					has_more: true,
					edge_offset: 0,
					has_more_edges: true,
				},
			})
			// An edge-continuation page repeats the current node window, so node
			// dedupe has to hold while only the edge cursor moves.
			.mockResolvedValueOnce({
				status: "ok",
				data: {
					nodes: [
						{ id: "memory_a", type: "summary", label: "A" },
						{ id: "memory_b", type: "summary", label: "B" },
					],
					edges: [
						{ source: "memory_b", target: "memory_a", type: "related_to", weight: 0.5 },
					],
					total_memories: 4,
					domains: ["summary"],
					limit: 500,
					offset: 0,
					has_more: true,
					edge_offset: 1,
					has_more_edges: false,
				},
			})
			.mockResolvedValueOnce({
				status: "ok",
				data: {
					nodes: [
						{ id: "memory_c", type: "summary", label: "C" },
						{ id: "memory_d", type: "summary", label: "D" },
					],
					edges: [
						{ source: "memory_c", target: "memory_d", type: "related_to", weight: 0.6 },
					],
					total_memories: 4,
					domains: ["summary"],
					limit: 500,
					offset: 2,
					has_more: false,
					edge_offset: 0,
					has_more_edges: false,
				},
			});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		const graph = await adapter.graph({});
		expect(mockSafeFetch.mock.calls.map((call) => String(call[0]))).toEqual([
			"https://memory.memcode.in/v2/memory-graph?limit=5000&offset=0&edge_limit=10000&edge_offset=0",
			"https://memory.memcode.in/v2/memory-graph?limit=5000&offset=0&edge_limit=10000&edge_offset=1",
			"https://memory.memcode.in/v2/memory-graph?limit=5000&offset=2&edge_limit=10000&edge_offset=0",
		]);
		expect(graph.nodes.map((node) => node.id)).toEqual([
			"memory_a",
			"memory_b",
			"memory_c",
			"memory_d",
		]);
		expect(graph.edges).toHaveLength(3);
		expect(graph.truncated).toBe(false);
	});

	it("keeps connected memories when the graph is too large to lay out", async () => {
		// An account with thousands of unconnected memories must not ship every
		// one of them as an SVG node.
		mockSafeFetch.mockResolvedValue({
			status: "ok",
			data: {
				nodes: Array.from({ length: 900 }, (_, index) => ({
					id: `memory_${index}`,
					type: "summary",
					label: `Memory ${index}`,
				})),
				edges: [
					{ source: "memory_800", target: "memory_801", type: "hebbian", weight: 0.9 },
				],
				total_memories: 900,
				domains: ["summary"],
				limit: 5000,
				offset: 0,
				has_more: false,
				has_more_edges: false,
			},
		});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		const graph = await adapter.graph({});
		expect(graph.nodes).toHaveLength(600);
		expect(graph.truncated).toBe(true);
		// Both endpoints of the only connection survive the cap.
		expect(graph.nodes.slice(0, 2).map((node) => node.id)).toEqual([
			"memory_800",
			"memory_801",
		]);
		expect(graph.edges).toHaveLength(1);
	});

	it("ingests a turn, polls the job, then searches extracted memories", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({
				status: "ok",
				data: {
					job_id: "memory_ingest:8d64",
					status: "queued",
					status_url: "/v2/memory/ingest/memory_ingest%3A8d64/status",
				},
			})
			.mockResolvedValueOnce({
				status: "ok",
				data: {
					job_id: "memory_ingest:8d64",
					status: "completed",
					result: { classification: ["profile"] },
				},
			})
			.mockResolvedValueOnce({
				status: "ok",
				data: {
					memory_results: [
						{ domain: "profile", content: "The user lives in Berlin.", score: 0.9 },
					],
				},
			});
		const adapter = new MemcodeAdapter(descriptor("memcode"));
		const records = await adapter.add({
			content: "I moved to Berlin and prefer morning meetings.",
			userId: "user_42",
		});
		expect(records[0]).toEqual(
			expect.objectContaining({
				content: "The user lives in Berlin.",
				userId: "user_42",
			})
		);
		expect(String(mockSafeFetch.mock.calls[0][0])).toBe(
			"https://memory.memcode.in/v2/memory/ingest"
		);
		expect(JSON.parse(mockSafeFetch.mock.calls[0][1].body)).toEqual(
			expect.objectContaining({
				user_query: "I moved to Berlin and prefer morning meetings.",
				user_id: "user_42",
			})
		);
		expect(String(mockSafeFetch.mock.calls[1][0])).toBe(
			"https://memory.memcode.in/v2/memory/ingest/memory_ingest%3A8d64/status"
		);
		expect(mockSafeFetch.mock.calls[0][1].headers["Idempotency-Key"]).toMatch(
			/^openlit-/
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

describe("LangGraph adapter", () => {
	const BASE = "https://langgraph.example.com";

	function lgDescriptor(settings: Record<string, unknown> = {}): MemorySourceDescriptor {
		return {
			type: "langgraph",
			id: "memory:langgraph",
			settings: { url: BASE, ...settings },
			secretRef: "vault-1",
			name: "langgraph",
			projectId: "proj-1",
		};
	}

	function call(index: number) {
		const [url, options] = mockSafeFetch.mock.calls[index];
		return {
			url: String(url),
			method: options.method,
			headers: options.headers,
			body: options.body === undefined ? undefined : JSON.parse(options.body),
		};
	}

	function item(namespace: string[], key: string, value: unknown, extra: Record<string, unknown> = {}) {
		return {
			namespace,
			key,
			value,
			created_at: "2026-09-01T00:00:00Z",
			updated_at: "2026-09-02T00:00:00Z",
			...extra,
		};
	}

	it("describes a self-hosted friendly config schema and capabilities", () => {
		const described = langgraphAdapterFactory.describe();
		expect(described.type).toBe("langgraph");
		expect(described.capabilities).toEqual({
			add: true,
			search: true,
			get: true,
			list: true,
			update: true,
			delete: true,
			feedback: false,
		});
		expect(described.configFields.map((field) => field.key)).toEqual([
			"url",
			"allowHttp",
			"allowPrivateNetwork",
			"apiKey",
			"namespaceTemplate",
		]);
		expect(described.configFields[0].defaultValue).toBeUndefined();
		expect(described.filterFields?.map((field) => field.key)).toEqual([
			"userId",
			"sessionId",
			"agentId",
		]);
		expect(described.filterFields?.every((field) => !field.required)).toBe(true);
		expect(described.authStyle).toBe("api-key");
	});

	it("health-checks an authenticated store route and sends x-api-key", async () => {
		mockSafeFetch.mockResolvedValue({ namespaces: [] });
		const adapter = new LangGraphAdapter(lgDescriptor());
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		const request = call(0);
		expect(request.url).toBe(`${BASE}/store/namespaces`);
		expect(request.method).toBe("POST");
		expect(request.body).toEqual({ limit: 1 });
		expect(request.headers["x-api-key"]).toBe("secret-key");
		expect(request.headers.Authorization).toBeUndefined();
	});

	it("sends no auth header when the connector has no API key", async () => {
		(resolveSourceSecret as jest.Mock).mockResolvedValueOnce({ raw: "", credentials: {} });
		mockSafeFetch.mockResolvedValue({ namespaces: [] });
		const adapter = new LangGraphAdapter({ ...lgDescriptor(), secretRef: null });
		await adapter.healthCheck();
		expect(call(0).headers["x-api-key"]).toBeUndefined();
	});

	it("reports auth failures, missing store routes, and other errors from the health check", async () => {
		const adapter = new LangGraphAdapter(lgDescriptor());
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(401, "Data source responded 401"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringMatching(/rejected the credentials/) })
		);
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(403, "Data source responded 403"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringMatching(/rejected the credentials/) })
		);
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "Data source responded 404"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringMatching(/Store API was not found/) })
		);
		mockSafeFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: "connect ECONNREFUSED" })
		);
	});

	it("requires a server URL and a valid namespace template", async () => {
		const noUrl = new LangGraphAdapter(lgDescriptor({ url: "" }));
		await expect(noUrl.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: false, message: expect.stringMatching(/server URL is required/) })
		);
		await expect(noUrl.list({})).rejects.toThrow(/server URL is required/);
		for (const namespaceTemplate of ["memories/{org_id}", "a.b/{user_id}", "{user_id}/{user_id}", "x{user_id}"]) {
			const adapter = new LangGraphAdapter(lgDescriptor({ namespaceTemplate }));
			await expect(adapter.healthCheck()).resolves.toEqual(
				expect.objectContaining({ ok: false, message: expect.stringMatching(/template is invalid/) })
			);
		}
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("gets an item with a dot-joined namespace and URI-encoded key", async () => {
		mockSafeFetch.mockResolvedValue(item(["memories", "u:1"], "k:1", { content: "likes tea" }));
		const adapter = new LangGraphAdapter(lgDescriptor());
		const record = await adapter.get("memories.u:1:k%3A1");
		const request = call(0);
		expect(request.method).toBe("GET");
		expect(request.url).toBe(`${BASE}/store/items?namespace=memories.u%3A1&key=k%3A1`);
		expect(record).toMatchObject({
			id: "memories.u:1:k%3A1",
			content: "likes tea",
			sessionId: "memories.u:1",
			createdAt: "2026-09-01T00:00:00Z",
			updatedAt: "2026-09-02T00:00:00Z",
		});
	});

	it("returns null for a missing item (200 null) and for malformed ids", async () => {
		mockSafeFetch.mockResolvedValue(null);
		const adapter = new LangGraphAdapter(lgDescriptor());
		await expect(adapter.get("memories.u1:missing")).resolves.toBeNull();
		mockSafeFetch.mockClear();
		for (const id of ["no-separator", ":key", "a..b:key", "memories.u1:", "memories.u1:%E0%A4%A"]) {
			await expect(adapter.get(id)).resolves.toBeNull();
		}
		expect(mockSafeFetch).not.toHaveBeenCalled();
		await expect(adapter.update("bad", { content: "x" })).rejects.toThrow(/could not be found/);
		await expect(adapter.delete("bad")).rejects.toThrow(/could not be found/);
	});

	it("adds a plain-text memory as {content} and handles the 204 response", async () => {
		mockSafeFetch.mockResolvedValue(undefined);
		const adapter = new LangGraphAdapter(lgDescriptor());
		const [record] = await adapter.add({ content: "  likes tea  ", sessionId: "memories.u1", userId: "ignored" });
		const request = call(0);
		expect(request.method).toBe("PUT");
		expect(request.url).toBe(`${BASE}/store/items`);
		expect(request.body.namespace).toEqual(["memories", "u1"]);
		expect(typeof request.body.key).toBe("string");
		expect(request.body.value).toEqual({ content: "likes tea" });
		expect(request.body).not.toHaveProperty("index");
		expect(record).toMatchObject({
			id: `memories.u1:${encodeURIComponent(request.body.key)}`,
			content: "likes tea",
			sessionId: "memories.u1",
		});
		expect(record.userId).toBeUndefined();
	});

	it("writes caller metadata but never OpenLIT's langgraph projection", async () => {
		mockSafeFetch.mockResolvedValue(undefined);
		const adapter = new LangGraphAdapter(lgDescriptor());
		await adapter.add({
			messages: [{ role: "user", content: "one" }, { role: "assistant", content: "two" }],
			sessionId: "memories.u1",
			metadata: { openlit: { port: { sourceMemoryId: "m1" } }, langgraph: { value: {} } },
		});
		expect(call(0).body.value).toEqual({
			content: "one\ntwo",
			metadata: { openlit: { port: { sourceMemoryId: "m1" } } },
		});
	});

	it("rejects writes without content, namespace, or with invalid labels", async () => {
		const adapter = new LangGraphAdapter(lgDescriptor({ namespaceTemplate: "memories" }));
		await expect(adapter.add({ sessionId: "memories.u1" })).rejects.toThrow(/content or messages/);
		await expect(adapter.add({ content: "x" })).rejects.toThrow(/session id is required/);
		await expect(adapter.add({ content: "x", sessionId: "memories..u1" })).rejects.toThrow(/namespace labels/);
		await expect(adapter.add({ content: "x", sessionId: "other.u1" })).rejects.toThrow(/namespace labels/);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("deletes an item with a JSON body", async () => {
		mockSafeFetch.mockResolvedValue(undefined);
		const adapter = new LangGraphAdapter(lgDescriptor());
		await expect(adapter.delete("memories.u1:k1")).resolves.toBeUndefined();
		const request = call(0);
		expect(request.method).toBe("DELETE");
		expect(request.url).toBe(`${BASE}/store/items`);
		expect(request.body).toEqual({ namespace: ["memories", "u1"], key: "k1" });
	});

	it("lists all namespaces and normalizes LangMem and arbitrary values", async () => {
		const nested = { kind: "Memory", content: { content: "prefers dark mode", other: true } };
		const arbitrary = { foo: 123 };
		mockSafeFetch.mockResolvedValue({
			items: [
				item(["memories", "u1"], "a", { content: "likes tea", metadata: { source: "chat" } }, { score: null }),
				item(["memories", "u1"], "b", nested),
				item(["profiles"], "c", arbitrary),
			],
		});
		const adapter = new LangGraphAdapter(lgDescriptor());
		const records = await adapter.list({});
		expect(call(0).body).toEqual({ namespace_prefix: [], limit: 25, offset: 0 });
		expect(records.map((record) => record.content)).toEqual([
			"likes tea",
			"prefers dark mode",
			JSON.stringify(arbitrary),
		]);
		expect(records[0].score).toBeUndefined();
		expect(records[0].metadata).toEqual({
			source: "chat",
			langgraph: {
				namespace: ["memories", "u1"],
				key: "a",
				value: { content: "likes tea", metadata: { source: "chat" } },
			},
		});
		expect(records[1].metadata?.langgraph).toEqual({ namespace: ["memories", "u1"], key: "b", value: nested });
		expect(records.map((record) => record.sessionId)).toEqual(["memories.u1", "memories.u1", "profiles"]);
		expect(records.every((record) => !record.userId && !record.agentId)).toBe(true);
	});

	it("uses the session filter as an exact namespace without a template", async () => {
		mockSafeFetch.mockResolvedValue({
			items: [
				item(["memories", "u1"], "a", { content: "kept" }),
				item(["memories", "u1", "profile"], "b", { content: "child namespace" }),
			],
		});
		const adapter = new LangGraphAdapter(lgDescriptor());
		const records = await adapter.list({ sessionId: "memories.u1", limit: 5 });
		expect(call(0).body).toEqual({ namespace_prefix: ["memories", "u1"], limit: 5, offset: 0 });
		expect(records.map((record) => record.content)).toEqual(["kept"]);
	});

	it("matches nothing for user or agent filters when no template declares them", async () => {
		const adapter = new LangGraphAdapter(lgDescriptor());
		await expect(adapter.list({ userId: "u1" })).resolves.toEqual([]);
		await expect(adapter.search({ query: "tea", agentId: "a1" })).resolves.toEqual([]);
		const templated = new LangGraphAdapter(lgDescriptor({ namespaceTemplate: "memories/{user_id}" }));
		await expect(templated.list({ sessionId: "t1" })).resolves.toEqual([]);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("passes search queries through and keeps numeric scores", async () => {
		mockSafeFetch.mockResolvedValue({
			items: [item(["memories", "u1"], "a", { content: "likes tea" }, { score: 0.82 })],
		});
		const adapter = new LangGraphAdapter(lgDescriptor());
		const records = await adapter.search({ query: "  tea  ", limit: 3 });
		expect(call(0).url).toBe(`${BASE}/store/items/search`);
		expect(call(0).body).toEqual({ namespace_prefix: [], limit: 3, offset: 0, query: "tea" });
		expect(records[0].score).toBe(0.82);
		await expect(adapter.search({ query: "  " })).rejects.toThrow(/search query is required/);
	});

	it("maps {user_id} from a template and drops items outside it", async () => {
		mockSafeFetch.mockResolvedValue({
			items: [
				item(["memories", "u1"], "a", { content: "fits" }),
				item(["memories", "u1", "profile"], "b", { content: "deeper namespace still fits" }),
			],
		});
		const adapter = new LangGraphAdapter(lgDescriptor({ namespaceTemplate: "/memories/{user_id}/" }));
		const records = await adapter.list({ userId: "u1" });
		expect(call(0).body.namespace_prefix).toEqual(["memories", "u1"]);
		expect(records.map((record) => [record.content, record.userId, record.sessionId])).toEqual([
			["fits", "u1", undefined],
			["deeper namespace still fits", "u1", undefined],
		]);

		mockSafeFetch.mockClear();
		mockSafeFetch.mockResolvedValue({
			items: [item(["memories"], "c", { content: "too shallow" }), item(["other", "u2"], "d", { content: "x" })],
		});
		await expect(adapter.list({})).resolves.toEqual([]);
		expect(call(0).body.namespace_prefix).toEqual(["memories"]);
	});

	it("maps {thread_id} and {assistant_id} from a template", async () => {
		mockSafeFetch.mockResolvedValue({
			items: [item(["memories", "u1", "t1", "a1"], "k", { content: "fact" })],
		});
		const adapter = new LangGraphAdapter(
			lgDescriptor({ namespaceTemplate: "memories/{user_id}/{thread_id}/{assistant_id}" })
		);
		const [record] = await adapter.list({ userId: "u1", sessionId: "t1", agentId: "a1" });
		expect(call(0).body.namespace_prefix).toEqual(["memories", "u1", "t1", "a1"]);
		expect(record).toMatchObject({ userId: "u1", sessionId: "t1", agentId: "a1", id: "memories.u1.t1.a1:k" });
	});

	it("writes into the template namespace and names missing placeholders", async () => {
		mockSafeFetch.mockResolvedValue(undefined);
		const adapter = new LangGraphAdapter(
			lgDescriptor({ namespaceTemplate: "memories/{user_id}/{thread_id}" })
		);
		const [record] = await adapter.add({ content: "x", userId: "u1", sessionId: "t1" });
		expect(call(0).body.namespace).toEqual(["memories", "u1", "t1"]);
		expect(record).toMatchObject({ userId: "u1", sessionId: "t1" });
		await expect(adapter.add({ content: "x", userId: "u1" })).rejects.toThrow(
			"This connector's namespace template needs thread_id to write a memory."
		);
		await expect(adapter.add({ content: "x" })).rejects.toThrow(/needs user_id, thread_id/);
		await expect(adapter.add({ content: "x", userId: "u.1", sessionId: "t1" })).rejects.toThrow(/namespace labels/);
	});

	it("resolves candidate namespaces when an earlier placeholder is missing", async () => {
		mockSafeFetch
			.mockResolvedValueOnce({
				namespaces: [
					["memories", "u1", "t1"],
					["memories", "u2", "t1"],
					["memories", "u3", "t9"],
					["memories", "u4"],
				],
			})
			.mockResolvedValueOnce({
				items: [item(["memories", "u1", "t1"], "a", { content: "older" }, { updated_at: "2026-09-01T00:00:00Z" })],
			})
			.mockResolvedValueOnce({
				items: [item(["memories", "u2", "t1"], "b", { content: "newer" }, { updated_at: "2026-09-03T00:00:00Z" })],
			});
		const adapter = new LangGraphAdapter(
			lgDescriptor({ namespaceTemplate: "memories/{user_id}/{thread_id}" })
		);
		const records = await adapter.list({ sessionId: "t1" });
		expect(call(0).url).toBe(`${BASE}/store/namespaces`);
		expect(call(0).body).toEqual({ prefix: ["memories"], max_depth: 3, limit: 100, offset: 0 });
		expect(call(1).body.namespace_prefix).toEqual(["memories", "u1", "t1"]);
		expect(call(2).body.namespace_prefix).toEqual(["memories", "u2", "t1"]);
		expect(mockSafeFetch).toHaveBeenCalledTimes(3);
		expect(records.map((record) => [record.content, record.userId])).toEqual([
			["newer", "u2"],
			["older", "u1"],
		]);
	});

	it("bounds namespace discovery pages and candidate searches", async () => {
		const page = Array.from({ length: 100 }, (_, index) => ["memories", `u${index}`, "t1"]);
		mockSafeFetch.mockImplementation((url: string) =>
			Promise.resolve(String(url).endsWith("/store/namespaces") ? { namespaces: page } : { items: [] })
		);
		const adapter = new LangGraphAdapter(
			lgDescriptor({ namespaceTemplate: "memories/{user_id}/{thread_id}" })
		);
		await adapter.list({ sessionId: "t1" });
		const urls = mockSafeFetch.mock.calls.map(([url]) => String(url));
		expect(urls.filter((url) => url.endsWith("/store/namespaces"))).toHaveLength(5);
		expect(urls.filter((url) => url.endsWith("/store/items/search"))).toHaveLength(10);
	});

	it("discovers namespaces as session filters without a template", async () => {
		mockSafeFetch.mockResolvedValue([["memories", "u2"], ["memories", "u1"], ["bad.label"]]);
		const adapter = new LangGraphAdapter(lgDescriptor());
		const filters = await adapter.listFilters();
		expect(call(0).body).toEqual({ limit: 100, offset: 0 });
		expect(filters).toEqual({
			users: [],
			sessions: [
				{ id: "memories.u1", label: "memories.u1" },
				{ id: "memories.u2", label: "memories.u2" },
			],
			agents: [],
		});
	});

	it("discovers template users, threads, and assistants", async () => {
		mockSafeFetch.mockResolvedValue({
			namespaces: [
				["memories", "u1", "t1", "a1"],
				["memories", "u1", "t2", "a1"],
				["other", "x", "y", "z"],
			],
		});
		const adapter = new LangGraphAdapter(
			lgDescriptor({ namespaceTemplate: "memories/{user_id}/{thread_id}/{assistant_id}" })
		);
		const filters = await adapter.listFilters();
		expect(call(0).body).toEqual({ prefix: ["memories"], max_depth: 4, limit: 100, offset: 0 });
		expect(filters.users).toEqual([{ id: "u1", label: "u1" }]);
		expect(filters.sessions).toEqual([
			{ id: "t1", label: "t1", userId: "u1" },
			{ id: "t2", label: "t2", userId: "u1" },
		]);
		expect(filters.agents).toEqual([{ id: "a1", label: "a1" }]);
	});

	it("returns empty filters when namespace discovery fails", async () => {
		mockSafeFetch.mockRejectedValue(new Error("down"));
		const adapter = new LangGraphAdapter(lgDescriptor());
		await expect(adapter.listFilters()).resolves.toEqual({ users: [], sessions: [], agents: [] });
	});

	describe("update", () => {
		async function runUpdate(existing: unknown, input: { content: string; metadata?: Record<string, unknown> }) {
			mockSafeFetch
				.mockResolvedValueOnce(item(["memories", "u1"], "k1", existing))
				.mockResolvedValueOnce(undefined);
			const adapter = new LangGraphAdapter(lgDescriptor());
			const record = await adapter.update("memories.u1:k1", input);
			expect(call(0).method).toBe("GET");
			const put = call(1);
			expect(put.method).toBe("PUT");
			expect(put.body.namespace).toEqual(["memories", "u1"]);
			expect(put.body.key).toBe("k1");
			return { value: put.body.value, record };
		}

		it("replaces top-level content and keeps unrelated fields", async () => {
			const { value, record } = await runUpdate({ content: "old", foo: 123 }, { content: "new" });
			expect(value).toEqual({ content: "new", foo: 123 });
			expect(record).toMatchObject({ id: "memories.u1:k1", content: "new" });
		});

		it("replaces nested LangMem content and keeps kind and sibling fields", async () => {
			const { value } = await runUpdate(
				{ kind: "Memory", content: { content: "old", other: true } },
				{ content: "new" }
			);
			expect(value).toEqual({ kind: "Memory", content: { content: "new", other: true } });
		});

		it("adds top-level content to a JSON-fallback value without deleting data", async () => {
			const { value, record } = await runUpdate({ foo: 123 }, { content: "new" });
			expect(value).toEqual({ foo: 123, content: "new" });
			expect(record.content).toBe("new");
		});

		it("merges metadata into an existing metadata object", async () => {
			const { value } = await runUpdate(
				{ content: "old", metadata: { a: 1 } },
				{ content: "new", metadata: { b: 2, langgraph: { value: {} } } }
			);
			expect(value).toEqual({ content: "new", metadata: { a: 1, b: 2 } });
		});

		it("refuses updates that would overwrite a non-text content or metadata field", async () => {
			const adapter = new LangGraphAdapter(lgDescriptor());
			mockSafeFetch.mockResolvedValueOnce(item(["memories", "u1"], "k1", { content: { text: "old" } }));
			await expect(adapter.update("memories.u1:k1", { content: "new" })).rejects.toThrow(/cannot edit/);
			mockSafeFetch.mockResolvedValueOnce(item(["memories", "u1"], "k1", { content: "old", metadata: "note" }));
			await expect(
				adapter.update("memories.u1:k1", { content: "new", metadata: { a: 1 } })
			).rejects.toThrow(/cannot edit/);
			expect(mockSafeFetch).toHaveBeenCalledTimes(2);
			expect(mockSafeFetch.mock.calls.every(([, options]) => options.method === undefined || options.method === "GET")).toBe(true);
		});

		it("reports a missing item without writing", async () => {
			mockSafeFetch.mockResolvedValueOnce(null);
			const adapter = new LangGraphAdapter(lgDescriptor());
			await expect(adapter.update("memories.u1:k1", { content: "new" })).rejects.toThrow(/could not be found/);
			expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		});
	});

	it("keeps arbitrary object values in metadata and uses the JSON fallback for content", async () => {
		const value = { profile: { tags: ["a", "b"] }, count: 2, active: true };
		mockSafeFetch.mockResolvedValue(item(["profiles", "u1"], "k1", value));
		const adapter = new LangGraphAdapter(lgDescriptor());
		const record = await adapter.get("profiles.u1:k1");
		expect(record?.content).toBe(JSON.stringify(value));
		expect(record?.metadata).toEqual({
			langgraph: { namespace: ["profiles", "u1"], key: "k1", value },
		});
	});

	it("keeps array and primitive Store values instead of coercing them to an empty object", async () => {
		const values = [["tea", "coffee"], "likes tea", 3, false, null];
		mockSafeFetch.mockResolvedValue({
			items: values.map((value, index) => item(["memories", "u1"], `k${index}`, value)),
		});
		const adapter = new LangGraphAdapter(lgDescriptor());
		const records = await adapter.list({});
		expect(records.map((record) => record.content)).toEqual(values.map((value) => JSON.stringify(value)));
		expect(
			records.map((record) => (record.metadata?.langgraph as { value: unknown }).value)
		).toEqual(values);

		mockSafeFetch.mockClear();
		mockSafeFetch.mockResolvedValue(item(["profiles", "u1"], "k1", "raw note"));
		const record = await adapter.get("profiles.u1:k1");
		expect(record?.content).toBe(JSON.stringify("raw note"));
		expect(record?.metadata).toEqual({
			langgraph: { namespace: ["profiles", "u1"], key: "k1", value: "raw note" },
		});
	});

	it("refuses to update a non-object Store value", async () => {
		const adapter = new LangGraphAdapter(lgDescriptor());
		mockSafeFetch.mockResolvedValueOnce(item(["memories", "u1"], "k1", ["tea"]));
		await expect(adapter.update("memories.u1:k1", { content: "new" })).rejects.toThrow(/cannot edit/);
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		expect(call(0).method).toBe("GET");
	});

	describe("namespace scope for direct ids", () => {
		it("does not get items outside a fixed namespace prefix", async () => {
			const adapter = new LangGraphAdapter(lgDescriptor({ namespaceTemplate: "memories" }));
			await expect(adapter.get("other.u1:k1")).resolves.toBeNull();
			await expect(adapter.get("memoriesx.u1:k1")).resolves.toBeNull();
			expect(mockSafeFetch).not.toHaveBeenCalled();

			mockSafeFetch.mockResolvedValue(item(["memories", "u1"], "k1", { content: "in scope" }));
			await expect(adapter.get("memories.u1:k1")).resolves.toMatchObject({ content: "in scope" });
			expect(call(0).url).toBe(`${BASE}/store/items?namespace=memories.u1&key=k1`);
		});

		it("does not get items outside a placeholder template", async () => {
			const adapter = new LangGraphAdapter(
				lgDescriptor({ namespaceTemplate: "memories/{user_id}/{thread_id}" })
			);
			for (const id of ["other.u1.t1:k1", "memories.u1:k1", "memories:k1"]) {
				await expect(adapter.get(id)).resolves.toBeNull();
			}
			expect(mockSafeFetch).not.toHaveBeenCalled();

			mockSafeFetch.mockResolvedValue(item(["memories", "u1", "t1"], "k1", { content: "in scope" }));
			await expect(adapter.get("memories.u1.t1:k1")).resolves.toMatchObject({
				content: "in scope",
				userId: "u1",
				sessionId: "t1",
			});
		});

		it("does not update or delete out-of-scope items and sends no request", async () => {
			for (const namespaceTemplate of ["memories", "memories/{user_id}"]) {
				const adapter = new LangGraphAdapter(lgDescriptor({ namespaceTemplate }));
				await expect(adapter.update("other.u1:k1", { content: "new" })).rejects.toThrow(
					/could not be found/
				);
				await expect(adapter.delete("other.u1:k1")).rejects.toThrow(/could not be found/);
			}
			expect(mockSafeFetch).not.toHaveBeenCalled();
		});

		it("still updates and deletes in-scope items", async () => {
			const adapter = new LangGraphAdapter(lgDescriptor({ namespaceTemplate: "memories/{user_id}" }));
			mockSafeFetch
				.mockResolvedValueOnce(item(["memories", "u1"], "k1", { content: "old", foo: 1 }))
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce(undefined);
			await expect(adapter.update("memories.u1:k1", { content: "new" })).resolves.toMatchObject({
				content: "new",
				userId: "u1",
			});
			expect(call(1).body).toEqual({
				namespace: ["memories", "u1"],
				key: "k1",
				value: { content: "new", foo: 1 },
			});
			await expect(adapter.delete("memories.u1:k1")).resolves.toBeUndefined();
			expect(call(2)).toMatchObject({
				method: "DELETE",
				body: { namespace: ["memories", "u1"], key: "k1" },
			});
		});

		it("allows any valid namespace when no template is configured", async () => {
			mockSafeFetch.mockResolvedValue(undefined);
			const adapter = new LangGraphAdapter(lgDescriptor());
			await expect(adapter.delete("anything.at.all:k1")).resolves.toBeUndefined();
			expect(call(0).body).toEqual({ namespace: ["anything", "at", "all"], key: "k1" });
		});
	});

	it("does not support feedback", async () => {
		const adapter = new LangGraphAdapter(lgDescriptor());
		expect(adapter.capabilities().feedback).toBe(false);
		await expect(adapter.feedback("memories.u1:k1", { rating: "positive" })).rejects.toBeInstanceOf(
			UnsupportedMemoryCapabilityError
		);
	});
});

describe("Cognee adapter", () => {
	const BASE = "https://cognee.example.com";
	const DS = "11111111-1111-4111-8111-111111111111";
	const DOC = "22222222-2222-4222-8222-222222222222";
	const REF = `${DS}:${DOC}`;

	function cgDescriptor(settings: Record<string, unknown> = {}): MemorySourceDescriptor {
		return {
			type: "cognee",
			id: "memory:cognee",
			settings: { url: BASE, ...settings },
			secretRef: "vault-1",
			name: "cognee",
			projectId: "proj-1",
		};
	}

	function call(index: number) {
		const [url, options] = mockSafeFetch.mock.calls[index];
		return {
			url: String(url),
			method: options.method,
			headers: options.headers,
			body: options.body as string | undefined,
		};
	}

	function dataRow(extra: Record<string, unknown> = {}) {
		return {
			id: DOC,
			name: "text_abc",
			createdAt: "2026-09-01T00:00:00Z",
			updatedAt: "2026-09-02T00:00:00Z",
			extension: "txt",
			mimeType: "text/plain",
			rawDataLocation: "file:///data/text_abc.txt",
			datasetId: DS,
			dataSize: 12,
			contentHash: "0".repeat(32),
			...extra,
		};
	}

	it("describes a self-hosted friendly config schema and a graph-capable profile", () => {
		const described = cogneeAdapterFactory.describe();
		expect(described.type).toBe("cognee");
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
		expect(described.configFields.find((field) => field.key === "apiKey")?.group).toBe(
			"credentials"
		);
		expect(described.filterFields).toEqual([
			expect.objectContaining({ key: "sessionId", label: "Dataset", required: true }),
		]);
		expect(described.authStyle).toBe("api-key");
		expect(new CogneeAdapter(cgDescriptor()).graph).toBeInstanceOf(Function);
	});

	it("health-checks an authenticated route and sends X-Api-Key", async () => {
		mockSafeFetch.mockResolvedValue([]);
		const adapter = new CogneeAdapter(cgDescriptor());
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		const request = call(0);
		expect(request.url).toBe(`${BASE}/api/v1/datasets`);
		expect(request.headers["X-Api-Key"]).toBe("secret-key");
		expect(request.headers.Authorization).toBeUndefined();
	});

	it("sends no auth header when the connector has no key", async () => {
		(resolveSourceSecret as jest.Mock).mockResolvedValueOnce({ raw: "", credentials: {} });
		mockSafeFetch.mockResolvedValue([]);
		await new CogneeAdapter(cgDescriptor()).healthCheck();
		expect(call(0).headers["X-Api-Key"]).toBeUndefined();
	});

	it("explains auth failures, a missing API, and other errors in the health check", async () => {
		const adapter = new CogneeAdapter(cgDescriptor());
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(401, "nope"));
		await expect(adapter.healthCheck()).resolves.toMatchObject({
			ok: false,
			message: expect.stringContaining("rejected the credentials"),
		});
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(403, "nope"));
		await expect(adapter.healthCheck()).resolves.toMatchObject({
			message: expect.stringContaining("rejected the credentials"),
		});
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "nope"));
		await expect(adapter.healthCheck()).resolves.toMatchObject({
			message: expect.stringContaining("API was not found"),
		});
		mockSafeFetch.mockRejectedValueOnce(new Error("socket hang up"));
		await expect(adapter.healthCheck()).resolves.toMatchObject({
			ok: false,
			message: "socket hang up",
		});
	});

	it("requires a server URL", async () => {
		const adapter = new CogneeAdapter(cgDescriptor({ url: "" }));
		await expect(adapter.healthCheck()).resolves.toMatchObject({
			ok: false,
			message: expect.stringContaining("server URL is required"),
		});
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("lists datasets as session filters and returns none when the call fails", async () => {
		mockSafeFetch.mockResolvedValueOnce([
			{ id: DS, name: "main_dataset", ownerId: "u" },
			{ name: "no id is skipped" },
		]);
		const adapter = new CogneeAdapter(cgDescriptor());
		const filters = await adapter.listFilters();
		expect(filters.sessions).toEqual([{ id: DS, label: "main_dataset" }]);
		expect(filters.users).toEqual([]);
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(500, "boom"));
		await expect(adapter.listFilters()).resolves.toMatchObject({ sessions: [] });
	});

	describe("add", () => {
		it("stores text as a form post, then starts building the graph", async () => {
			mockSafeFetch
				.mockResolvedValueOnce({ status: "PipelineRunCompleted", dataset_id: DS, data_ids: [DOC] })
				.mockResolvedValueOnce({});
			const adapter = new CogneeAdapter(cgDescriptor());
			const records = await adapter.add({
				content: "Ada likes tea & scones",
				sessionId: "main_dataset",
				metadata: { source: "chat", node_set: "reserved" },
			});
			expect(records).toEqual([
				expect.objectContaining({
					id: REF,
					content: "Ada likes tea & scones",
					sessionId: DS,
					metadata: { source: "chat", cognee: { graph: "building" } },
				}),
			]);
			const add = call(0);
			expect(add.url).toBe(`${BASE}/api/v1/add`);
			expect(add.method).toBe("POST");
			expect(add.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
			const form = new URLSearchParams(add.body);
			expect(form.get("raw_data")).toBe("Ada likes tea & scones");
			expect(form.get("datasetName")).toBe("main_dataset");
			expect(form.get("datasetId")).toBeNull();
			expect(JSON.parse(form.get("external_metadata") as string)).toEqual([{ source: "chat" }]);
			const cognify = call(1);
			expect(cognify.url).toBe(`${BASE}/api/v1/cognify`);
			expect(JSON.parse(cognify.body as string)).toEqual({
				dataset_ids: [DS],
				run_in_background: true,
			});
		});

		it("targets an existing dataset by id and joins messages into the text", async () => {
			mockSafeFetch
				.mockResolvedValueOnce({ dataset_id: DS, data_ids: [DOC] })
				.mockResolvedValueOnce({});
			const adapter = new CogneeAdapter(cgDescriptor());
			await adapter.add({
				messages: [
					{ role: "user", content: "hi" },
					{ role: "assistant", content: "hello" },
				],
				sessionId: DS.toUpperCase(),
			});
			const form = new URLSearchParams(call(0).body);
			expect(form.get("raw_data")).toBe("hi\nhello");
			expect(form.get("datasetId")).toBe(DS.toUpperCase());
			expect(form.get("datasetName")).toBeNull();
			expect(form.get("external_metadata")).toBeNull();
		});

		it("finds the stored document by content hash when the run reports no ids", async () => {
			mockSafeFetch
				.mockResolvedValueOnce({ datasetId: DS })
				.mockResolvedValueOnce([{ id: DOC }])
				.mockResolvedValueOnce({});
			const records = await new CogneeAdapter(cgDescriptor()).add({
				content: "abc",
				sessionId: DS,
			});
			expect(records[0].id).toBe(REF);
			const lookup = call(1);
			expect(lookup.url).toContain(`/api/v1/datasets/${DS}/data?`);
			// md5("abc")
			expect(lookup.url).toContain("content_hash=900150983cd24fb0d6963f7d28e17f72");
		});

		it("keeps the stored document when building the graph fails", async () => {
			mockSafeFetch
				.mockResolvedValueOnce({ dataset_id: DS, data_ids: [DOC] })
				.mockRejectedValueOnce(new SourceResponseError(409, "LLM not configured"));
			const records = await new CogneeAdapter(cgDescriptor()).add({
				content: "x",
				sessionId: DS,
			});
			expect(records).toHaveLength(1);
			expect(records[0].metadata?.cognee).toEqual({
				graph: "failed",
				error: expect.stringContaining("LLM not configured"),
			});
		});

		it("rejects writes without content or a dataset, and unreadable responses", async () => {
			const adapter = new CogneeAdapter(cgDescriptor());
			await expect(adapter.add({ content: "  ", sessionId: DS })).rejects.toThrow(
				"Memory content or messages are required."
			);
			await expect(adapter.add({ content: "x" })).rejects.toThrow(
				"A session id is required for this memory connector."
			);
			expect(mockSafeFetch).not.toHaveBeenCalled();
			mockSafeFetch.mockResolvedValueOnce("<html>proxy error</html>");
			await expect(adapter.add({ content: "x", sessionId: DS })).rejects.toThrow(
				"could not read"
			);
			mockSafeFetch.mockResolvedValueOnce({ status: "ok" });
			await expect(adapter.add({ content: "x", sessionId: DS })).rejects.toThrow(
				"could not read"
			);
			mockSafeFetch.mockResolvedValueOnce({ dataset_id: DS }).mockResolvedValueOnce([]);
			await expect(adapter.add({ content: "x", sessionId: DS })).rejects.toThrow(
				"could not read"
			);
		});

		it("surfaces HTTP errors from the add call", async () => {
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(403, "no write access"));
			await expect(
				new CogneeAdapter(cgDescriptor()).add({ content: "x", sessionId: DS })
			).rejects.toMatchObject({ status: 403 });
		});
	});

	describe("search", () => {
		it("runs a CHUNKS search and merges chunks of one document", async () => {
			mockSafeFetch.mockResolvedValueOnce([
				{
					dataset_id: DS,
					search_result: [
						{ id: "c1", text: "Ada likes tea.", document_id: DOC, document_name: "text_abc" },
						{ id: "c2", text: "Ada owns a cat.", document_id: DOC },
						{ id: "c3", text: "Grace uses COBOL.", document_id: "other" },
						{ id: "c4", text: "" },
					],
				},
			]);
			const records = await new CogneeAdapter(cgDescriptor()).search({
				query: " who likes tea ",
				sessionId: DS,
				limit: 5,
			});
			expect(records).toEqual([
				expect.objectContaining({
					id: REF,
					content: "Ada likes tea.\n\nAda owns a cat.",
					metadata: { document_name: "text_abc", chunk_id: "c1" },
				}),
				expect.objectContaining({ id: `${DS}:other`, content: "Grace uses COBOL." }),
			]);
			const request = call(0);
			expect(request.url).toBe(`${BASE}/api/v1/search`);
			expect(JSON.parse(request.body as string)).toEqual({
				search_type: "CHUNKS",
				query: "who likes tea",
				dataset_ids: [DS],
				top_k: 5,
			});
		});

		it("reads the bare result list returned when access control is off", async () => {
			mockSafeFetch.mockResolvedValueOnce([{ id: "c1", text: "plain", document_id: DOC }]);
			const records = await new CogneeAdapter(cgDescriptor()).search({
				query: "q",
				sessionId: DS,
			});
			expect(records).toEqual([expect.objectContaining({ id: REF, content: "plain" })]);
		});

		it("resolves a dataset name to its id, and fails clearly when it is unknown", async () => {
			mockSafeFetch
				.mockResolvedValueOnce([{ id: DS, name: "main_dataset" }])
				.mockResolvedValueOnce([]);
			const adapter = new CogneeAdapter(cgDescriptor());
			await adapter.search({ query: "q", sessionId: "main_dataset" });
			expect(call(0).url).toBe(`${BASE}/api/v1/datasets`);
			expect(JSON.parse(call(1).body as string).dataset_ids).toEqual([DS]);

			mockSafeFetch.mockResolvedValueOnce([{ id: DS, name: "other" }]);
			await expect(adapter.search({ query: "q", sessionId: "missing" })).rejects.toThrow(
				"No Cognee dataset"
			);
		});

		it("rejects an empty query, a missing dataset, and a non-list response", async () => {
			const adapter = new CogneeAdapter(cgDescriptor());
			await expect(adapter.search({ query: " ", sessionId: DS })).rejects.toThrow(
				"search query is required"
			);
			await expect(adapter.search({ query: "q" })).rejects.toThrow(
				"A session id is required"
			);
			mockSafeFetch.mockResolvedValueOnce({ detail: "weird" });
			await expect(adapter.search({ query: "q", sessionId: DS })).rejects.toThrow(
				"could not read"
			);
		});

		it("surfaces HTTP errors from search", async () => {
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(409, "no data added"));
			await expect(
				new CogneeAdapter(cgDescriptor()).search({ query: "q", sessionId: DS })
			).rejects.toMatchObject({ status: 409 });
		});
	});

	describe("list", () => {
		it("pages a dataset's documents with a durable total", async () => {
			mockSafeFetch
				.mockResolvedValueOnce([dataRow({ label: "profile", externalMetadata: { source: "chat" } })])
				.mockResolvedValueOnce({ count: 3 });
			const page = await new CogneeAdapter(cgDescriptor()).listPage({
				sessionId: DS,
				limit: 1,
				offset: 1,
			});
			expect(page).toMatchObject({ total: 3, hasMore: true, nextOffset: 2 });
			expect(page.records).toEqual([
				expect.objectContaining({
					id: REF,
					content: "text_abc",
					sessionId: DS,
					categories: ["profile"],
					createdAt: "2026-09-01T00:00:00Z",
					metadata: expect.objectContaining({
						source: "chat",
						mime_type: "text/plain",
						data_size: 12,
					}),
				}),
			]);
			expect(call(0).url).toBe(`${BASE}/api/v1/datasets/${DS}/data?limit=1&offset=1`);
			expect(call(1).url).toBe(`${BASE}/api/v1/datasets/${DS}/data/count`);
		});

		it("still lists when the count call fails, and reports the last page", async () => {
			mockSafeFetch
				.mockResolvedValueOnce([dataRow()])
				.mockRejectedValueOnce(new SourceResponseError(500, "x"));
			const page = await new CogneeAdapter(cgDescriptor()).listPage({ sessionId: DS });
			expect(page.total).toBeUndefined();
			expect(page.hasMore).toBe(false);
			expect(page.records).toHaveLength(1);
		});

		it("list() returns only the records", async () => {
			mockSafeFetch.mockResolvedValueOnce([dataRow()]).mockResolvedValueOnce({ count: 1 });
			await expect(
				new CogneeAdapter(cgDescriptor()).list({ sessionId: DS })
			).resolves.toHaveLength(1);
		});

		it("requires a dataset and a list response", async () => {
			const adapter = new CogneeAdapter(cgDescriptor());
			await expect(adapter.list({})).rejects.toThrow("A session id is required");
			mockSafeFetch
				.mockResolvedValueOnce({ detail: "nope" })
				.mockResolvedValueOnce({ count: 0 });
			await expect(adapter.list({ sessionId: DS })).rejects.toThrow("could not read");
		});

		it("surfaces a rejected key as an HTTP error", async () => {
			mockSafeFetch.mockRejectedValue(new SourceResponseError(401, "Unauthorized"));
			await expect(
				new CogneeAdapter(cgDescriptor()).list({ sessionId: DS })
			).rejects.toMatchObject({ status: 401 });
		});
	});

	describe("get", () => {
		it("reads the stored text of a text document", async () => {
			mockSafeFetch
				.mockResolvedValueOnce([dataRow()])
				.mockResolvedValueOnce("Ada likes tea.\n");
			const record = await new CogneeAdapter(cgDescriptor()).get(REF);
			expect(record).toMatchObject({ id: REF, content: "Ada likes tea." });
			expect(call(1).url).toBe(`${BASE}/api/v1/datasets/${DS}/data/${DOC}/raw`);
		});

		it("turns JSON-looking text back into text", async () => {
			mockSafeFetch
				.mockResolvedValueOnce([dataRow()])
				.mockResolvedValueOnce({ a: 1 });
			const record = await new CogneeAdapter(cgDescriptor()).get(REF);
			expect(record?.content).toBe('{"a":1}');
		});

		it("keeps the listed record for a binary document", async () => {
			mockSafeFetch.mockResolvedValueOnce([dataRow({ mimeType: "application/pdf" })]);
			const record = await new CogneeAdapter(cgDescriptor()).get(REF);
			expect(record?.content).toBe("text_abc");
			expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		});

		it("returns null for a malformed id, a missing document, or a missing dataset", async () => {
			const adapter = new CogneeAdapter(cgDescriptor());
			await expect(adapter.get("not-a-ref")).resolves.toBeNull();
			await expect(adapter.get(`${DS}:nope`)).resolves.toBeNull();
			await expect(adapter.get(`${DS}:${DOC}:extra`)).resolves.toBeNull();
			expect(mockSafeFetch).not.toHaveBeenCalled();
			mockSafeFetch.mockResolvedValueOnce([dataRow({ id: "33333333-3333-4333-8333-333333333333" })]);
			await expect(adapter.get(REF)).resolves.toBeNull();
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "Dataset not found"));
			await expect(adapter.get(REF)).resolves.toBeNull();
		});

		it("rethrows other HTTP errors", async () => {
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(500, "boom"));
			await expect(new CogneeAdapter(cgDescriptor()).get(REF)).rejects.toMatchObject({
				status: 500,
			});
		});

		it("pages past a full first page to find the document", async () => {
			const filler = Array.from({ length: 1000 }, (_, index) =>
				dataRow({ id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}` })
			);
			mockSafeFetch
				.mockResolvedValueOnce(filler)
				.mockResolvedValueOnce([dataRow({ mimeType: "application/pdf" })]);
			const record = await new CogneeAdapter(cgDescriptor()).get(REF);
			expect(record?.id).toBe(REF);
			expect(call(1).url).toContain("limit=1000&offset=1000");
		});
	});

	describe("update", () => {
		it("replaces the document text with a multipart patch", async () => {
			mockSafeFetch.mockResolvedValueOnce({ status: "incremental", data_id: DOC });
			const record = await new CogneeAdapter(cgDescriptor()).update(REF, {
				content: " Ada likes coffee ",
			});
			expect(record).toEqual({ id: REF, content: "Ada likes coffee", sessionId: DS });
			const request = call(0);
			expect(request.method).toBe("PATCH");
			expect(request.url).toBe(`${BASE}/api/v1/update?data_id=${DOC}&dataset_id=${DS}`);
			expect(request.headers["Content-Type"]).toMatch(/^multipart\/form-data; boundary=openlit-/);
			const boundary = request.headers["Content-Type"].split("boundary=")[1];
			expect(request.body).toBe(
				[
					`--${boundary}`,
					'Content-Disposition: form-data; name="data"; filename="memory.txt"',
					"Content-Type: text/plain; charset=utf-8",
					"",
					"Ada likes coffee",
					`--${boundary}--`,
					"",
				].join("\r\n")
			);
		});

		it("reports a failed rebuild, bad ids, and empty content", async () => {
			const adapter = new CogneeAdapter(cgDescriptor());
			mockSafeFetch.mockResolvedValueOnce({
				status: "failed",
				error: { error_class: "LLMError", message: "LLM key missing" },
			});
			await expect(adapter.update(REF, { content: "x" })).rejects.toThrow("LLM key missing");
			await expect(adapter.update("bad", { content: "x" })).rejects.toThrow(
				"could not be found"
			);
			await expect(adapter.update(REF, { content: "  " })).rejects.toThrow(
				"Memory content or messages are required."
			);
			mockSafeFetch.mockResolvedValueOnce({ status: "failed" });
			await expect(adapter.update(REF, { content: "x" })).rejects.toThrow("could not read");
		});

		it("surfaces HTTP errors from update", async () => {
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(422, "bad id"));
			await expect(
				new CogneeAdapter(cgDescriptor()).update(REF, { content: "x" })
			).rejects.toMatchObject({ status: 422 });
		});
	});

	describe("delete", () => {
		it("deletes a document from its dataset", async () => {
			mockSafeFetch.mockResolvedValueOnce({ status: "success", deletedNodes: 3 });
			await expect(new CogneeAdapter(cgDescriptor()).delete(REF)).resolves.toBeUndefined();
			const request = call(0);
			expect(request.method).toBe("DELETE");
			expect(request.url).toBe(`${BASE}/api/v1/datasets/${DS}/data/${DOC}`);
		});

		it("treats a not_found receipt as an error, and rejects malformed ids", async () => {
			const adapter = new CogneeAdapter(cgDescriptor());
			mockSafeFetch.mockResolvedValueOnce({ status: "not_found" });
			await expect(adapter.delete(REF)).rejects.toThrow("could not be found");
			await expect(adapter.delete("memory-1")).rejects.toThrow("could not be found");
			expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		});

		it("surfaces HTTP errors from delete", async () => {
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(401, "Unauthorized"));
			await expect(new CogneeAdapter(cgDescriptor()).delete(REF)).rejects.toMatchObject({
				status: 401,
			});
		});
	});

	describe("graph", () => {
		const documentNode = { id: DOC, label: "text_abc", type: "TextDocument", properties: {} };
		const chunkNode = { id: "c1", label: "DocumentChunk_c1", type: "DocumentChunk", properties: {} };
		const adaNode = { id: "e1", label: "Ada", type: "Person", properties: {} };
		const teaNode = { id: "e2", label: "tea", type: "Entity", properties: {} };

		it("reads the dataset graph and folds chunks into their documents", async () => {
			mockSafeFetch.mockResolvedValueOnce({
				nodes: [documentNode, chunkNode, adaNode, teaNode, { label: "no id" }],
				edges: [
					{ source: "c1", target: DOC, label: "is_part_of" },
					{ source: "c1", target: "e1", label: "contains" },
					{ source: "e1", target: "e2", label: "likes" },
					{ source: "e1", target: "e1", label: "self" },
					{ source: "e1", target: "ghost", label: "dangling" },
				],
			});
			const graph = await new CogneeAdapter(cgDescriptor()).graph({ sessionId: DS });
			expect(call(0).url).toBe(`${BASE}/api/v1/datasets/${DS}/graph`);
			expect(graph.kind).toBe("knowledge");
			expect(graph.totalMemories).toBe(1);
			expect(graph.truncated).toBe(false);
			expect(graph.nodes.map((node) => node.id).sort()).toEqual([DOC, "e1", "e2"].sort());
			expect(graph.nodes.find((node) => node.id === DOC)).toMatchObject({
				type: "memory",
				memoryId: REF,
				label: "text_abc",
			});
			expect(graph.nodes.find((node) => node.id === "e1")).toMatchObject({
				type: "entity",
				entityType: "entity",
				label: "Ada",
			});
			expect(graph.edges).toEqual(
				expect.arrayContaining([
					{ from: DOC, to: "e1", label: "contains" },
					{ from: "e1", to: "e2", label: "likes" },
				])
			);
			expect(graph.edges).toHaveLength(2);
		});

		it("keeps the best-connected nodes when the graph exceeds the budget", async () => {
			mockSafeFetch.mockResolvedValueOnce({
				nodes: [adaNode, teaNode, { id: "e3", label: "lonely", type: "Entity" }],
				edges: [{ source: "e1", target: "e2", label: "likes" }],
			});
			const graph = await new CogneeAdapter(cgDescriptor()).graph({
				sessionId: DS,
				maxNodes: 2,
			});
			expect(graph.nodes.map((node) => node.id).sort()).toEqual(["e1", "e2"]);
			expect(graph.truncated).toBe(true);
			expect(graph.edges).toHaveLength(1);
		});

		it("requires a dataset and a graph object, and surfaces HTTP errors", async () => {
			const adapter = new CogneeAdapter(cgDescriptor());
			await expect(adapter.graph({})).rejects.toThrow("A session id is required");
			mockSafeFetch.mockResolvedValueOnce("<html></html>");
			await expect(adapter.graph({ sessionId: DS })).rejects.toThrow("could not read");
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "Dataset not found"));
			await expect(adapter.graph({ sessionId: DS })).rejects.toMatchObject({ status: 404 });
		});
	});

	it("does not support feedback", async () => {
		const adapter = new CogneeAdapter(cgDescriptor());
		expect(adapter.capabilities().feedback).toBe(false);
		await expect(adapter.feedback(REF, { rating: "positive" })).rejects.toBeInstanceOf(
			UnsupportedMemoryCapabilityError
		);
	});
});

describe("Supermemory adapter", () => {
	const BASE = "https://api.supermemory.ai";

	function smDescriptor(settings: Record<string, unknown> = {}): MemorySourceDescriptor {
		return {
			type: "supermemory",
			id: "memory:supermemory",
			settings: { url: BASE, ...settings },
			secretRef: "vault-1",
			name: "supermemory",
			projectId: "proj-1",
		};
	}

	function call(index: number) {
		const [url, options] = mockSafeFetch.mock.calls[index];
		return {
			url: String(url),
			method: options.method,
			headers: options.headers,
			body: options.body === undefined ? undefined : JSON.parse(options.body),
		};
	}

	function memoryRow(extra: Record<string, unknown> = {}) {
		return {
			id: "mem_1",
			memory: "Ada prefers tea",
			metadata: { source: "chat" },
			isStatic: false,
			isInference: false,
			isLatest: true,
			isForgotten: false,
			version: 2,
			system: { createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z" },
			...extra,
		};
	}

	it("describes a namespace-scoped config schema with no write or graph profile", () => {
		const described = supermemoryAdapterFactory.describe();
		expect(described.type).toBe("supermemory");
		expect(described.capabilities).toEqual({
			add: true,
			search: true,
			get: true,
			list: true,
			update: false,
			delete: true,
			feedback: false,
		});
		expect(described.configFields.map((field) => field.key)).toEqual(
			expect.arrayContaining(["url", "apiKey"])
		);
		expect(described.configFields.find((field) => field.key === "url")?.defaultValue).toBe(
			BASE
		);
		expect(described.filterFields).toEqual([
			expect.objectContaining({ key: "userId", label: "Namespace", required: true }),
		]);
		expect(described.authStyle).toBe("api-key");
		expect("graph" in new SupermemoryAdapter(smDescriptor())).toBe(false);
	});

	it("health-checks namespaces and sends a bearer token", async () => {
		mockSafeFetch.mockResolvedValue({ namespaces: [] });
		const adapter = new SupermemoryAdapter(smDescriptor());
		await expect(adapter.healthCheck()).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		const request = call(0);
		expect(request.url).toBe(`${BASE}/namespaces?page=1&limit=1`);
		expect(request.headers.Authorization).toBe("Bearer secret-key");
	});

	it("explains auth failures and passes other errors through", async () => {
		const adapter = new SupermemoryAdapter(smDescriptor());
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(401, "Unauthorized"));
		await expect(adapter.healthCheck()).resolves.toMatchObject({
			ok: false,
			message: expect.stringContaining("rejected the API key"),
		});
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(403, "Forbidden"));
		await expect(adapter.healthCheck()).resolves.toMatchObject({
			message: expect.stringContaining("rejected the API key"),
		});
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(500, "boom"));
		await expect(adapter.healthCheck()).resolves.toMatchObject({
			ok: false,
			message: "boom",
		});
	});

	it("omits the auth header when the secret has no usable value", async () => {
		(resolveSourceSecret as jest.Mock).mockResolvedValueOnce({ raw: "", credentials: {} });
		mockSafeFetch.mockResolvedValue({ namespaces: [] });
		await new SupermemoryAdapter(smDescriptor()).healthCheck();
		expect(call(0).headers.Authorization).toBeUndefined();
	});

	it("lists namespaces as user filters and returns none when the call fails", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			namespaces: [{ namespace: "user_b" }, { namespace: "user_a" }, { id: "no name" }],
			pagination: {},
		});
		const adapter = new SupermemoryAdapter(smDescriptor());
		const filters = await adapter.listFilters();
		expect(filters.users).toEqual([
			{ id: "user_a", label: "user_a" },
			{ id: "user_b", label: "user_b" },
		]);
		expect(call(0).url).toBe(`${BASE}/namespaces?page=1&limit=100`);
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(500, "x"));
		await expect(adapter.listFilters()).resolves.toMatchObject({ users: [] });
		mockSafeFetch.mockResolvedValueOnce({ detail: "weird" });
		await expect(adapter.listFilters()).resolves.toMatchObject({ users: [] });
	});

	describe("add", () => {
		it("stores a document in the namespace and returns its id", async () => {
			mockSafeFetch.mockResolvedValueOnce({ id: "doc_1", status: "queued" });
			const records = await new SupermemoryAdapter(smDescriptor()).add({
				content: "Ada prefers tea",
				userId: "user 1/a",
				metadata: { source: "chat", tags: ["a", "b"], nested: { x: 1 }, n: 3, ok: true },
			});
			expect(records).toEqual([
				expect.objectContaining({
					id: "user%201%2Fa:document:doc_1",
					content: "Ada prefers tea",
					userId: "user 1/a",
					metadata: {
						source: "chat",
						tags: ["a", "b"],
						n: 3,
						ok: true,
						supermemory: { kind: "document", status: "queued" },
					},
				}),
			]);
			const request = call(0);
			expect(request.url).toBe(`${BASE}/ns/user%201%2Fa/document`);
			expect(request.method).toBe("POST");
			expect(request.body).toEqual({
				content: "Ada prefers tea",
				metadata: { source: "chat", tags: ["a", "b"], n: 3, ok: true },
			});
		});

		it("joins messages into the content and omits empty metadata", async () => {
			mockSafeFetch.mockResolvedValueOnce({ id: "doc_1", status: "done" });
			await new SupermemoryAdapter(smDescriptor()).add({
				messages: [
					{ role: "user", content: "hi" },
					{ role: "assistant", content: "hello" },
				],
				userId: "u1",
				metadata: { nested: { x: 1 } },
			});
			expect(call(0).body).toEqual({ content: "hi\nhello" });
		});

		it("rejects writes without content or a namespace", async () => {
			const adapter = new SupermemoryAdapter(smDescriptor());
			await expect(adapter.add({ content: " ", userId: "u1" })).rejects.toThrow(
				"Memory content or messages are required."
			);
			await expect(adapter.add({ content: "x" })).rejects.toThrow(
				"A user, agent, or session is required"
			);
			expect(mockSafeFetch).not.toHaveBeenCalled();
		});

		it("rejects a failed document and unreadable responses", async () => {
			const adapter = new SupermemoryAdapter(smDescriptor());
			mockSafeFetch.mockResolvedValueOnce({ id: "doc_1", status: "failed" });
			await expect(adapter.add({ content: "x", userId: "u1" })).rejects.toThrow(
				"marked the document as failed"
			);
			mockSafeFetch.mockResolvedValueOnce({ status: "queued" });
			await expect(adapter.add({ content: "x", userId: "u1" })).rejects.toThrow(
				"could not read"
			);
			mockSafeFetch.mockResolvedValueOnce("<html></html>");
			await expect(adapter.add({ content: "x", userId: "u1" })).rejects.toThrow(
				"could not read"
			);
		});

		it("surfaces HTTP errors from add", async () => {
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(401, "Unauthorized"));
			await expect(
				new SupermemoryAdapter(smDescriptor()).add({ content: "x", userId: "u1" })
			).rejects.toMatchObject({ status: 401 });
		});
	});

	describe("search", () => {
		it("searches memories only and keeps similarity as the score", async () => {
			mockSafeFetch.mockResolvedValueOnce({
				results: [
					{ ...memoryRow(), similarity: 0.82 },
					{ id: "chunk_1", chunk: "A source passage", similarity: 0.5, metadata: {}, system: {} },
					{ id: "empty", similarity: 0.1 },
				],
				searchTime: 12,
			});
			const records = await new SupermemoryAdapter(smDescriptor()).search({
				query: " tea ",
				userId: "user_1",
				limit: 5,
				threshold: 0.6,
			});
			expect(records).toEqual([
				expect.objectContaining({
					id: "user_1:mem_1",
					content: "Ada prefers tea",
					score: 0.82,
					userId: "user_1",
				}),
				expect.objectContaining({
					id: "user_1:chunk_1",
					content: "A source passage",
					metadata: { supermemory: { source: "chunk" } },
				}),
			]);
			const request = call(0);
			expect(request.url).toBe(`${BASE}/ns/user_1/search`);
			expect(request.body).toEqual({
				query: "tea",
				searchMode: "memories",
				limit: 5,
				threshold: 0.6,
			});
		});

		it("omits the threshold when none is given", async () => {
			mockSafeFetch.mockResolvedValueOnce({ results: [] });
			await new SupermemoryAdapter(smDescriptor()).search({ query: "q", userId: "u" });
			expect(call(0).body).toEqual({ query: "q", searchMode: "memories", limit: 10 });
		});

		it("rejects an empty query, a missing namespace, and unreadable responses", async () => {
			const adapter = new SupermemoryAdapter(smDescriptor());
			await expect(adapter.search({ query: " ", userId: "u" })).rejects.toThrow(
				"search query is required"
			);
			await expect(adapter.search({ query: "q" })).rejects.toThrow(
				"A user, agent, or session is required"
			);
			mockSafeFetch.mockResolvedValueOnce({ results: "nope" });
			await expect(adapter.search({ query: "q", userId: "u" })).rejects.toThrow(
				"could not read"
			);
			mockSafeFetch.mockResolvedValueOnce([]);
			await expect(adapter.search({ query: "q", userId: "u" })).rejects.toThrow(
				"could not read"
			);
		});

		it("surfaces HTTP errors from search", async () => {
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(402, "Out of credits"));
			await expect(
				new SupermemoryAdapter(smDescriptor()).search({ query: "q", userId: "u" })
			).rejects.toMatchObject({ status: 402 });
		});
	});

	describe("list", () => {
		it("lists the latest memories of a namespace with a durable total", async () => {
			mockSafeFetch.mockResolvedValueOnce({
				documents: [],
				memories: [memoryRow(), memoryRow({ id: "mem_2", isForgotten: true })],
				pagination: { currentPage: 1, limit: 2, totalItems: 5, totalPages: 3, hasMore: true },
			});
			const page = await new SupermemoryAdapter(smDescriptor()).listPage({
				userId: "user_1",
				limit: 2,
			});
			expect(page).toMatchObject({ total: 5, hasMore: true, nextOffset: 2 });
			expect(page.records[0]).toMatchObject({
				id: "user_1:mem_1",
				content: "Ada prefers tea",
				userId: "user_1",
				createdAt: "2026-09-01T00:00:00Z",
				updatedAt: "2026-09-02T00:00:00Z",
				metadata: {
					source: "chat",
					supermemory: { version: 2, is_static: false, is_inference: false, is_latest: true },
				},
			});
			expect(page.records[1].lifecycleState).toBe("forgotten");
			const request = call(0);
			expect(request.url).toBe(
				`${BASE}/ns/user_1/list/memories?page=1&limit=2&sort=createdAt&order=desc`
			);
			expect(request.method).toBe("POST");
			expect(request.body).toEqual({});
		});

		it("maps an offset to its page and drops rows before the offset", async () => {
			mockSafeFetch.mockResolvedValueOnce({
				memories: [memoryRow({ id: "a" }), memoryRow({ id: "b" })],
				pagination: { currentPage: 2, totalItems: 4, totalPages: 2 },
			});
			const page = await new SupermemoryAdapter(smDescriptor()).listPage({
				userId: "u",
				limit: 2,
				offset: 3,
			});
			expect(call(0).url).toContain("page=2&limit=2");
			expect(page.records.map((record) => record.id)).toEqual(["u:b"]);
			expect(page).toMatchObject({ hasMore: false, nextOffset: 4 });
		});

		it("caps the page size at the API maximum and list() returns records", async () => {
			mockSafeFetch.mockResolvedValueOnce({
				memories: [memoryRow()],
				pagination: { totalItems: 1, totalPages: 1 },
			});
			const records = await new SupermemoryAdapter(smDescriptor()).list({
				userId: "u",
				limit: 500,
			});
			expect(records).toHaveLength(1);
			expect(call(0).url).toContain("limit=100");
		});

		it("requires a namespace and a list response", async () => {
			const adapter = new SupermemoryAdapter(smDescriptor());
			await expect(adapter.list({})).rejects.toThrow("A user, agent, or session is required");
			mockSafeFetch.mockResolvedValueOnce({ memories: null });
			await expect(adapter.list({ userId: "u" })).rejects.toThrow("could not read");
			mockSafeFetch.mockResolvedValueOnce("<html></html>");
			await expect(adapter.list({ userId: "u" })).rejects.toThrow("could not read");
		});

		it("surfaces a rejected key as an HTTP error", async () => {
			mockSafeFetch.mockRejectedValue(new SourceResponseError(401, "Unauthorized"));
			await expect(
				new SupermemoryAdapter(smDescriptor()).list({ userId: "u" })
			).rejects.toMatchObject({ status: 401 });
		});
	});

	describe("get", () => {
		it("reads a memory with its earlier versions as history", async () => {
			mockSafeFetch.mockResolvedValueOnce({
				...memoryRow(),
				included: {
					related: {
						parents: [
							{
								id: "mem_0",
								relation: "updates",
								memory: "Ada prefers coffee",
								metadata: {},
								system: { updatedAt: "2026-08-01T00:00:00Z" },
							},
							{ id: "mem_x", relation: "extends", memory: "", system: {} },
						],
						children: [],
						siblings: [],
					},
				},
			});
			const record = await new SupermemoryAdapter(smDescriptor()).get("user%201:mem_1");
			expect(record).toMatchObject({ id: "user%201:mem_1", userId: "user 1", content: "Ada prefers tea" });
			expect(record?.history).toEqual([
				{
					id: "mem_0",
					event: "UPDATES",
					oldMemory: "Ada prefers coffee",
					createdAt: "2026-08-01T00:00:00Z",
				},
			]);
			expect(call(0).url).toBe(
				`${BASE}/ns/user%201/memories/mem_1?include=related&relatedLimit=20`
			);
		});

		it("returns null for a malformed id or a memory the namespace does not have", async () => {
			const adapter = new SupermemoryAdapter(smDescriptor());
			await expect(adapter.get("no-namespace")).resolves.toBeNull();
			await expect(adapter.get("u:")).resolves.toBeNull();
			await expect(adapter.get("%E0%A4%A:mem_1")).resolves.toBeNull();
			expect(mockSafeFetch).not.toHaveBeenCalled();
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "Not found"));
			await expect(adapter.get("u:mem_9")).resolves.toBeNull();
		});

		it("rethrows other HTTP errors and rejects unreadable responses", async () => {
			const adapter = new SupermemoryAdapter(smDescriptor());
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(500, "boom"));
			await expect(adapter.get("u:mem_1")).rejects.toMatchObject({ status: 500 });
			mockSafeFetch.mockResolvedValueOnce("<html></html>");
			await expect(adapter.get("u:mem_1")).rejects.toThrow("could not read");
		});
	});

	describe("delete", () => {
		it("forgets a memory by exact id", async () => {
			mockSafeFetch.mockResolvedValueOnce({
				count: 1,
				matches: [{ id: "mem_1", memory: "Ada prefers tea" }],
				errors: [],
			});
			await expect(
				new SupermemoryAdapter(smDescriptor()).delete("user_1:mem_1")
			).resolves.toBeUndefined();
			const request = call(0);
			expect(request.method).toBe("DELETE");
			expect(request.url).toBe(`${BASE}/ns/user_1/memories`);
			expect(request.body).toEqual({ ids: ["mem_1"] });
		});

		it("fails when the API reports a per-id error despite HTTP success", async () => {
			mockSafeFetch.mockResolvedValueOnce({
				count: 0,
				matches: [],
				errors: [{ id: "mem_1", error: "Memory not found" }],
			});
			await expect(
				new SupermemoryAdapter(smDescriptor()).delete("u:mem_1")
			).rejects.toThrow("Memory not found");
		});

		it("fails when nothing was forgotten and no reason is given", async () => {
			mockSafeFetch.mockResolvedValueOnce({ count: 0, matches: [], errors: [] });
			await expect(
				new SupermemoryAdapter(smDescriptor()).delete("u:mem_1")
			).rejects.toThrow("could not be found");
		});

		it("rejects malformed ids and unreadable responses", async () => {
			const adapter = new SupermemoryAdapter(smDescriptor());
			await expect(adapter.delete("memory-1")).rejects.toThrow("could not be found");
			expect(mockSafeFetch).not.toHaveBeenCalled();
			mockSafeFetch.mockResolvedValueOnce("ok");
			await expect(adapter.delete("u:mem_1")).rejects.toThrow("could not read");
		});

		it("surfaces HTTP errors from delete", async () => {
			mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(403, "read-only key"));
			await expect(
				new SupermemoryAdapter(smDescriptor()).delete("u:mem_1")
			).rejects.toMatchObject({ status: 403 });
		});
	});

	it("does not support update or feedback", async () => {
		const adapter = new SupermemoryAdapter(smDescriptor());
		expect(adapter.capabilities().update).toBe(false);
		expect(adapter.capabilities().feedback).toBe(false);
		await expect(adapter.update("u:mem_1", { content: "x" })).rejects.toBeInstanceOf(
			UnsupportedMemoryCapabilityError
		);
		await expect(adapter.feedback("u:mem_1", { rating: "positive" })).rejects.toBeInstanceOf(
			UnsupportedMemoryCapabilityError
		);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});
});

describe("Cognee adapter hardening", () => {
	const BASE = "https://cognee.example.com";
	const DS = "11111111-1111-4111-8111-111111111111";
	const DOC = "22222222-2222-4222-8222-222222222222";
	const d = (): MemorySourceDescriptor => ({
		type: "cognee",
		id: "memory:cognee",
		settings: { url: BASE },
		secretRef: "vault-1",
		name: "cognee",
		projectId: "proj-1",
	});
	const row = (id: string) => ({ id, name: "n", mimeType: "application/pdf", datasetId: DS });

	it("throws a typed error instead of null when the by-id scan hits its cap", async () => {
		const full = Array.from({ length: 1000 }, (_, i) =>
			row(`44444444-4444-4444-8444-${String(i).padStart(12, "0")}`)
		);
		mockSafeFetch.mockResolvedValue(full);
		const { CogneeLookupLimitError } = await import(
			"@/lib/platform/connectors/memory/cognee/adapter"
		);
		await expect(new CogneeAdapter(d()).get(`${DS}:${DOC}`)).rejects.toBeInstanceOf(
			CogneeLookupLimitError
		);
		expect(mockSafeFetch).toHaveBeenCalledTimes(20);
	});

	it("never retries writes, and keeps retry on for reads", async () => {
		mockSafeFetch
			.mockRejectedValueOnce(new SourceResponseError(503, "down"))
			.mockResolvedValueOnce({ dataset_id: DS, data_ids: [DOC] })
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ status: "incremental" })
			.mockResolvedValueOnce({ status: "success" })
			.mockResolvedValueOnce([]);
		const adapter = new CogneeAdapter(d());
		await expect(adapter.add({ content: "x", sessionId: DS })).rejects.toMatchObject({
			status: 503,
		});
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		await adapter.add({ content: "x", sessionId: DS });
		await adapter.update(`${DS}:${DOC}`, { content: "y" });
		await adapter.delete(`${DS}:${DOC}`);
		await adapter.listFilters();
		const retry = mockSafeFetch.mock.calls.map((c) => c[1].retry);
		expect(retry).toEqual([false, false, false, false, false, true]);
	});

	it("uses a fresh multipart boundary that never appears in the text", async () => {
		mockSafeFetch.mockResolvedValue({ status: "incremental" });
		const adapter = new CogneeAdapter(d());
		await adapter.update(`${DS}:${DOC}`, { content: "a" });
		await adapter.update(`${DS}:${DOC}`, { content: "a" });
		const b = (i: number) =>
			mockSafeFetch.mock.calls[i][1].headers["Content-Type"].split("boundary=")[1];
		expect(b(0)).not.toBe(b(1));
	});

	it("truncates a graph over 600 nodes, pruning edges to dropped nodes", async () => {
		const nodes = Array.from({ length: 700 }, (_, i) => ({ id: `n${i}`, label: `n${i}`, type: "Entity" }));
		const edges = Array.from({ length: 699 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}`, label: "next" }));
		mockSafeFetch.mockResolvedValueOnce({ nodes, edges });
		const graph = await new CogneeAdapter(d()).graph({ sessionId: DS });
		expect(graph.nodes).toHaveLength(600);
		expect(graph.truncated).toBe(true);
		const kept = new Set(graph.nodes.map((n) => n.id));
		expect(graph.edges.length).toBeGreaterThan(0);
		expect(graph.edges.length).toBeLessThan(699);
		expect(graph.edges.every((e) => kept.has(e.from) && kept.has(e.to))).toBe(true);
	});

	it("does not leak the API key in thrown errors", async () => {
		mockSafeFetch.mockRejectedValue(new SourceResponseError(401, "Data source responded 401: [redacted]"));
		const adapter = new CogneeAdapter(d());
		for (const run of [
			() => adapter.add({ content: "x", sessionId: DS }),
			() => adapter.list({ sessionId: DS }),
			() => adapter.delete(`${DS}:${DOC}`),
		]) {
			await expect(run()).rejects.toThrow(/^(?!.*secret-key)/);
		}
		const health = await adapter.healthCheck();
		expect(health.message).not.toContain("secret-key");
	});
});

describe("Supermemory adapter hardening", () => {
	const BASE = "https://api.supermemory.ai";
	const d = (): MemorySourceDescriptor => ({
		type: "supermemory",
		id: "memory:supermemory",
		settings: { url: BASE },
		secretRef: "vault-1",
		name: "supermemory",
		projectId: "proj-1",
	});

	it("reads and deletes the document add stored, through the document routes", async () => {
		const adapter = new SupermemoryAdapter(d());
		mockSafeFetch.mockResolvedValueOnce({ id: "doc_1", status: "queued" });
		const [added] = await adapter.add({ content: "Ada prefers tea", userId: "u1" });
		expect(added.id).toBe("u1:document:doc_1");

		mockSafeFetch.mockResolvedValueOnce({
			id: "doc_1",
			content: "Ada prefers tea",
			summary: null,
			title: null,
			metadata: {},
			system: { status: "done", createdAt: "c", updatedAt: "u" },
		});
		const got = await adapter.get(added.id);
		expect(got).toMatchObject({
			id: "u1:document:doc_1",
			content: "Ada prefers tea",
			metadata: { supermemory: { kind: "document", status: "done" } },
		});
		expect(String(mockSafeFetch.mock.calls[1][0])).toBe(`${BASE}/ns/u1/document/doc_1`);

		mockSafeFetch.mockResolvedValueOnce({ count: 1, errors: [] });
		await adapter.delete(added.id);
		const [url, options] = mockSafeFetch.mock.calls[2];
		expect(String(url)).toBe(`${BASE}/ns/u1/document`);
		expect(options.method).toBe("DELETE");
		expect(JSON.parse(options.body)).toEqual({ ids: ["doc_1"] });
	});

	it("returns null for a missing or empty document", async () => {
		const adapter = new SupermemoryAdapter(d());
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "nf"));
		await expect(adapter.get("u1:document:x")).resolves.toBeNull();
		mockSafeFetch.mockResolvedValueOnce({ id: "x", content: null, system: {} });
		await expect(adapter.get("u1:document:x")).resolves.toBeNull();
		await expect(adapter.get("u1:document:")).resolves.toBeNull();
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(500, "boom"));
		await expect(adapter.get("u1:document:x")).rejects.toMatchObject({ status: 500 });
	});

	it("never retries writes, and keeps retry on for reads", async () => {
		mockSafeFetch
			.mockRejectedValueOnce(new SourceResponseError(503, "down"))
			.mockResolvedValueOnce({ count: 1, errors: [] })
			.mockResolvedValueOnce({ results: [] });
		const adapter = new SupermemoryAdapter(d());
		await expect(adapter.add({ content: "x", userId: "u" })).rejects.toMatchObject({ status: 503 });
		expect(mockSafeFetch).toHaveBeenCalledTimes(1);
		await adapter.delete("u:mem_1");
		await adapter.search({ query: "q", userId: "u" });
		expect(mockSafeFetch.mock.calls.map((c) => c[1].retry)).toEqual([false, false, true]);
	});

	it("maps offset 25 / limit 50 to page 1 and keeps rows from the offset", async () => {
		const rows = Array.from({ length: 50 }, (_, i) => ({
			id: `m${i}`, memory: `memory ${i}`, metadata: {}, system: {},
		}));
		mockSafeFetch.mockResolvedValueOnce({
			memories: rows,
			pagination: { currentPage: 1, totalItems: 120, totalPages: 3, hasMore: true },
		});
		const page = await new SupermemoryAdapter(d()).listPage({ userId: "u", limit: 50, offset: 25 });
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("page=1&limit=50");
		expect(page.records).toHaveLength(25);
		expect(page.records[0].id).toBe("u:m25");
		expect(page).toMatchObject({ total: 120, hasMore: true, nextOffset: 50 });
	});

	it("rejects ids without a namespace and does not read across namespaces", async () => {
		const adapter = new SupermemoryAdapter(d());
		await expect(adapter.get("plainid")).resolves.toBeNull();
		mockSafeFetch.mockRejectedValueOnce(new SourceResponseError(404, "other namespace"));
		await expect(adapter.get("ns_b:mem_of_ns_a")).resolves.toBeNull();
		expect(String(mockSafeFetch.mock.calls[0][0])).toContain("/ns/ns_b/memories/mem_of_ns_a");
	});

	it("reports non-object responses and a missing results list as unreadable", async () => {
		const adapter = new SupermemoryAdapter(d());
		mockSafeFetch.mockResolvedValueOnce([]);
		await expect(adapter.listPage({ userId: "u" })).rejects.toThrow("could not read");
		mockSafeFetch.mockResolvedValueOnce({ searchTime: 1 });
		await expect(adapter.search({ query: "q", userId: "u" })).rejects.toThrow("could not read");
	});

	it("uses the first per-id error message on delete", async () => {
		mockSafeFetch.mockResolvedValueOnce({
			count: 0,
			errors: [{ id: "a", error: "first" }, { id: "b", error: "second" }],
		});
		await expect(new SupermemoryAdapter(d()).delete("u:a")).rejects.toThrow("first");
	});

	it("does not leak the API key in thrown errors", async () => {
		mockSafeFetch.mockRejectedValue(new SourceResponseError(401, "Data source responded 401: [redacted]"));
		const adapter = new SupermemoryAdapter(d());
		for (const run of [
			() => adapter.add({ content: "x", userId: "u" }),
			() => adapter.list({ userId: "u" }),
			() => adapter.delete("u:m"),
		]) {
			await expect(run()).rejects.toThrow(/^(?!.*secret-key)/);
		}
		expect((await adapter.healthCheck()).message).not.toContain("secret-key");
	});
});
