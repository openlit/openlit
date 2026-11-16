/**
 * Prefill Trustabl Forge policies from an Analyzer scan of the same repository.
 * Forge cannot read a GitHub URL, so the scan is how OpenLIT learns which SDK
 * policy packs a repository needs without cloning it again.
 */

import { scannerRepoKey } from "./target";
import type { ScannerJob } from "./types";

/** Policy ids accepted by Trustabl 0.1.8, used until the installed CLI reports its own. */
export const FALLBACK_FORGE_POLICIES = [
	"claude_sdk",
	"openai_sdk",
	"openshell",
	"google_adk",
	"mcp",
	"langchain",
	"crewai",
	"pydantic_ai",
	"vercel_ai",
	"autogen",
	"claude_skill",
];

/** Analyzer SDK names that differ from the forge policy id. */
const SDK_POLICY_ALIASES: Record<string, string> = {
	claude_agent_sdk: "claude_sdk",
	openai_agents: "openai_sdk",
	openai_agents_sdk: "openai_sdk",
	adk: "google_adk",
	langgraph: "langchain",
	ai_sdk: "vercel_ai",
	ag2: "autogen",
};

function sdkPolicy(sdk: string): string {
	const name = sdk.trim().toLowerCase();
	return SDK_POLICY_ALIASES[name] || name;
}

export function forgePoliciesFromJob(job: ScannerJob | undefined, accepted: string[]): string[] {
	if (!job) return [];
	const found = new Set<string>();
	for (const sdk of job.report?.sdks || []) found.add(sdkPolicy(sdk));
	if ((job.report?.mcpCount || 0) > 0) found.add("mcp");
	if ((job.report?.skillCount || 0) > 0) found.add("claude_skill");
	for (const finding of job.findings || []) {
		if (finding.category) found.add(finding.category.trim().toLowerCase());
	}
	return accepted.filter((policy) => found.has(policy));
}

/** Newest succeeded Analyzer job for the repository. Jobs are stored newest first. */
export function latestAnalyzerJobForRepo(
	jobs: ScannerJob[],
	target: string
): ScannerJob | undefined {
	const repoKey = scannerRepoKey(target);
	if (!repoKey) return undefined;
	return jobs.find(
		(job) => job.status === "succeeded" && scannerRepoKey(job.target) === repoKey
	);
}
