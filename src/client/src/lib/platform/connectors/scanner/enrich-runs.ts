import { SCANNER_ENRICH_INTERRUPTED } from "@/constants/messages/en";
import { ENRICH_RUN_TIMEOUT_MS } from "./enrich-params";
import { parseJsonObject, updateScannerMetadata } from "./metadata";
import type { ScannerEnrichRun } from "./types";

export const MAX_ENRICH_RUNS = 20;
const MAX_DIFF_CHARS = 200_000;
const MAX_LOG_LINES = 200;

export function enrichRunsFromMetadata(raw: string): ScannerEnrichRun[] {
	const metadata = parseJsonObject(raw);
	return Array.isArray(metadata.enrichRuns) ? (metadata.enrichRuns as ScannerEnrichRun[]) : [];
}

function capRun(run: ScannerEnrichRun): ScannerEnrichRun {
	return {
		...run,
		diff: run.diff?.slice(0, MAX_DIFF_CHARS),
		partialDiff: run.partialDiff?.slice(0, MAX_DIFF_CHARS),
		log: run.log?.slice(-MAX_LOG_LINES),
	};
}

export async function upsertScannerEnrichRun(instanceId: string, run: ScannerEnrichRun): Promise<void> {
	await updateScannerMetadata(instanceId, (metadata) => {
		const runs = Array.isArray(metadata.enrichRuns) ? (metadata.enrichRuns as ScannerEnrichRun[]) : [];
		return {
			...metadata,
			enrichRuns: [capRun(run), ...runs.filter((item) => item.id !== run.id)].slice(0, MAX_ENRICH_RUNS),
		};
	});
}

export async function removeScannerEnrichRun(instanceId: string, runId: string): Promise<void> {
	await updateScannerMetadata(instanceId, (metadata) => {
		const runs = Array.isArray(metadata.enrichRuns) ? (metadata.enrichRuns as ScannerEnrichRun[]) : [];
		return { ...metadata, enrichRuns: runs.filter((item) => item.id !== runId) };
	});
}

/**
 * A run still marked running but owned by no live process (server restart)
 * is reported as interrupted once it is older than the run timeout.
 */
export function settleStaleEnrichRun(
	run: ScannerEnrichRun,
	active: boolean,
	now = Date.now()
): ScannerEnrichRun {
	if (run.status !== "running" || active) return run;
	if (now - Date.parse(run.startedAt) < ENRICH_RUN_TIMEOUT_MS) return run;
	return { ...run, status: "failed", failure: "interrupted", error: SCANNER_ENRICH_INTERRUPTED };
}
