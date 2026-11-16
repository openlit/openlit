const mockFindFirst = jest.fn();
const mockUpdate = jest.fn();

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		connectorInstance: {
			findFirst: (...a: unknown[]) => mockFindFirst(...a),
			update: (...a: unknown[]) => mockUpdate(...a),
		},
	},
}));

import {
	forgeRunsFromMetadata,
	hasRunningForgeRun,
	isScannerForgeRunId,
	prependScannerForgeRun,
	summarizeForgeRun,
} from "@/lib/platform/connectors/scanner/forge-runs";
import type { ScannerForgeRun } from "@/lib/platform/connectors/scanner/types";
import { SCANNER_FORGE_FAILED } from "@/constants/messages/en";

function run(over: Partial<ScannerForgeRun> = {}): ScannerForgeRun {
	return {
		id: "forge:1",
		status: "succeeded",
		target: "https://github.com/acme/agent",
		policies: ["mcp"],
		policySource: { kind: "manual" },
		fileName: "SKILL.md",
		startedAt: new Date().toISOString(),
		content: "# skill",
		...over,
	};
}

function storedMetadata(): Record<string, unknown> {
	return JSON.parse(mockUpdate.mock.calls.at(-1)[0].data.metadata);
}

beforeEach(() => {
	jest.clearAllMocks();
});

describe("forge run metadata", () => {
	it("reads runs and tolerates missing or malformed metadata", () => {
		expect(forgeRunsFromMetadata(JSON.stringify({ forgeRuns: [run()] }))).toHaveLength(1);
		expect(forgeRunsFromMetadata('{"jobs":[]}')).toEqual([]);
		expect(forgeRunsFromMetadata("{bad")).toEqual([]);
		expect(forgeRunsFromMetadata('{"forgeRuns":"nope"}')).toEqual([]);
	});

	it("summaries never carry skill content", () => {
		expect(summarizeForgeRun(run())).not.toHaveProperty("content");
		expect(summarizeForgeRun(run()).id).toBe("forge:1");
	});

	it("summaries report abandoned running runs as failed", () => {
		const now = Date.parse("2026-11-10T12:00:00.000Z");
		const recent = run({ status: "running", startedAt: "2026-11-10T11:59:00.000Z" });
		const abandoned = run({ status: "running", startedAt: "2026-11-10T11:50:00.000Z" });
		expect(summarizeForgeRun(recent, now).status).toBe("running");
		expect(summarizeForgeRun(abandoned, now)).toMatchObject({
			status: "failed",
			error: SCANNER_FORGE_FAILED,
		});
	});

	it("validates run ids", () => {
		expect(isScannerForgeRunId("forge:abc-123")).toBe(true);
		expect(isScannerForgeRunId("job:abc")).toBe(false);
		expect(isScannerForgeRunId("forge:../x")).toBe(false);
	});

	it("treats only recent running runs as running", () => {
		const now = Date.parse("2026-11-10T12:00:00.000Z");
		const recent = run({ status: "running", startedAt: "2026-11-10T11:59:00.000Z" });
		const abandoned = run({ status: "running", startedAt: "2026-11-10T11:50:00.000Z" });
		expect(hasRunningForgeRun(JSON.stringify({ forgeRuns: [recent] }), now)).toBe(true);
		expect(hasRunningForgeRun(JSON.stringify({ forgeRuns: [abandoned] }), now)).toBe(false);
		expect(hasRunningForgeRun("{}", now)).toBe(false);
	});
});

describe("prependScannerForgeRun", () => {
	it("keeps jobs, replaces the running entry, and caps history at 10", async () => {
		const existing = Array.from({ length: 10 }, (_, i) => run({ id: `forge:old${i}` }));
		mockFindFirst.mockResolvedValue({
			metadata: JSON.stringify({
				category: "scanner",
				jobs: [{ id: "job:1" }],
				forgeRuns: [run({ id: "forge:new", status: "running", content: undefined }), ...existing],
			}),
		});
		const next = await prependScannerForgeRun("scanner:1", run({ id: "forge:new" }));
		const stored = storedMetadata();
		expect(stored.jobs).toEqual([{ id: "job:1" }]);
		expect(next).toHaveLength(10);
		expect(next[0]).toMatchObject({ id: "forge:new", status: "succeeded", content: "# skill" });
		expect(next.filter((item) => item.id === "forge:new")).toHaveLength(1);
		expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: "scanner:1" });
	});

	it("drops abandoned running entries once a run finishes", async () => {
		mockFindFirst.mockResolvedValue({
			metadata: JSON.stringify({ forgeRuns: [run({ id: "forge:stuck", status: "running" })] }),
		});
		const next = await prependScannerForgeRun("scanner:1", run({ id: "forge:done" }));
		expect(next.map((item) => item.id)).toEqual(["forge:done"]);
	});

	it("does nothing when the connector is gone", async () => {
		mockFindFirst.mockResolvedValue(null);
		await prependScannerForgeRun("scanner:1", run());
		expect(mockUpdate).not.toHaveBeenCalled();
	});
});
