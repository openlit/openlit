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
});
