const mockListMemoryConnectors = jest.fn();
const mockRecordMemoryPortLinks = jest.fn();
const mockQueryProjectMemories = jest.fn();
const mockAddProjectMemories = jest.fn();
const mockGetMemoryTypeDescriptor = jest.fn();

jest.mock("@/lib/platform/connectors/memory/crud", () => ({
	listMemoryConnectors: (...a: unknown[]) => mockListMemoryConnectors(...a),
	recordMemoryPortLinks: (...a: unknown[]) => mockRecordMemoryPortLinks(...a),
	memoryConnectorId: (id: string) =>
		String(id).startsWith("memory:") ? id : `memory:${id}`,
}));
jest.mock("@/lib/platform/connectors/memory/read", () => ({
	queryProjectMemories: (...a: unknown[]) => mockQueryProjectMemories(...a),
}));
jest.mock("@/lib/platform/connectors/memory/write", () => ({
	addProjectMemories: (...a: unknown[]) => mockAddProjectMemories(...a),
}));
jest.mock("@/lib/platform/connectors/memory/registry", () => ({
	getMemoryTypeDescriptor: (...a: unknown[]) => mockGetMemoryTypeDescriptor(...a),
}));

import { copyProjectMemories } from "@/lib/platform/connectors/memory/port";
import {
	MEMORY_ADD_UNSUPPORTED,
	MEMORY_COPY_EMPTY,
	MEMORY_COPY_SAME_CONNECTOR,
	MEMORY_COPY_TOO_MANY,
} from "@/constants/messages/en";

const source = { id: "memory:src", name: "Mem0", type: "mem0" };
const target = { id: "memory:dst", name: "Zep", type: "zep" };

describe("copyProjectMemories", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockListMemoryConnectors.mockResolvedValue([source, target]);
		mockGetMemoryTypeDescriptor.mockReturnValue({
			capabilities: { add: true },
		});
		mockRecordMemoryPortLinks.mockResolvedValue(undefined);
	});

	it("rejects copying a connector onto itself", async () => {
		await expect(
			copyProjectMemories({
				sourceConnectorId: "memory:src",
				targetConnectorId: "memory:src",
			})
		).rejects.toThrow(MEMORY_COPY_SAME_CONNECTOR);
	});

	it("rejects destinations that cannot add memories", async () => {
		mockGetMemoryTypeDescriptor.mockReturnValue({
			capabilities: { add: false },
		});
		await expect(
			copyProjectMemories({
				sourceConnectorId: "memory:src",
				targetConnectorId: "memory:dst",
			})
		).rejects.toThrow(MEMORY_ADD_UNSUPPORTED);
	});

	it("rejects a destination whose type is no longer registered", async () => {
		mockGetMemoryTypeDescriptor.mockReturnValue(undefined);
		await expect(
			copyProjectMemories({
				sourceConnectorId: "memory:src",
				targetConnectorId: "memory:dst",
			})
		).rejects.toThrow(MEMORY_ADD_UNSUPPORTED);
	});

	// Note: `!sourceId.startsWith("memory:") || !targetId.startsWith("memory:")`
	// (port.ts lines 77-79) is defensive/unreachable in practice: both the real
	// and mocked `memoryConnectorId` always return a "memory:"-prefixed string,
	// so this guard can never observe an unprefixed id. Left intentionally
	// uncovered rather than forcing an artificial test around it.

	it("copies selected memories with a stored source link", async () => {
		mockQueryProjectMemories.mockResolvedValue({
			memories: [
				{ id: "m1", content: "Prefers tabs", userId: "ada", kind: "profile" },
				{ id: "m2", content: "Skip me", userId: "ada", kind: "summary" },
			],
		});
		mockAddProjectMemories.mockResolvedValue({
			memories: [{ id: "z1", content: "Prefers tabs", userId: "ada", kind: "profile" }],
		});

		const result = await copyProjectMemories({
			sourceConnectorId: "src",
			targetConnectorId: "dst",
			memoryIds: ["m1"],
		});

		expect(result.copied).toBe(1);
		expect(result.failed).toEqual([]);
		expect(result.memories[0].port).toEqual(
			expect.objectContaining({
				sourceConnectorId: "memory:src",
				sourceMemoryId: "m1",
				sourceConnectorName: "Mem0",
				destMemoryId: "z1",
			})
		);
		expect(mockAddProjectMemories).toHaveBeenCalledWith(
			expect.objectContaining({
				connectorId: "memory:dst",
				content: "Prefers tabs",
				userId: "ada",
				metadata: expect.objectContaining({
					openlit: expect.objectContaining({
						port: expect.objectContaining({ sourceMemoryId: "m1" }),
					}),
				}),
			})
		);
		expect(mockRecordMemoryPortLinks).toHaveBeenCalledWith(
			"memory:dst",
			expect.arrayContaining([
				expect.objectContaining({ sourceMemoryId: "m1", destMemoryId: "z1" }),
			])
		);
	});

	it("keeps the original source when copying an already-ported memory", async () => {
		mockListMemoryConnectors.mockResolvedValue([
			source,
			target,
			{ id: "memory:claude", name: "Claude", type: "claude" },
		]);
		mockQueryProjectMemories.mockResolvedValue({
			memories: [
				{
					id: "z1",
					content: "Prefers tabs",
					userId: "ada",
					kind: "profile",
					metadata: {
						openlit: {
							port: {
								sourceConnectorId: "memory:src",
								sourceMemoryId: "m1",
								originConnectorId: "memory:origin",
								originMemoryId: "o1",
							},
						},
					},
				},
			],
		});
		mockAddProjectMemories.mockResolvedValue({
			memories: [{ id: "c1", content: "Prefers tabs", userId: "ada", kind: "profile" }],
		});

		const result = await copyProjectMemories({
			sourceConnectorId: "memory:dst",
			targetConnectorId: "memory:claude",
			memoryIds: ["z1"],
		});

		expect(result.memories[0].port).toEqual(
			expect.objectContaining({
				sourceConnectorId: "memory:dst",
				sourceMemoryId: "z1",
				originConnectorId: "memory:origin",
				originMemoryId: "o1",
				destMemoryId: "c1",
			})
		);
	});

	it("fails when nothing is selected", async () => {
		mockQueryProjectMemories.mockResolvedValue({ memories: [] });
		await expect(
			copyProjectMemories({
				sourceConnectorId: "memory:src",
				targetConnectorId: "memory:dst",
			})
		).rejects.toThrow(MEMORY_COPY_EMPTY);
	});

	it("ignores blank entries in the requested memoryIds list", async () => {
		mockQueryProjectMemories.mockResolvedValue({
			memories: [
				{ id: "m1", content: "Prefers tabs", userId: "ada", kind: "profile" },
				{ id: "m2", content: "Skip me", userId: "ada", kind: "summary" },
			],
		});
		mockAddProjectMemories.mockResolvedValue({
			memories: [{ id: "z1", content: "Prefers tabs", userId: "ada", kind: "profile" }],
		});

		const result = await copyProjectMemories({
			sourceConnectorId: "src",
			targetConnectorId: "dst",
			memoryIds: ["", "  ", "m1"],
		});

		expect(result.copied).toBe(1);
		expect(mockAddProjectMemories).toHaveBeenCalledTimes(1);
	});

	it("rejects when more than the max number of memories would be copied", async () => {
		const memories = Array.from({ length: 51 }, (_, i) => ({
			id: `m${i}`,
			content: `content ${i}`,
			userId: "ada",
			kind: "profile",
		}));
		mockQueryProjectMemories.mockResolvedValue({ memories });
		await expect(
			copyProjectMemories({
				sourceConnectorId: "memory:src",
				targetConnectorId: "memory:dst",
			})
		).rejects.toThrow(MEMORY_COPY_TOO_MANY);
	});

	it("treats a source-only port link (no origin recorded yet) as the origin on re-copy", async () => {
		mockQueryProjectMemories.mockResolvedValue({
			memories: [
				{
					id: "z1",
					content: "Prefers tabs",
					userId: "ada",
					kind: "profile",
					metadata: {
						openlit: {
							port: {
								sourceConnectorId: "memory:src",
								sourceMemoryId: "m1",
							},
						},
					},
				},
			],
		});
		mockAddProjectMemories.mockResolvedValue({
			memories: [{ id: "c1", content: "Prefers tabs", userId: "ada", kind: "profile" }],
		});

		const result = await copyProjectMemories({
			sourceConnectorId: "memory:dst",
			targetConnectorId: "memory:src",
			memoryIds: ["z1"],
		});

		expect(result.memories[0].port).toEqual(
			expect.objectContaining({
				originConnectorId: "memory:src",
				originMemoryId: "m1",
			})
		);
	});

	it("records per-memory failures, including from a non-Error rejection", async () => {
		mockQueryProjectMemories.mockResolvedValue({
			memories: [
				{ id: "m1", content: "First", userId: "ada", kind: "profile" },
				{ id: "m2", content: "Second", userId: "ada", kind: "profile" },
			],
		});
		mockAddProjectMemories
			.mockRejectedValueOnce(new Error("boom"))
			.mockRejectedValueOnce("plain string failure");

		const result = await copyProjectMemories({
			sourceConnectorId: "memory:src",
			targetConnectorId: "memory:dst",
		});

		expect(result.copied).toBe(0);
		expect(result.failed).toEqual([
			{ id: "m1", message: "boom" },
			{ id: "m2", message: "plain string failure" },
		]);
		expect(mockRecordMemoryPortLinks).not.toHaveBeenCalled();
	});

	it("records a failure when the destination adapter reports no created memory", async () => {
		mockQueryProjectMemories.mockResolvedValue({
			memories: [{ id: "m1", content: "First", userId: "ada", kind: "profile" }],
		});
		mockAddProjectMemories.mockResolvedValue({ memories: [] });

		const result = await copyProjectMemories({
			sourceConnectorId: "memory:src",
			targetConnectorId: "memory:dst",
		});

		expect(result.copied).toBe(0);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].id).toBe("m1");
	});
});
