const mockRows = new Map<string, { id: string; metadata: string }>();

function pause(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		connectorInstance: {
			findFirst: jest.fn(async ({ where }: { where: { id: string } }) => {
				const row = mockRows.get(where.id);
				await pause(3);
				return row ? { ...row } : null;
			}),
			update: jest.fn(async ({ where, data }: { where: { id: string }; data: { metadata: string } }) => {
				await pause(3);
				const next = { ...(mockRows.get(where.id) as { id: string; metadata: string }), ...data };
				mockRows.set(where.id, next);
				return next;
			}),
		},
	},
}));

import {
	enrichRunsFromMetadata,
	MAX_ENRICH_RUNS,
	removeScannerEnrichRun,
	settleStaleEnrichRun,
	upsertScannerEnrichRun,
} from "@/lib/platform/connectors/scanner/enrich-runs";
import { ENRICH_RUN_TIMEOUT_MS } from "@/lib/platform/connectors/scanner/enrich-params";
import { jobsFromMetadata, prependScannerJob } from "@/lib/platform/connectors/scanner/jobs";
import type { ScannerEnrichRun } from "@/lib/platform/connectors/scanner/types";
import { SCANNER_ENRICH_INTERRUPTED } from "@/constants/messages/en";

const ID = "scanner:1";

function makeRun(id: string, overrides: Partial<ScannerEnrichRun> = {}): ScannerEnrichRun {
	return {
		id,
		status: "running",
		jobId: "job:1",
		alertNumber: 4,
		findingKey: "CSDK-101|a.py|tool|agent",
		ruleId: "CSDK-101",
		target: "https://github.com/acme/agents",
		provider: "anthropic",
		attempts: 1,
		attempt: 0,
		recheck: true,
		steps: [],
		startedAt: new Date().toISOString(),
		...overrides,
	};
}

const stored = () => enrichRunsFromMetadata(mockRows.get(ID)!.metadata);

beforeEach(() => {
	mockRows.clear();
	mockRows.set(ID, { id: ID, metadata: JSON.stringify({ category: "scanner", jobs: [] }) });
});

describe("enrich run persistence", () => {
	it("stores runs newest first and replaces a run by id", async () => {
		await upsertScannerEnrichRun(ID, makeRun("enrich:a"));
		await upsertScannerEnrichRun(ID, makeRun("enrich:b"));
		await upsertScannerEnrichRun(ID, makeRun("enrich:a", { status: "succeeded" }));
		expect(stored().map((run) => [run.id, run.status])).toEqual([
			["enrich:a", "succeeded"],
			["enrich:b", "running"],
		]);
	});

	it("keeps the last runs only and caps diffs and logs", async () => {
		for (let index = 0; index < MAX_ENRICH_RUNS + 3; index += 1) {
			await upsertScannerEnrichRun(ID, makeRun(`enrich:${index}`));
		}
		await upsertScannerEnrichRun(
			ID,
			makeRun("enrich:big", {
				diff: "x".repeat(300_000),
				partialDiff: "y".repeat(300_000),
				log: Array.from({ length: 300 }, (_, index) => `line ${index}`),
			})
		);
		const runs = stored();
		expect(runs).toHaveLength(MAX_ENRICH_RUNS);
		expect(runs[0].diff).toHaveLength(200_000);
		expect(runs[0].partialDiff).toHaveLength(200_000);
		expect(runs[0].log).toHaveLength(200);
		expect(runs[0].log?.[199]).toBe("line 299");
	});

	it("removes a run", async () => {
		await upsertScannerEnrichRun(ID, makeRun("enrich:a"));
		await removeScannerEnrichRun(ID, "enrich:a");
		expect(stored()).toEqual([]);
	});

	it("concurrent scan job and enrich run updates both survive", async () => {
		await Promise.all([
			prependScannerJob(ID, { id: "job:2", status: "succeeded", target: "t", startedAt: "now" }),
			upsertScannerEnrichRun(ID, makeRun("enrich:a")),
		]);
		const metadata = mockRows.get(ID)!.metadata;
		expect(jobsFromMetadata(metadata).map((job) => job.id)).toEqual(["job:2"]);
		expect(enrichRunsFromMetadata(metadata).map((run) => run.id)).toEqual(["enrich:a"]);
	});
});

describe("settleStaleEnrichRun", () => {
	const old = new Date(Date.now() - ENRICH_RUN_TIMEOUT_MS - 60_000).toISOString();

	it("stale running run is reported as interrupted", () => {
		expect(settleStaleEnrichRun(makeRun("enrich:a", { startedAt: old }), false)).toMatchObject({
			status: "failed",
			failure: "interrupted",
			error: SCANNER_ENRICH_INTERRUPTED,
		});
	});

	it("leaves active, recent, and finished runs alone", () => {
		const active = makeRun("enrich:a", { startedAt: old });
		expect(settleStaleEnrichRun(active, true)).toBe(active);
		const recent = makeRun("enrich:b");
		expect(settleStaleEnrichRun(recent, false)).toBe(recent);
		const done = makeRun("enrich:c", { status: "succeeded", startedAt: old });
		expect(settleStaleEnrichRun(done, false)).toBe(done);
	});
});
