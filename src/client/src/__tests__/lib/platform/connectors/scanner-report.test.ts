import { formatScannerError, parseScannerReport } from "@/lib/platform/connectors/scanner/report";
import { SCANNER_REPO_NOT_FOUND } from "@/constants/messages/en";

describe("scanner report parsing", () => {
	it("normalizes Trustabl-style findings JSON", () => {
		const parsed = parseScannerReport(
			JSON.stringify({
				findings: [
					{
						rule_id: "CSDK-010",
						severity: "medium",
						category: "claude_sdk",
						path: "src/agent/tools.ts",
						title: "Tool scope wider than declared",
						explanation: "The tool can write files outside the declared workspace.",
						suggested_fix: "Narrow the tool's path prefix.",
						confidence: "0.91",
					},
				],
			})
		);
		expect(parsed.findings).toHaveLength(1);
		expect(parsed.mediumPlusCount).toBe(1);
		expect(parsed.findings[0]).toEqual(
			expect.objectContaining({
				ruleId: "CSDK-010",
				severity: "medium",
				path: "src/agent/tools.ts",
				message: "The tool can write files outside the declared workspace.",
				fix: "Narrow the tool's path prefix.",
				confidence: "0.91",
			})
		);
	});

	it("captures ScanResult inventory and uses Trustabl file_path fields", () => {
		const parsed = parseScannerReport(
			JSON.stringify({
				scan_id: "scan-1",
				repo: "checkout-agent",
				overall_score: 0.64,
				languages: ["python", "typescript"],
				sdks: ["claude_agent_sdk"],
				tools: [{ name: "search" }, { name: "write" }],
				agents: [{ name: "triage" }],
				mcp_servers: [],
				skills: [{}],
				subagents: [],
				rules_source: "https://github.com/trustabl/trustabl-rules",
				rules_version: "abcdef1",
				rules_from_cache: true,
				rules_origin: { signed: true, channel: "production" },
				coverage: { files_parsed: 12, files_skipped: 1 },
				findings: [
					{
						rule_id: "CSDK-010",
						severity: "high",
						scope: "tool",
						tool_name: "write",
						file_path: "src/agent/tools.ts",
						start_line: 40,
						end_line: 48,
						title: "Tool scope wider than declared",
						explanation: "Writes outside the workspace.",
						suggested_fix: "Narrow the prefix.",
						confidence: 0.91,
					},
				],
			})
		);
		expect(parsed.report).toEqual(
			expect.objectContaining({
				scanId: "scan-1",
				overallScore: 0.64,
				toolCount: 2,
				agentCount: 1,
				skillCount: 1,
				filesParsed: 12,
				filesSkipped: 1,
				rulesOrigin: "signed:production",
			})
		);
		expect(parsed.findings[0]).toEqual(
			expect.objectContaining({
				path: "src/agent/tools.ts",
				line: 40,
				endLine: 48,
				scope: "tool",
				toolName: "write",
				confidence: "0.91",
			})
		);
	});

	it("returns no findings for empty or invalid stdout", () => {
		expect(parseScannerReport("").findings).toEqual([]);
		expect(parseScannerReport("not json").findings).toEqual([]);
	});

	it("maps clone 404s to a repository-not-found message", () => {
		expect(
			formatScannerError(
				"Error: ingest: clone https://github.com/openlit/openplait/tree/main: repository not found"
			)
		).toBe(SCANNER_REPO_NOT_FOUND);
	});
});
