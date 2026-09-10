const mockListMemoryConnectors = jest.fn();
const mockGetMemoryRuntime = jest.fn();
const mockRememberMemoryFilters = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/platform/connectors/memory/crud", () => ({
	listMemoryConnectors: (...a: unknown[]) => mockListMemoryConnectors(...a),
	getMemoryRuntime: (...a: unknown[]) => mockGetMemoryRuntime(...a),
	rememberMemoryFilters: (...a: unknown[]) => mockRememberMemoryFilters(...a),
	memoryConnectorId: (id: string) =>
		String(id).startsWith("memory:") ? id : `memory:${id}`,
}));

import {
	addProjectMemories,
	deleteProjectMemory,
	parseMemoryMessages,
	parseMemoryMetadata,
	updateProjectMemory,
} from "@/lib/platform/connectors/memory/write";
import { UnsupportedMemoryCapabilityError } from "@/lib/platform/connectors/memory/types";
import {
	MEMORY_ADD_UNSUPPORTED,
	MEMORY_CONNECTOR_CONTENT_REQUIRED,
	MEMORY_CONTENT_TOO_LONG,
	MEMORY_DELETE_UNSUPPORTED,
	MEMORY_DETAIL_NOT_FOUND,
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

	it("writes through the adapter using messages instead of content", async () => {
		const add = jest.fn().mockResolvedValue([
			{ id: "m1", content: "Prefers tabs", userId: "ada" },
		]);
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, add },
		});

		await addProjectMemories({
			connectorId: "abc",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [{ role: "user", content: "hi" }],
			})
		);
	});

	it("remembers session and agent ids returned by the adapter even without a userId", async () => {
		const add = jest.fn().mockResolvedValue([
			{ id: "m1", content: "Prefers tabs", sessionId: "sess-1", agentId: "agent-1" },
		]);
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, add },
		});

		await addProjectMemories({ connectorId: "abc", content: "Prefers tabs" });
		expect(mockRememberMemoryFilters).toHaveBeenCalledWith(
			"memory:abc",
			expect.objectContaining({
				users: [],
				sessions: ["sess-1"],
				agents: ["agent-1"],
			})
		);
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

	it("rejects content longer than the max length", async () => {
		await expect(
			addProjectMemories({ content: "x".repeat(20_001) })
		).rejects.toThrow(MEMORY_CONTENT_TOO_LONG);
		expect(mockGetMemoryRuntime).not.toHaveBeenCalled();
	});

	it("classifies an unsupported-capability error from the adapter as add-unsupported", async () => {
		const add = jest
			.fn()
			.mockRejectedValue(
				new UnsupportedMemoryCapabilityError("mem0", "add")
			);
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, add },
		});
		await expect(addProjectMemories({ content: "hello" })).rejects.toThrow(
			MEMORY_ADD_UNSUPPORTED
		);
	});

	it("rethrows a generic adapter error unchanged", async () => {
		const add = jest.fn().mockRejectedValue(new Error("upstream down"));
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, add },
		});
		await expect(addProjectMemories({ content: "hello" })).rejects.toThrow(
			"upstream down"
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

	it("rejects blank content", async () => {
		await expect(
			updateProjectMemory({ id: "m1", content: "   " })
		).rejects.toThrow(MEMORY_CONNECTOR_CONTENT_REQUIRED);
		expect(mockGetMemoryRuntime).not.toHaveBeenCalled();
	});

	it("rejects content longer than the max length", async () => {
		await expect(
			updateProjectMemory({ id: "m1", content: "x".repeat(20_001) })
		).rejects.toThrow(MEMORY_CONTENT_TOO_LONG);
		expect(mockGetMemoryRuntime).not.toHaveBeenCalled();
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

	it("rejects a blank id", async () => {
		await expect(
			updateProjectMemory({ id: "   ", content: "hello" })
		).rejects.toThrow(MEMORY_DETAIL_NOT_FOUND);
		expect(mockGetMemoryRuntime).not.toHaveBeenCalled();
	});

	it("classifies an unsupported-capability error from the adapter as edit-unsupported", async () => {
		const update = jest
			.fn()
			.mockRejectedValue(
				new UnsupportedMemoryCapabilityError("zep", "update")
			);
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, update },
		});
		await expect(
			updateProjectMemory({ id: "m1", content: "hello" })
		).rejects.toThrow(MEMORY_EDIT_UNSUPPORTED);
	});

	it("rethrows a generic adapter error unchanged", async () => {
		const update = jest.fn().mockRejectedValue(new Error("upstream down"));
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, update },
		});
		await expect(
			updateProjectMemory({ id: "m1", content: "hello" })
		).rejects.toThrow("upstream down");
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

	it("rejects a blank id", async () => {
		await expect(deleteProjectMemory({ id: "  " })).rejects.toThrow(
			MEMORY_DETAIL_NOT_FOUND
		);
		expect(mockGetMemoryRuntime).not.toHaveBeenCalled();
	});

	it("classifies an unsupported-capability error from the adapter as delete-unsupported", async () => {
		const remove = jest
			.fn()
			.mockRejectedValue(
				new UnsupportedMemoryCapabilityError("zep", "delete")
			);
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, delete: remove },
		});
		await expect(deleteProjectMemory({ id: "m1" })).rejects.toThrow(
			MEMORY_DELETE_UNSUPPORTED
		);
	});

	it("rethrows a generic adapter error unchanged", async () => {
		const remove = jest.fn().mockRejectedValue(new Error("upstream down"));
		mockListMemoryConnectors.mockResolvedValue([connector]);
		mockGetMemoryRuntime.mockResolvedValue({
			connector,
			adapter: { capabilities: () => capabilities, delete: remove },
		});
		await expect(deleteProjectMemory({ id: "m1" })).rejects.toThrow(
			"upstream down"
		);
	});
});

describe("parseMemoryMetadata", () => {
	it("rejects arrays", () => {
		expect(() => parseMemoryMetadata([])).toThrow(MEMORY_INVALID_METADATA);
	});

	it("returns undefined for nullish input", () => {
		expect(parseMemoryMetadata(undefined)).toBeUndefined();
		expect(parseMemoryMetadata(null)).toBeUndefined();
	});

	it("returns the object when it is within the size limit", () => {
		const metadata = { source: "otter", confidence: 0.9 };
		expect(parseMemoryMetadata(metadata)).toEqual(metadata);
	});

	it("rejects metadata whose JSON encoding exceeds the max size", () => {
		expect(() =>
			parseMemoryMetadata({ blob: "x".repeat(4_001) })
		).toThrow(MEMORY_INVALID_METADATA);
	});
});

describe("parseMemoryMessages", () => {
	it("returns undefined for nullish input", () => {
		expect(parseMemoryMessages(undefined)).toBeUndefined();
		expect(parseMemoryMessages(null)).toBeUndefined();
	});

	it("rejects non-array input", () => {
		expect(() => parseMemoryMessages("not-an-array")).toThrow(
			MEMORY_CONNECTOR_CONTENT_REQUIRED
		);
	});

	it("rejects items that are not plain objects", () => {
		expect(() => parseMemoryMessages([null])).toThrow(
			MEMORY_CONNECTOR_CONTENT_REQUIRED
		);
		expect(() => parseMemoryMessages([["role", "content"]])).toThrow(
			MEMORY_CONNECTOR_CONTENT_REQUIRED
		);
	});

	it("skips entries with neither role nor content", () => {
		expect(
			parseMemoryMessages([
				{ role: "", content: "" },
				{ role: "user", content: "hi" },
			])
		).toEqual([{ role: "user", content: "hi" }]);
	});

	it("rejects entries missing only role or only content", () => {
		expect(() => parseMemoryMessages([{ role: "user", content: "" }])).toThrow(
			MEMORY_CONNECTOR_CONTENT_REQUIRED
		);
		expect(() => parseMemoryMessages([{ role: "", content: "hi" }])).toThrow(
			MEMORY_CONNECTOR_CONTENT_REQUIRED
		);
	});

	it("rejects a role or content that is too long", () => {
		expect(() =>
			parseMemoryMessages([{ role: "x".repeat(65), content: "hi" }])
		).toThrow(MEMORY_CONTENT_TOO_LONG);
		expect(() =>
			parseMemoryMessages([{ role: "user", content: "x".repeat(20_001) }])
		).toThrow(MEMORY_CONTENT_TOO_LONG);
	});

	it("returns undefined when every entry is skipped", () => {
		expect(parseMemoryMessages([{ role: "", content: "" }])).toBeUndefined();
	});
});
