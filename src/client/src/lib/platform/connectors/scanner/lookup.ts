/**
 * Join scanner jobs to a GitHub repository URL.
 *
 * Coding-agent spans stamp `vcs.repository.url.full`. Scanner jobs store the
 * scan target. This module normalizes both onto `github.com/owner/repo` and
 * returns the latest succeeded job for the current project environment.
 */

import { listScannerConnectors } from "./crud";
import { countMediumPlus } from "./report";
import { scannerRepoKey } from "./target";
import type {
	ScannerFinding,
	ScannerJob,
	ScannerRepoFindingsResult,
} from "./types";

export const SCANNER_FINDINGS_LIMIT = 25;

const SEVERITY_RANK: Record<string, number> = {
	critical: 0,
	high: 1,
	error: 1,
	medium: 2,
	low: 3,
	info: 4,
	meta: 5,
};

type ScannerLookupConnector = {
	id: string;
	name: string;
	jobs?: ScannerJob[];
};

export function scannerWorkspaceUrl(
	connectorId?: string,
	jobId?: string
): string {
	const params = new URLSearchParams();
	if (connectorId) params.set("connectorId", connectorId);
	if (jobId) params.set("jobId", jobId);
	const query = params.toString();
	return query ? `/scanner?${query}` : "/scanner";
}

function rankFinding(finding: ScannerFinding): number {
	return SEVERITY_RANK[finding.severity] ?? 9;
}

function prioritizeFindings(
	findings: ScannerFinding[],
	limit: number
): ScannerFinding[] {
	return [...findings]
		.sort((left, right) => rankFinding(left) - rankFinding(right))
		.slice(0, limit);
}

export function matchScannerFindingsForRepo(
	connectors: ScannerLookupConnector[],
	repoUrl: unknown,
	limit: number = SCANNER_FINDINGS_LIMIT
): ScannerRepoFindingsResult {
	const repoKey = scannerRepoKey(repoUrl);
	if (!repoKey) {
		return { matched: false, repoKey: null, url: scannerWorkspaceUrl() };
	}

	let best:
		| {
				connector: ScannerLookupConnector;
				job: ScannerJob;
				scannedAt: string;
		  }
		| undefined;

	for (const connector of connectors) {
		for (const job of connector.jobs || []) {
			if (job.status !== "succeeded") continue;
			if (scannerRepoKey(job.target) !== repoKey) continue;
			const scannedAt = job.finishedAt || job.startedAt;
			if (!scannedAt) continue;
			if (!best || scannedAt > best.scannedAt) {
				best = { connector, job, scannedAt };
			}
		}
	}

	if (!best) {
		return { matched: false, repoKey, url: scannerWorkspaceUrl() };
	}

	const findings = prioritizeFindings(best.job.findings || [], limit);
	const findingCount = best.job.findingCount ?? (best.job.findings || []).length;
	const mediumPlusCount =
		typeof best.job.mediumPlusCount === "number"
			? best.job.mediumPlusCount
			: countMediumPlus(best.job.findings || []);

	return {
		matched: true,
		repoKey,
		connectorId: best.connector.id,
		connectorName: best.connector.name,
		jobId: best.job.id,
		target: best.job.target,
		ref: best.job.ref,
		scannedAt: best.scannedAt,
		findingCount,
		mediumPlusCount,
		findings,
		url: scannerWorkspaceUrl(best.connector.id, best.job.id),
	};
}

export async function lookupLatestScannerFindingsForRepo(input: {
	repoUrl: unknown;
	environment?: string;
	limit?: number;
}): Promise<ScannerRepoFindingsResult> {
	const connectors = await listScannerConnectors(input.environment);
	return matchScannerFindingsForRepo(
		connectors,
		input.repoUrl,
		input.limit ?? SCANNER_FINDINGS_LIMIT
	);
}
