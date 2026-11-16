import {
	FALLBACK_FORGE_POLICIES,
	forgePoliciesFromJob,
	latestAnalyzerJobForRepo,
} from "@/lib/platform/connectors/scanner/forge-policies";
import type { ScannerJob } from "@/lib/platform/connectors/scanner/types";

function job(over: Partial<ScannerJob> = {}): ScannerJob {
	return {
		id: "job:1",
		status: "succeeded",
		target: "https://github.com/anthropics/claude-agent-sdk-demos",
		startedAt: "2026-11-09T10:45:45.000Z",
		...over,
	};
}

describe("forgePoliciesFromJob", () => {
	it("derives policies from SDKs, MCP servers, skills, and finding categories", () => {
		const scanned = job({
			report: { sdks: ["claude_agent_sdk"], mcpCount: 1, skillCount: 6 },
			findings: [
				{ id: "1", ruleId: "CSDK-101", severity: "high", title: "t", category: "claude_sdk" },
				{ id: "2", ruleId: "CSKILL-1", severity: "low", title: "t", category: "claude_skill" },
				{ id: "3", ruleId: "META-003", severity: "info", title: "t" },
			],
		});
		expect(forgePoliciesFromJob(scanned, FALLBACK_FORGE_POLICIES)).toEqual([
			"claude_sdk",
			"mcp",
			"claude_skill",
		]);
	});

	it("maps known SDK aliases to policy ids", () => {
		const scanned = job({ report: { sdks: ["openai_agents", "langgraph", "ag2"] } });
		expect(forgePoliciesFromJob(scanned, FALLBACK_FORGE_POLICIES)).toEqual([
			"openai_sdk",
			"langchain",
			"autogen",
		]);
	});

	it("ignores SDKs and categories the CLI does not accept", () => {
		const scanned = job({
			report: { sdks: ["mystery_sdk", "claude_agent_sdk"] },
			findings: [{ id: "1", ruleId: "X-1", severity: "low", title: "t", category: "secrets" }],
		});
		expect(forgePoliciesFromJob(scanned, ["claude_sdk"])).toEqual(["claude_sdk"]);
	});

	it("returns an empty list without a job", () => {
		expect(forgePoliciesFromJob(undefined, FALLBACK_FORGE_POLICIES)).toEqual([]);
	});
});

describe("latestAnalyzerJobForRepo", () => {
	it("returns the newest succeeded job for the same repository", () => {
		const jobs = [
			job({ id: "job:run", status: "running" }),
			job({ id: "job:fail", status: "failed" }),
			job({ id: "job:other", target: "https://github.com/acme/other" }),
			job({ id: "job:ok" }),
			job({ id: "job:older" }),
		];
		expect(
			latestAnalyzerJobForRepo(jobs, "https://github.com/Anthropics/claude-agent-sdk-demos/tree/main")?.id
		).toBe("job:ok");
	});

	it("returns undefined when no job matches", () => {
		expect(latestAnalyzerJobForRepo([job()], "https://github.com/acme/other")).toBeUndefined();
	});
});
