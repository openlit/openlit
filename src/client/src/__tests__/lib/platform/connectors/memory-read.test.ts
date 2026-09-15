const mockListMemoryConnectors = jest.fn();
const mockGetMemoryRuntime = jest.fn();
const mockGetMemoryTypeDescriptor = jest.fn();

jest.mock("@/lib/platform/connectors/memory/registry", () => ({
	getMemoryTypeDescriptor: (...a: unknown[]) => mockGetMemoryTypeDescriptor(...a),
}));

jest.mock("@/lib/platform/connectors/memory/crud", () => ({
	listMemoryConnectors: (...a: unknown[]) => mockListMemoryConnectors(...a),
	getMemoryRuntime: (...a: unknown[]) => mockGetMemoryRuntime(...a),
	readMemoryPortLinks: jest.fn().mockResolvedValue([]),
	readRememberedMemoryFilters: jest.fn().mockResolvedValue({
		users: [],
		sessions: [],
		agents: [],
	}),
	rememberMemoryFilters: jest.fn().mockResolvedValue(undefined),
	emptyRememberedMemoryFilters: () => ({ users: [], sessions: [], agents: [] }),
	memoryConnectorId: (id: string) =>
		String(id).startsWith("memory:") ? id : `memory:${id}`,
}));

import {
	getProjectMemory,
	queryProjectMemories,
	resolveProjectMemoryAdapter,
	submitProjectMemoryFeedback,
} from "@/lib/platform/connectors/memory/read";
import { readRememberedMemoryFilters } from "@/lib/platform/connectors/memory/crud";
import { UnsupportedMemoryCapabilityError } from "@/lib/platform/connectors/memory/types";
import { getMemoryTypeDescriptor } from "@/lib/platform/connectors/memory/registry";
import { SourceResponseError } from "@/lib/platform/connectors/datasource/http/safe-fetch";
import {
	MEMORY_CONNECTOR_FILTER_REQUIRED,
	MEMORY_CONNECTOR_NOT_FOUND,
	MEMORY_CONNECTOR_QUERY_REQUIRED,
	MEMORY_CONNECTOR_SESSION_REQUIRED,
	MEMORY_DETAIL_FEEDBACK_UNSUPPORTED,
	MEMORY_DETAIL_NOT_FOUND,
	MEMORY_FEEDBACK_INVALID,
	MEMORY_FEEDBACK_REASON_TOO_LONG,
} from "@/constants/messages/en";

const connector = {
	id: "memory:abc",
	name: "Prod Mem0",
	type: "mem0",
	environment: "production",
	hasSecret: true,
};

describe("queryProjectMemories", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockGetMemoryTypeDescriptor.mockReturnValue(undefined);
	});

	it("returns an empty payload when the project has no memory connectors", async () => {
		mockListMemoryConnectors.mockResolvedValue([]);
		await expect(queryProjectMemories()).resolves.toEqual(
			expect.objectContaining({
				connectors: [],
				connector: null,
				memories: [],
				stats: expect.objectContaining({ total: 0 }),
			})
		);
		expect(mockGetMemoryRuntime).not.toHaveBeenCalled();
	});

	it("lists memories through the selected adapter and classifies them", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: async () => [
					{
						id: "m1",
						content: "Migrated tracing SDK",
						userId: "ada",
						metadata: { memory_type: "temporal" },
					},
				],
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories({ connectorId: "abc" });
		expect(result.connector?.id).toBe("memory:abc");
		expect(result.memories[0].kind).toBe("temporal");
		expect(result.stats.total).toBe(1);
		expect(result.graph.nodes.some((node) => node.id === "memory:m1")).toBe(true);
		expect(result.filters.users).toEqual([{ id: "ada", label: "ada" }]);
		expect(result.filterFields.length).toBeGreaterThan(0);
		expect(result.connector).not.toHaveProperty("secretRef");
	});

	it("searches when a query is provided", async () => {
		const search = jest.fn().mockResolvedValue([
			{ id: "hit", content: "Profiled the trace exporter", userId: "ada" },
		]);
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: jest.fn(),
				search,
			},
		});

		const result = await queryProjectMemories({ query: "exporter" });
		expect(search).toHaveBeenCalledWith(
			expect.objectContaining({ query: "exporter" })
		);
		expect(result.memories[0].id).toBe("hit");
	});

	it("returns a session hint instead of failing when Zep list needs a session", async () => {
		mockListMemoryConnectors.mockResolvedValue([
			{ ...connector, type: "zep" },
		]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector: { ...connector, type: "zep" },
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: false,
					list: true,
					update: false,
					delete: true,
				}),
				list: async () => {
					throw new Error(MEMORY_CONNECTOR_SESSION_REQUIRED);
				},
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.hint).toBe("session_required");
		expect(result.connectors).toHaveLength(1);
		expect(result.memories).toEqual([]);
		expect(result.filters).toEqual({ users: [], sessions: [], agents: [] });
	});

	it("returns a filter hint and vendor options when Mem0 list needs a scope", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				listFilters: async () => ({
					users: [{ id: "ada", label: "ada@example.com" }],
					sessions: [{ id: "run-1", label: "run-1", userId: "ada" }],
					agents: [],
				}),
				list: async () => {
					throw new Error(
						'SourceResponseError: Data source responded 400: ["One of the filters: app_id, user_id, agent_id, run_id is required!"]'
					);
				},
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.hint).toBe("filter_required");
		expect(result.memories).toEqual([]);
		expect(result.filters.users).toEqual([{ id: "ada", label: "ada@example.com" }]);
		expect(result.filters.sessions[0].id).toBe("run-1");
	});

	it("includes the requested user in filters when the vendor cannot enumerate users", async () => {
		mockListMemoryConnectors.mockResolvedValue([
			{ ...connector, type: "mem0" },
		]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector: { ...connector, type: "mem0" },
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: false,
					list: true,
					update: false,
					delete: false,
					feedback: false,
				}),
				listFilters: async () => ({ users: [], sessions: [], agents: [] }),
				list: async () => [],
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories({
			connectorId: "abc",
			userId: "aman",
		});
		expect(result.filters.users).toEqual([{ id: "aman", label: "aman" }]);
	});

	it("includes remembered users when listing still needs a user filter", async () => {
		(readRememberedMemoryFilters as jest.Mock).mockResolvedValueOnce({
			users: ["aman"],
			sessions: [],
			agents: [],
		});
		mockListMemoryConnectors.mockResolvedValue([
			{ ...connector, type: "mem0" },
		]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector: { ...connector, type: "mem0" },
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: false,
					list: true,
					update: false,
					delete: false,
					feedback: false,
				}),
				listFilters: async () => ({ users: [], sessions: [], agents: [] }),
				list: async () => {
					throw new Error(MEMORY_CONNECTOR_FILTER_REQUIRED);
				},
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories({ connectorId: "abc" });
		expect(result.hint).toBe("filter_required");
		expect(result.filters.users).toEqual([{ id: "aman", label: "aman" }]);
	});

	it("returns an auth hint when the vendor rejects the API key", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				listFilters: async () => ({ users: [], sessions: [], agents: [] }),
				list: async () => {
					const error = new Error(
						'Data source responded 401: {"error":{"message":"API key is invalid."}}'
					) as Error & { status: number };
					error.status = 401;
					throw error;
				},
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.hint).toBe("auth_failed");
		expect(result.memories).toEqual([]);
		expect(result.connectors).toHaveLength(1);
	});

	it("returns an unavailable hint when the vendor list call fails", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: async () => {
					throw new Error("Data source responded 404: memory store not found");
				},
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.hint).toBe("unavailable");
		expect(result.memories).toEqual([]);
	});

	it("uses the descriptor's own filter fields instead of the fallback when provided", async () => {
		mockGetMemoryTypeDescriptor.mockReturnValue({
			filterFields: [{ key: "custom", label: "Custom", allowCustom: false }],
			capabilities: { add: true },
		});
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: async () => [],
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.filterFields).toEqual([
			{ key: "custom", label: "Custom", allowCustom: false },
		]);
		expect(result.connector?.capabilities).toEqual({ add: true });
	});

	it("clamps a non-numeric limit down to the default", async () => {
		const list = jest.fn().mockResolvedValue([]);
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list,
				search: jest.fn(),
			},
		});

		await queryProjectMemories({ limit: Number.NaN });
		expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
	});

	it("keys remembered sessions to their owning user when both are known", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: async () => [],
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories({ userId: "ada", sessionId: "run-1" });
		expect(result.filters.sessions).toEqual([
			{ id: "run-1", label: "run-1", userId: "ada" },
		]);
	});

	it("derives session filter choices from returned memory records", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: async () => [
					{ id: "m1", content: "hi", userId: "ada", sessionId: "run-2" },
				],
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.filters.sessions).toEqual([
			expect.objectContaining({ id: "run-2", userId: "ada" }),
		]);
	});

	it("falls back to empty filters when listFilters throws", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				listFilters: async () => {
					throw new Error("boom");
				},
				list: async () => [],
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.filters).toEqual({ users: [], sessions: [], agents: [] });
	});

	it("rejects a search query when the adapter does not support search", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: false,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: jest.fn(),
				search: jest.fn(),
			},
		});

		await expect(queryProjectMemories({ query: "hello" })).rejects.toThrow(
			MEMORY_CONNECTOR_QUERY_REQUIRED
		);
	});

	it("clamps limits above the max and below the minimum, and floors decimals", async () => {
		const list = jest.fn().mockResolvedValue([]);
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list,
				search: jest.fn(),
			},
		});

		await queryProjectMemories({ limit: 5000 });
		expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));

		await queryProjectMemories({ limit: -3 });
		expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));

		await queryProjectMemories({ limit: 12.9 });
		expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 12 }));
	});

	it("dedupes filter choices that appear in more than one source", async () => {
		(readRememberedMemoryFilters as jest.Mock).mockResolvedValueOnce({
			users: ["ada"],
			sessions: [],
			agents: [],
		});
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				listFilters: async () => ({
					users: [{ id: "ada", label: "ada" }],
					sessions: [],
					agents: [],
				}),
				list: async () => [{ id: "m1", content: "hi", userId: "ada" }],
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.filters.users).toEqual([{ id: "ada", label: "ada" }]);
	});

	it("includes the requested agent in scoped filters and remembers agent ids from records", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: async () => [{ id: "m1", content: "hi", agentId: "bot-1" }],
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories({ agentId: "bot-1" });
		expect(result.filters.agents).toEqual([{ id: "bot-1", label: "bot-1" }]);
	});

	it("tolerates memory records missing userId/agentId when remembering filters", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: async () => [{ id: "m1", content: "no identity fields" }],
				search: jest.fn(),
			},
		});

		await expect(queryProjectMemories()).resolves.toEqual(
			expect.objectContaining({ memories: expect.any(Array) })
		);
	});

	it("reads the connector's status off a SourceResponseError instance", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: async () => {
					throw new SourceResponseError(401, "API key is invalid.");
				},
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.hint).toBe("auth_failed");
	});

	it("stringifies a non-Error thrown value when computing the list-error hint", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: async () => {
					throw "boom";
				},
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.hint).toBe("unavailable");
	});

	it("treats a falsy listFilters resolution as empty filters", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				listFilters: async () => undefined,
				list: async () => [],
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.filters).toEqual({ users: [], sessions: [], agents: [] });
	});

	it("throws when the requested connector id does not match any connector", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		await expect(
			queryProjectMemories({ connectorId: "does-not-exist" })
		).rejects.toThrow(MEMORY_CONNECTOR_NOT_FOUND);
	});

	it("falls back to default filter fields and copy metadata when the connector has no type", async () => {
		mockListMemoryConnectors.mockResolvedValue([{ ...connector, type: undefined }]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector: { ...connector, type: undefined },
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: async () => [],
				search: jest.fn(),
			},
		});

		const result = await queryProjectMemories();
		expect(result.filterFields.length).toBeGreaterThan(0);
		expect(result.connector?.capabilities).toBeNull();
	});

	it("returns an empty result with a hint when the search call fails", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				list: jest.fn(),
				search: async () => {
					throw new Error("Data source responded 404: search unavailable");
				},
			},
		});

		const result = await queryProjectMemories({ query: "hello" });
		expect(result.hint).toBe("unavailable");
		expect(result.memories).toEqual([]);
	});
});

describe("getProjectMemory", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("fetches a memory by id through the adapter", async () => {
		const get = jest.fn().mockResolvedValue({
			id: "mem-1",
			content: "User's name is Alex, they are a vegetarian, and they have a nut allergy",
			userId: "alex",
			metadata: { memory_type: "profile" },
		});
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				get,
			},
		});

		const result = await getProjectMemory({ id: "mem-1", connectorId: "abc" });
		expect(get).toHaveBeenCalledWith("mem-1");
		expect(result.memory?.kind).toBe("profile");
		expect(result.memory?.userId).toBe("alex");
		expect(result.connector).not.toHaveProperty("secretRef");
	});

	it("returns a get_unsupported hint when the vendor cannot fetch by id", async () => {
		mockListMemoryConnectors.mockResolvedValue([{ ...connector, type: "zep" }]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector: { ...connector, type: "zep" },
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: false,
					list: true,
					update: false,
					delete: true,
				}),
				get: jest.fn(),
			},
		});

		const result = await getProjectMemory({ id: "mem-1" });
		expect(result.hint).toBe("get_unsupported");
		expect(result.memory).toBeNull();
	});

	it("throws when the memory is missing", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				get: async () => null,
			},
		});

		await expect(getProjectMemory({ id: "missing" })).rejects.toThrow(
			MEMORY_DETAIL_NOT_FOUND
		);
	});

	it("throws when the id is blank", async () => {
		await expect(getProjectMemory({ id: "   " })).rejects.toThrow(
			MEMORY_DETAIL_NOT_FOUND
		);
		expect(mockListMemoryConnectors).not.toHaveBeenCalled();
	});

	it("returns a get_unsupported hint when the adapter rejects get() as unsupported", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				get: async () => {
					throw new UnsupportedMemoryCapabilityError("mem0", "get");
				},
			},
		});

		const result = await getProjectMemory({ id: "mem-1" });
		expect(result.hint).toBe("get_unsupported");
		expect(result.memory).toBeNull();
	});

	it("rethrows unexpected errors from adapter.get", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
				}),
				get: async () => {
					throw new Error("network down");
				},
			},
		});

		await expect(getProjectMemory({ id: "mem-1" })).rejects.toThrow("network down");
	});
});

describe("resolveProjectMemoryAdapter", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("throws when the project has no memory connectors", async () => {
		mockListMemoryConnectors.mockResolvedValue([]);
		await expect(resolveProjectMemoryAdapter()).rejects.toThrow(
			MEMORY_CONNECTOR_NOT_FOUND
		);
	});

	it("throws when the requested connector id does not match any connector", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		await expect(resolveProjectMemoryAdapter("does-not-exist")).rejects.toThrow(
			MEMORY_CONNECTOR_NOT_FOUND
		);
	});
});

describe("submitProjectMemoryFeedback", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("posts feedback through the adapter and refreshes the memory", async () => {
		const feedback = jest.fn().mockResolvedValue({
			rating: "positive",
			reason: "Accurate",
		});
		const get = jest.fn().mockResolvedValue({
			id: "mem-1",
			content: "hello",
			feedback: { rating: "positive", reason: "Accurate" },
		});
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
					feedback: true,
				}),
				feedback,
				get,
			},
		});

		const result = await submitProjectMemoryFeedback({
			id: "mem-1",
			connectorId: "abc",
			rating: "positive",
			reason: "Accurate",
		});
		expect(feedback).toHaveBeenCalledWith("mem-1", {
			rating: "positive",
			reason: "Accurate",
		});
		expect(result.feedback.rating).toBe("positive");
		expect(result.memory?.feedback?.rating).toBe("positive");
		expect(result.connector).not.toHaveProperty("secretRef");
	});

	it("rejects feedback when the vendor does not support it", async () => {
		mockListMemoryConnectors.mockResolvedValue([{ ...connector, type: "zep" }]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector: { ...connector, type: "zep" },
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: false,
					delete: true,
					feedback: false,
				}),
				feedback: jest.fn(),
			},
		});

		await expect(
			submitProjectMemoryFeedback({ id: "mem-1", rating: "negative" })
		).rejects.toThrow(MEMORY_DETAIL_FEEDBACK_UNSUPPORTED);
	});

	it("throws when the id is blank", async () => {
		await expect(
			submitProjectMemoryFeedback({ id: "  ", rating: "positive" })
		).rejects.toThrow(MEMORY_DETAIL_NOT_FOUND);
		expect(mockListMemoryConnectors).not.toHaveBeenCalled();
	});

	it("rejects an invalid rating value", async () => {
		await expect(
			submitProjectMemoryFeedback({
				id: "mem-1",
				rating: "not-a-rating" as unknown as never,
			})
		).rejects.toThrow(MEMORY_FEEDBACK_INVALID);
		expect(mockListMemoryConnectors).not.toHaveBeenCalled();
	});

	it("rejects a reason longer than the maximum length", async () => {
		await expect(
			submitProjectMemoryFeedback({
				id: "mem-1",
				rating: "positive",
				reason: "x".repeat(1001),
			})
		).rejects.toThrow(MEMORY_FEEDBACK_REASON_TOO_LONG);
		expect(mockListMemoryConnectors).not.toHaveBeenCalled();
	});

	it("sends a null reason when none is provided", async () => {
		const feedback = jest.fn().mockResolvedValue({ rating: "positive" });
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: false,
					list: true,
					update: true,
					delete: true,
					feedback: true,
				}),
				feedback,
			},
		});

		await submitProjectMemoryFeedback({ id: "mem-1", rating: "positive" });
		expect(feedback).toHaveBeenCalledWith("mem-1", {
			rating: "positive",
			reason: null,
		});
	});

	it("normalizes an unsupported-capability error from adapter.feedback", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: false,
					list: true,
					update: true,
					delete: true,
					feedback: true,
				}),
				feedback: async () => {
					throw new UnsupportedMemoryCapabilityError("mem0", "feedback");
				},
			},
		});

		await expect(
			submitProjectMemoryFeedback({ id: "mem-1", rating: "positive" })
		).rejects.toThrow(MEMORY_DETAIL_FEEDBACK_UNSUPPORTED);
	});

	it("rethrows unexpected errors from adapter.feedback", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: false,
					list: true,
					update: true,
					delete: true,
					feedback: true,
				}),
				feedback: async () => {
					throw new Error("vendor exploded");
				},
			},
		});

		await expect(
			submitProjectMemoryFeedback({ id: "mem-1", rating: "positive" })
		).rejects.toThrow("vendor exploded");
	});

	it("falls back to the submitted feedback when the refreshed memory has none of its own", async () => {
		const feedback = jest.fn().mockResolvedValue({ rating: "positive", reason: "Accurate" });
		const get = jest.fn().mockResolvedValue({ id: "mem-1", content: "hello" });
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
					feedback: true,
				}),
				feedback,
				get,
			},
		});

		const result = await submitProjectMemoryFeedback({
			id: "mem-1",
			rating: "positive",
			reason: "Accurate",
		});
		expect(result.memory?.feedback).toEqual({ rating: "positive", reason: "Accurate" });
	});

	it("leaves memory null when the post-feedback refresh fails", async () => {
		const feedback = jest.fn().mockResolvedValue({ rating: "positive" });
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
					feedback: true,
				}),
				feedback,
				get: async () => {
					throw new Error("refresh failed");
				},
			},
		});

		const result = await submitProjectMemoryFeedback({ id: "mem-1", rating: "positive" });
		expect(result.memory).toBeNull();
	});
});
