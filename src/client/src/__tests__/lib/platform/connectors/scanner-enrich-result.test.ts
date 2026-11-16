import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	compareRecheck,
	diffStats,
	locateRawFinding,
	parseEnrichOutput,
	rawFindingKey,
	redactEnrichText,
	scannerFindingKey,
	singleFindingReport,
} from "@/lib/platform/connectors/scanner/enrich-result";
import type { ScannerFinding } from "@/lib/platform/connectors/scanner/types";

const FIXTURES = join(__dirname, "../../../fixtures/trustabl-enrich");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const scan = JSON.parse(fixture("scan.json")) as Record<string, unknown>;

const finding: ScannerFinding = {
	id: "finding-2",
	ruleId: "CSDK-101",
	severity: "high",
	category: "claude_sdk",
	scope: "agent",
	toolName: "data-analyst",
	path: "agent/agent.py",
	line: 4,
	endLine: 9,
	title: "Claude subagent is granted the Bash tool",
};

function row(ruleId: string, line: number, path = "agent/agent.py") {
	return { rule_id: ruleId, file_path: path, start_line: line, tool_name: "data-analyst", scope: "agent" };
}

describe("finding keys", () => {
	it("match between a normalized finding and its raw row", () => {
		expect(scannerFindingKey(finding)).toBe("CSDK-101|agent/agent.py|data-analyst|agent");
		expect(rawFindingKey(row("CSDK-101", 40))).toBe(scannerFindingKey(finding));
	});
});

describe("locateRawFinding", () => {
	it("finds the row for a finding in a real scan", () => {
		expect(locateRawFinding(scan, finding)).toMatchObject({ rule_id: "CSDK-101", start_line: 4 });
	});

	it("locate picks the nearest line among same-fingerprint findings", () => {
		const report = { findings: [row("CSDK-101", 4), row("CSDK-101", 40), row("CSDK-104", 38)] };
		expect(locateRawFinding(report, { ...finding, line: 38 })).toMatchObject({ start_line: 40 });
	});

	it("returns null when the finding is gone", () => {
		expect(locateRawFinding({ findings: [row("CSDK-104", 4)] }, finding)).toBeNull();
	});
});

describe("singleFindingReport", () => {
	it("keeps report metadata and only the selected finding", () => {
		const target = locateRawFinding(scan, finding)!;
		const report = singleFindingReport(scan, target);
		expect(report.findings).toEqual([target]);
		expect(report.rules_version).toBe(scan.rules_version);
		expect((scan.findings as unknown[]).length).toBeGreaterThan(1);
	});
});

describe("parseEnrichOutput", () => {
	it("reads an applied fix", () => {
		const parsed = parseEnrichOutput(
			fixture("enrich-applied.json"),
			"enriching 1/1 findings (grouped by file)\napplied 1 fix(es) to agent/agent.py\n"
		);
		expect(parsed).toMatchObject({
			enriched: true,
			applied: true,
			explanation: "The data-analyst subagent lists Bash, so any delegated task can run shell commands.",
			fixSummary: "Removed Bash from the data-analyst tools list.",
		});
		expect(parsed.diff).toContain('-        tools=["Glob", "Read", "Bash", "Write"],');
		expect(parsed.providerError).toBeUndefined();
	});

	it("reads a provider error from stderr", () => {
		const stderr =
			'enriching 1/5 findings (grouped by file)\nwarn: llm enrich agent/agent.py: claude api: POST "https://api.anthropic.com/v1/messages": 401 Unauthorized {"error":{"message":"invalid x-api-key sk-ant-api03-abcdefghijklmnop"}}\n';
		const parsed = parseEnrichOutput(fixture("enrich-provider-error.json"), stderr);
		expect(parsed.enriched).toBe(false);
		expect(parsed.applied).toBe(false);
		expect(parsed.providerError).toContain("401 Unauthorized");
		expect(parsed.providerError).not.toContain("sk-ant-api03");
	});

	it("treats unreadable output as not enriched", () => {
		expect(parseEnrichOutput("not json", "")).toEqual({ enriched: false, applied: false });
	});
});

describe("compareRecheck", () => {
	const key = scannerFindingKey(finding);

	it("reports a resolved finding and no new findings", () => {
		const before = { findings: [row("CSDK-101", 4), row("CSDK-104", 4)] };
		const after = { findings: [row("CSDK-104", 4)] };
		expect(compareRecheck(before, after, key)).toEqual({ resolved: true, newFindings: 0 });
	});

	it("counts findings that were not there before, by multiplicity", () => {
		const before = { findings: [row("CSDK-104", 4)] };
		const after = { findings: [row("CSDK-104", 4), row("CSDK-104", 20), row("CSDK-102", 4)] };
		expect(compareRecheck(before, after, key)).toEqual({ resolved: true, newFindings: 2 });
	});

	it("reports a finding that is still detected", () => {
		const before = { findings: [row("CSDK-101", 4)] };
		expect(compareRecheck(before, before, key)).toEqual({ resolved: false, newFindings: 0 });
	});
});

describe("diffStats", () => {
	it("counts changed lines without the file headers", () => {
		const parsed = parseEnrichOutput(fixture("enrich-applied.json"), "");
		expect(diffStats(parsed.diff || "")).toEqual({ additions: 1, deletions: 1 });
	});
});

describe("redactEnrichText", () => {
	it("removes provider keys and GitHub tokens", () => {
		const text = redactEnrichText(
			"a sk-ant-api03-abcdefghijk b sk-proj-abcdefghijklmnopqrst c AIzaSyA1234567890abcdefghij d ghp_abcdefghijklmnopqrstuvwxyz0123"
		);
		expect(text).toBe("a [redacted] b [redacted] c [redacted] d [redacted]");
	});
});
