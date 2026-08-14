const mockListMemoryConnectors = jest.fn();
const mockGetMemoryRuntime = jest.fn();

jest.mock("@/lib/platform/connectors/memory/crud", () => ({
	listMemoryConnectors: (...a: unknown[]) => mockListMemoryConnectors(...a),
	getMemoryRuntime: (...a: unknown[]) => mockGetMemoryRuntime(...a),
	memoryConnectorId: (id: string) =>
		String(id).startsWith("memory:") ? id : `memory:${id}`,
}));

import { getProjectMemory, queryProjectMemories } from "@/lib/platform/connectors/memory/read";
import { MEMORY_CONNECTOR_SESSION_REQUIRED, MEMORY_DETAIL_NOT_FOUND } from "@/constants/messages/en";

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
});
