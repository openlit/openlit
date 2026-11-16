/**
 * Forge run history lives next to scanner jobs in
 * `connector_instances.metadata.forgeRuns`. Only the single-run endpoint
 * returns SKILL.md content; lists carry summaries.
 */

import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { parseJsonObject } from "./jobs";
import type { ScannerForgeRun } from "./types";
import { SCANNER_FORGE_FAILED } from "@/constants/messages/en";

const MAX_FORGE_RUNS = 10;
/** Forge times out after 2 minutes; older running entries are left over from a crash. */
const RUNNING_STALE_MS = 5 * 60 * 1000;

export const SCANNER_FORGE_RUN_ID_PATTERN = /^forge:[A-Za-z0-9_-]+$/;

export function newScannerForgeRunId(): string {
	return `forge:${randomUUID()}`;
}

export function isScannerForgeRunId(value: string): boolean {
	return SCANNER_FORGE_RUN_ID_PATTERN.test(value);
}

export function forgeRunsFromMetadata(raw: string): ScannerForgeRun[] {
	const metadata = parseJsonObject(raw);
	return Array.isArray(metadata.forgeRuns) ? (metadata.forgeRuns as ScannerForgeRun[]) : [];
}

function isAbandoned(run: ScannerForgeRun, now: number): boolean {
	return run.status === "running" && now - Date.parse(run.startedAt) >= RUNNING_STALE_MS;
}

/** List view of a run: no SKILL.md body, and runs left over from a crash read as failed. */
export function summarizeForgeRun(run: ScannerForgeRun, now = Date.now()): ScannerForgeRun {
	const { content: _content, ...summary } = run;
	return isAbandoned(run, now) ? { ...summary, status: "failed", error: SCANNER_FORGE_FAILED } : summary;
}

export function hasRunningForgeRun(raw: string, now = Date.now()): boolean {
	return forgeRunsFromMetadata(raw).some(
		(run) => run.status === "running" && !isAbandoned(run, now)
	);
}

export async function prependScannerForgeRun(
	instanceId: string,
	run: ScannerForgeRun
): Promise<ScannerForgeRun[]> {
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId },
		select: { metadata: true },
	});
	if (!existing) return [];
	const metadata = parseJsonObject(existing.metadata || "{}");
	const current = forgeRunsFromMetadata(existing.metadata || "{}");
	const withoutStale = current.filter((item) => {
		if (item.id === run.id) return false;
		if (run.status !== "running" && item.status === "running") return false;
		return true;
	});
	const next = [run, ...withoutStale].slice(0, MAX_FORGE_RUNS);
	await prisma.connectorInstance.update({
		where: { id: instanceId },
		data: {
			metadata: JSON.stringify({
				...metadata,
				category: "scanner",
				forgeRuns: next,
			}),
		},
	});
	return next;
}
