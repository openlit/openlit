import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	applyEnrichReplacement,
	compareRecheck,
	diffStats,
	locateRawFinding,
	parseEnrichOutput,
	rawFindingKey,
	redactEnrichText,
	scannerFindingKey,
	singleFindingReport,
	unifiedLineDiff,
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

describe("parseEnrichOutput replacement fields", () => {
	it("reads the proposed range and replacement when the CLI did not apply", () => {
		const replacement = '        tools=["Glob", "Read", "Write"],';
		const stdout = JSON.stringify({
			findings: [
				{
					rule_id: "CSDK-101",
					enriched: true,
					line_start: 6,
					line_end: 6,
					replacement,
					false_positive: true,
				},
			],
		});
		expect(parseEnrichOutput(stdout, "")).toMatchObject({
			enriched: true,
			applied: false,
			lineStart: 6,
			lineEnd: 6,
			replacement,
			falsePositive: true,
		});
	});
});

describe("applyEnrichReplacement", () => {
	it("replaces one line", () => {
		expect(applyEnrichReplacement("a\nb\nc\n", 2, 2, "B")).toBe("a\nB\nc\n");
	});

	it("keeps a trailing blank line the model left out of its replacement", () => {
		const content = "---\nname: pdf\ndescription: x\nlicense: y\n---\n\n# PDF\n";
		const replacement = "---\nname: pdf\ndescription: x z\nlicense: y\n---";
		expect(applyEnrichReplacement(content, 1, 6, replacement)).toBe(
			"---\nname: pdf\ndescription: x z\nlicense: y\n---\n\n# PDF\n"
		);
	});

	it("strips a trailing newline in the replacement", () => {
		expect(applyEnrichReplacement("a\nb\nc", 2, 2, "B\n")).toBe("a\nB\nc");
	});

	it("keeps CRLF line endings", () => {
		expect(applyEnrichReplacement("a\r\nb\r\nc\r\n", 2, 2, "B")).toBe("a\r\nB\r\nc\r\n");
	});

	it("keeps the final newline", () => {
		expect(applyEnrichReplacement("a\nb\n", 2, 2, "B")).toBe("a\nB\n");
	});

	it("returns null for an unusable range, an empty replacement or no change", () => {
		const content = "a\nb\nc\n";
		expect(applyEnrichReplacement(content, 0, 1, "x")).toBeNull();
		expect(applyEnrichReplacement(content, 3, 2, "x")).toBeNull();
		expect(applyEnrichReplacement(content, 1, 99, "x")).toBeNull();
		expect(applyEnrichReplacement(content, 1, 1, "\n")).toBeNull();
		expect(applyEnrichReplacement(content, 2, 2, "b")).toBeNull();
	});
});

describe("unifiedLineDiff", () => {
	it("trims unchanged lines to three lines of context", () => {
		const before = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
		const after = "1\n2\n3\n4\nX\n6\n7\n8\n9\n";
		expect(unifiedLineDiff("f.py", before, after)).toBe(
			"--- a/f.py\n+++ b/f.py\n@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+X\n 6\n 7\n 8\n"
		);
	});

	it("is empty when nothing changed", () => {
		expect(unifiedLineDiff("f.py", "a\n", "a\n")).toBe("");
	});
});
