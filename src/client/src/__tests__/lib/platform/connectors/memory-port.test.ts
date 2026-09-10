import {
	attachMemoryPorts,
	memoryContentFingerprint,
	memoryPortMetadata,
	parseMemoryPortLink,
} from "@/lib/platform/connectors/memory/port-link";
import type { MemoryRecord } from "@/lib/platform/connectors/memory/types";

describe("memory port links", () => {
	it("parses and reattaches provenance metadata", () => {
		const link = {
			sourceConnectorId: "memory:src",
			sourceConnectorName: "Prod Mem0",
			sourceMemoryId: "mem-1",
			copiedAt: "2026-08-18T12:00:00.000Z",
			contentFingerprint: memoryContentFingerprint("Lives in Berlin", "ada"),
		};
		const metadata = memoryPortMetadata(link, { topic: "profile" });
		expect(parseMemoryPortLink(metadata)).toEqual(
			expect.objectContaining({
				sourceConnectorId: "memory:src",
				sourceMemoryId: "mem-1",
				sourceConnectorName: "Prod Mem0",
			})
		);
		expect(metadata).toEqual(
			expect.objectContaining({ topic: "profile" })
		);
	});

	it("returns nothing when provenance metadata is missing", () => {
		expect(parseMemoryPortLink(undefined)).toBeUndefined();
		expect(parseMemoryPortLink(null)).toBeUndefined();
		expect(parseMemoryPortLink({ memory_type: "temporal" })).toBeUndefined();
	});

	it("defaults copiedAt and contentFingerprint to empty strings when absent", () => {
		const link = parseMemoryPortLink({
			openlit: {
				port: {
					sourceConnectorId: "memory:src",
					sourceMemoryId: "mem-1",
					sourceConnectorType: "  ",
				},
			},
		});
		expect(link).toEqual(
			expect.objectContaining({
				sourceConnectorId: "memory:src",
				sourceMemoryId: "mem-1",
				sourceConnectorType: undefined,
				copiedAt: "",
				contentFingerprint: "",
			})
		);
	});

	it("hashes content without a userId", () => {
		const withUser = memoryContentFingerprint("Prefers dark mode", "ada");
		const withoutUser = memoryContentFingerprint("Prefers dark mode");
		expect(withoutUser).toEqual(expect.any(String));
		expect(withoutUser).not.toBe(withUser);
	});

	it("builds port metadata without merging into any existing metadata", () => {
		const link = {
			sourceConnectorId: "memory:src",
			sourceMemoryId: "mem-1",
			copiedAt: "2026-08-18T12:00:00.000Z",
			contentFingerprint: "abc123",
		};
		const metadata = memoryPortMetadata(link);
		expect(metadata).toEqual(
			expect.objectContaining({
				openlit: expect.objectContaining({
					port: expect.objectContaining({ sourceMemoryId: "mem-1" }),
				}),
			})
		);
	});

	it("matches stored links by destination id or content fingerprint", () => {
		const fingerprint = memoryContentFingerprint("Prefers tabs", "ada");
		const attached = attachMemoryPorts<MemoryRecord>(
			[
				{ id: "dest-1", content: "Prefers tabs", userId: "ada" },
				{ id: "other", content: "Unrelated", userId: "ada" },
			],
			[
				{
					sourceConnectorId: "memory:src",
					sourceMemoryId: "mem-1",
					sourceConnectorName: "Mem0",
					copiedAt: "2026-08-18T12:00:00.000Z",
					contentFingerprint: fingerprint,
					destMemoryId: "dest-1",
				},
			]
		);
		expect(attached[0].port?.sourceMemoryId).toBe("mem-1");
		expect(attached[1].port).toBeUndefined();
	});
});
