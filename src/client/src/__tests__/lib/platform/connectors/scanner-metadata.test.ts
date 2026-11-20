const mockRows = new Map<string, { id: string; metadata: string }>();

function pause(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		connectorInstance: {
			// The pauses widen the read-modify-write window so an unserialized
			// writer would overwrite the other one's key.
			findFirst: jest.fn(async ({ where }: { where: { id: string } }) => {
				const row = mockRows.get(where.id);
				await pause(5);
				return row ? { ...row } : null;
			}),
			update: jest.fn(async ({ where, data }: { where: { id: string }; data: { metadata: string } }) => {
				await pause(5);
				const next = { ...(mockRows.get(where.id) as { id: string; metadata: string }), ...data };
				mockRows.set(where.id, next);
				return next;
			}),
		},
	},
}));

import { updateScannerMetadata } from "@/lib/platform/connectors/scanner/metadata";
import { BaseScannerAdapter } from "@/lib/platform/connectors/scanner/base-adapter";
import { UnsupportedScannerCapabilityError } from "@/lib/platform/connectors/scanner/types";

describe("updateScannerMetadata", () => {
	beforeEach(() => {
		mockRows.clear();
		mockRows.set("scanner:1", { id: "scanner:1", metadata: JSON.stringify({ category: "scanner" }) });
	});

	it("serializes concurrent updates so both keys survive", async () => {
		await Promise.all([
			updateScannerMetadata("scanner:1", (metadata) => ({ ...metadata, jobs: [1] })),
			updateScannerMetadata("scanner:1", (metadata) => ({ ...metadata, enrichRuns: [2] })),
		]);
		expect(JSON.parse(mockRows.get("scanner:1")!.metadata)).toEqual({
			category: "scanner",
			jobs: [1],
			enrichRuns: [2],
		});
	});

	it("returns null for a missing connector", async () => {
		await expect(updateScannerMetadata("scanner:missing", (metadata) => metadata)).resolves.toBeNull();
	});

	it("keeps the queue going after an update throws", async () => {
		await expect(
			updateScannerMetadata("scanner:1", () => {
				throw new Error("boom");
			})
		).rejects.toThrow("boom");
		await updateScannerMetadata("scanner:1", (metadata) => ({ ...metadata, ok: true }));
		expect(JSON.parse(mockRows.get("scanner:1")!.metadata).ok).toBe(true);
	});
});

describe("BaseScannerAdapter.enrich", () => {
	class MinimalAdapter extends BaseScannerAdapter {
		readonly type = "minimal";
		capabilities() {
			return { install: false, scan: false, listFindings: false, enrich: false };
		}
		async healthCheck() {
			return { ok: true };
		}
	}

	it("throws an unsupported capability error", async () => {
		const adapter = new MinimalAdapter({ type: "minimal", id: "scanner:1", settings: {}, name: "m" });
		await expect(adapter.enrich({} as never)).rejects.toBeInstanceOf(UnsupportedScannerCapabilityError);
	});
});
