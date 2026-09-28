import prisma from "@/lib/prisma";
import type { ScannerJob } from "./types";
import { summarizeJob } from "./report";

const MAX_JOBS = 20;

export function parseJsonObject(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw || "{}");
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* keep empty */
	}
	return {};
}

export function jobsFromMetadata(raw: string): ScannerJob[] {
	const metadata = parseJsonObject(raw);
	return Array.isArray(metadata.jobs) ? (metadata.jobs as ScannerJob[]) : [];
}

export function hasRunningScannerJob(raw: string): boolean {
	return jobsFromMetadata(raw).some((job) => job.status === "running");
}

export async function recordScannerJobs(
	instanceId: string,
	jobs: ScannerJob[]
): Promise<void> {
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId },
		select: { metadata: true },
	});
	if (!existing) return;
	const metadata = parseJsonObject(existing.metadata || "{}");
	await prisma.connectorInstance.update({
		where: { id: instanceId },
		data: {
			metadata: JSON.stringify({
				...metadata,
				category: "scanner",
				jobs: jobs.map(summarizeJob).slice(0, MAX_JOBS),
			}),
		},
	});
}

export async function prependScannerJob(
	instanceId: string,
	job: ScannerJob
): Promise<ScannerJob[]> {
	const existing = await prisma.connectorInstance.findFirst({
		where: { id: instanceId },
		select: { metadata: true },
	});
	const current = existing ? jobsFromMetadata(existing.metadata || "{}") : [];
	const withoutStale = current.filter((item) => {
		if (item.id === job.id) return false;
		if (job.status !== "running" && item.status === "running") return false;
		return true;
	});
	const next = [summarizeJob(job), ...withoutStale].slice(0, MAX_JOBS);
	await recordScannerJobs(instanceId, next);
	return next;
}
