import {
	isScannerJobId,
	pageScannerJobFindings,
	type ScannerFindingPage,
} from "@/lib/platform/connectors/scanner/job-findings";
import type { ScannerJob } from "@/lib/platform/connectors/scanner/types";

function job(findings: ScannerJob["findings"]): Pick<ScannerJob, "findings"> {
	return { findings };
}

describe("pageScannerJobFindings", () => {
	const findings = [
		{ id: "a", ruleId: "MCP-001", severity: "high", title: "Unsafe tool", path: "src/a.py" },
		{ id: "b", ruleId: "CSDK-010", severity: "low", title: "Missing contract", path: "src/b.ts" },
		{ id: "c", ruleId: "MCP-006", severity: "low", title: "Tool raises exceptions", path: "mcp_server.py" },
	];

	it("paginates numbered findings", () => {
		const page = pageScannerJobFindings(job(findings), { page: 2, limit: 2 });
		expect(page.total).toBe(3);
		expect(page.page).toBe(2);
		expect(page.findings.map((item) => item.id)).toEqual(["c"]);
		expect(page.findings[0].alertNumber).toBe(3);
		expect(page.counts).toEqual({ all: 3, critical: 0, high: 1, medium: 0, low: 2 });
	});

	it("filters by query and severity on the server", () => {
		const page = pageScannerJobFindings(job(findings), { q: "tool", severity: "low" });
		expect(page.findings.map((item) => item.id)).toEqual(["c"]);
		expect(page.counts.all).toBe(2);
		expect(page.counts.low).toBe(1);
		expect(page.counts.high).toBe(1);
	});
});

describe("isScannerJobId", () => {
	it("accepts persisted job ids", () => {
		expect(isScannerJobId("job:abee6854-450a-445d-98a9-8ed0076c05b7")).toBe(true);
		expect(isScannerJobId("../job")).toBe(false);
		expect(isScannerJobId("")).toBe(false);
	});
});
