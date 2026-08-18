const mockListMemoryConnectors = jest.fn();
const mockGetMemoryRuntime = jest.fn();

jest.mock("@/lib/platform/connectors/memory/crud", () => ({
	listMemoryConnectors: (...a: unknown[]) => mockListMemoryConnectors(...a),
	getMemoryRuntime: (...a: unknown[]) => mockGetMemoryRuntime(...a),
	rememberMemoryFilters: jest.fn().mockResolvedValue(undefined),
	memoryConnectorId: (id: string) =>
		String(id).startsWith("memory:") ? id : `memory:${id}`,
}));

import {
	addProjectMemories,
	deleteProjectMemory,
	parseMemoryMetadata,
	updateProjectMemory,
} from "@/lib/platform/connectors/memory/write";
import {
	MEMORY_ADD_UNSUPPORTED,
	MEMORY_CONNECTOR_CONTENT_REQUIRED,
	MEMORY_DELETE_UNSUPPORTED,
	MEMORY_EDIT_UNSUPPORTED,
	MEMORY_INVALID_METADATA,
} from "@/constants/messages/en";

const connector = {
	id: "memory:abc",
	name: "Prod Mem0",
	type: "mem0",
	environment: "production",
	hasSecret: true,
};

const capabilities = {
	add: true,
	search: true,
	get: true,
	list: true,
	update: true,
	delete: true,
	feedback: false,
};

describe("addProjectMemories", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("writes through the adapter and classifies the result", async () => {
		const add = jest.fn().mockResolvedValue([
			{ id: "m1", content: "Prefers tabs", userId: "ada" },
		]);
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, add },
		});

		const result = await addProjectMemories({
			connectorId: "abc",
			content: "Prefers tabs",
			userId: "ada",
		});
		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({ content: "Prefers tabs", userId: "ada" })
		);
		expect(result.memories[0].id).toBe("m1");
		expect(result.memories[0].kind).toBeDefined();
		expect(result.connector).not.toHaveProperty("secretRef");
	});

	it("rejects empty content", async () => {
		await expect(addProjectMemories({ content: "   " })).rejects.toThrow(
			MEMORY_CONNECTOR_CONTENT_REQUIRED
		);
		expect(mockGetMemoryRuntime).not.toHaveBeenCalled();
	});

	it("rejects vendors that cannot add", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({ ...capabilities, add: false }),
				add: jest.fn(),
			},
		});
		await expect(addProjectMemories({ content: "hello" })).rejects.toThrow(
			MEMORY_ADD_UNSUPPORTED
		);
	});
});

describe("updateProjectMemory", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("updates through the adapter", async () => {
		const update = jest.fn().mockResolvedValue({
			id: "m1",
			content: "Prefers spaces",
		});
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, update },
		});
		const result = await updateProjectMemory({
			id: "m1",
			content: "Prefers spaces",
		});
		expect(update).toHaveBeenCalledWith("m1", {
			content: "Prefers spaces",
			metadata: undefined,
		});
		expect(result.memory.content).toBe("Prefers spaces");
	});

	it("rejects vendors that cannot update", async () => {
		mockListMemoryConnectors.mockResolvedValue([{ ...connector, type: "zep" }]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector: { ...connector, type: "zep" },
			adapter: {
				capabilities: () => ({ ...capabilities, update: false }),
				update: jest.fn(),
			},
		});
		await expect(
			updateProjectMemory({ id: "m1", content: "hello" })
		).rejects.toThrow(MEMORY_EDIT_UNSUPPORTED);
	});
});

describe("deleteProjectMemory", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("deletes through the adapter", async () => {
		const remove = jest.fn().mockResolvedValue(undefined);
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, delete: remove },
		});
		await expect(deleteProjectMemory({ id: "m1" })).resolves.toEqual(
			expect.objectContaining({ ok: true })
		);
		expect(remove).toHaveBeenCalledWith("m1");
	});

	it("rejects vendors that cannot delete", async () => {
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: {
				capabilities: () => ({ ...capabilities, delete: false }),
				delete: jest.fn(),
			},
		});
		await expect(deleteProjectMemory({ id: "m1" })).rejects.toThrow(
			MEMORY_DELETE_UNSUPPORTED
		);
	});
});

describe("parseMemoryMetadata", () => {
	it("rejects arrays", () => {
		expect(() => parseMemoryMetadata([])).toThrow(MEMORY_INVALID_METADATA);
	});
});
