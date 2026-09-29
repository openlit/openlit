/**
 * Group scanner jobs by GitHub repository so the workspace can switch
 * repo URL and per-repo scan runs independently.
 */

import { scannerRepoKey } from "./target";
import type { ScannerJob } from "./types";

export type ScannerRepoGroup = {
	repoKey: string;
	label: string;
	target: string;
	jobs: ScannerJob[];
};

export function scannerRepoDisplayLabel(repoKey: string): string {
	return repoKey.replace(/^github\.com\//i, "");
}

export function scannerJobRepoKey(job: Pick<ScannerJob, "target">): string {
	return scannerRepoKey(job.target) || job.target;
}

export function groupScannerJobsByRepo(
	jobs: ScannerJob[],
	defaultTarget?: string
): ScannerRepoGroup[] {
	const groups = new Map<string, ScannerRepoGroup>();

	const ensure = (target: string): ScannerRepoGroup | undefined => {
		const repoKey = scannerRepoKey(target) || target.trim();
		if (!repoKey) return undefined;
		const existing = groups.get(repoKey);
		if (existing) return existing;
		const created: ScannerRepoGroup = {
			repoKey,
			label: scannerRepoDisplayLabel(repoKey),
			target,
			jobs: [],
		};
		groups.set(repoKey, created);
		return created;
	};

	for (const job of jobs) {
		const group = ensure(job.target);
		if (group) group.jobs.push(job);
	}

	if (defaultTarget?.trim()) {
		ensure(defaultTarget);
	}

	return Array.from(groups.values());
}
