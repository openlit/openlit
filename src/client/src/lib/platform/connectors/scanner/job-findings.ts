import type { ScannerFinding, ScannerJob } from "./types";

export const SCANNER_FINDINGS_PAGE_SIZE = 25;
export const SCANNER_FINDINGS_MAX_PAGE_SIZE = 100;
export const SCANNER_FINDINGS_QUERY_MAX = 200;

export const SCANNER_JOB_ID_PATTERN = /^job:[A-Za-z0-9_-]+$/;

export type ScannerFindingSeverityFilter = "all" | "critical" | "high" | "medium" | "low";

export type ScannerFindingCounts = {
	all: number;
	critical: number;
	high: number;
	medium: number;
	low: number;
};

export type ScannerFindingPageItem = ScannerFinding & { alertNumber: number };

export type ScannerFindingPage = {
	findings: ScannerFindingPageItem[];
	total: number;
	page: number;
	pageSize: number;
	counts: ScannerFindingCounts;
};

const SEVERITIES = new Set<ScannerFindingSeverityFilter>([
	"all",
	"critical",
	"high",
	"medium",
	"low",
]);

export function isScannerJobId(value: string): boolean {
	return SCANNER_JOB_ID_PATTERN.test(value);
}

export function parseScannerFindingSeverity(value: unknown): ScannerFindingSeverityFilter {
	const severity = String(value || "all").trim().toLowerCase();
	return SEVERITIES.has(severity as ScannerFindingSeverityFilter)
		? (severity as ScannerFindingSeverityFilter)
		: "all";
}

export function scannerFindingMatchesQuery(finding: ScannerFinding, query: string): boolean {
	if (!query) return true;
	const haystack = [
		finding.title,
		finding.ruleId,
		finding.path,
		finding.scope,
		finding.category,
		finding.message,
		finding.toolName,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return haystack.includes(query);
}

function countFindings(findings: ScannerFinding[]): ScannerFindingCounts {
	const counts: ScannerFindingCounts = { all: findings.length, critical: 0, high: 0, medium: 0, low: 0 };
	for (const finding of findings) {
		if (finding.severity === "critical") counts.critical += 1;
		else if (finding.severity === "high") counts.high += 1;
		else if (finding.severity === "medium") counts.medium += 1;
		else counts.low += 1;
	}
	return counts;
}

export function pageScannerJobFindings(
	job: Pick<ScannerJob, "findings">,
	input: { q?: unknown; severity?: unknown; page?: unknown; limit?: unknown } = {}
): ScannerFindingPage {
	const query = String(input.q || "")
		.trim()
		.slice(0, SCANNER_FINDINGS_QUERY_MAX)
		.toLowerCase();
	const severity = parseScannerFindingSeverity(input.severity);
	const pageSize = Math.min(
		SCANNER_FINDINGS_MAX_PAGE_SIZE,
		Math.max(1, Number(input.limit) || SCANNER_FINDINGS_PAGE_SIZE)
	);
	const numbered: ScannerFindingPageItem[] = (job.findings || []).map((finding, index) => ({
		...finding,
		alertNumber: index + 1,
	}));
	const queried = numbered.filter((finding) => scannerFindingMatchesQuery(finding, query));
	const counts = countFindings(queried);
	const filtered =
		severity === "all" ? queried : queried.filter((finding) => finding.severity === severity);
	const total = filtered.length;
	const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
	const page = Math.min(Math.max(1, Number(input.page) || 1), totalPages);
	const start = (page - 1) * pageSize;
	return {
		findings: filtered.slice(start, start + pageSize),
		total,
		page,
		pageSize,
		counts,
	};
}
