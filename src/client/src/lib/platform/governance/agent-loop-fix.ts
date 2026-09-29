/**
 * Deterministic remediation helpers for agent-loop findings.
 * Builds paste-ready coding-agent knowledge and Otter prompts (no LLM here).
 */

import {
	GOVERNANCE_AGENT_LOOP_KNOWLEDGE_RULE,
	GOVERNANCE_AGENT_LOOP_OTTER_PROMPT,
	GOVERNANCE_ASK_OTTER_DEFAULT_QUESTION,
} from "@/constants/messages/en";
import type { GovernanceFinding } from "@/types/governance-report";

export type AgentLoopFixContext = {
	tool: string;
	count: number;
	resource: string;
	fingerprint: string;
};

function asText(value: unknown): string {
	if (value === undefined || value === null) return "";
	return String(value).trim();
}

function asCount(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function agentLoopFixContext(
	finding: Pick<GovernanceFinding, "resource" | "evidence">
): AgentLoopFixContext {
	const evidence = finding.evidence || {};
	return {
		tool: asText(evidence.tool_name) || "tool",
		count: asCount(evidence.count),
		resource: asText(finding.resource),
		fingerprint: asText(evidence.args_fingerprint),
	};
}

/** Paste-ready AGENTS.md / .cursor/rules / skill text for this loop. */
export function buildAgentLoopKnowledgeRule(
	finding: Pick<GovernanceFinding, "resource" | "evidence">
): string {
	const ctx = agentLoopFixContext(finding);
	return GOVERNANCE_AGENT_LOOP_KNOWLEDGE_RULE(
		ctx.tool,
		ctx.resource,
		ctx.count || 1
	);
}

/** Wrap an operator question with loop evidence for Ask Otter. */
export function buildAgentLoopOtterPrompt(
	question: string,
	finding: Pick<GovernanceFinding, "resource" | "evidence">
): string {
	const ctx = agentLoopFixContext(finding);
	const text = question.trim() || GOVERNANCE_ASK_OTTER_DEFAULT_QUESTION;
	return GOVERNANCE_AGENT_LOOP_OTTER_PROMPT(
		ctx.tool,
		ctx.count || 1,
		ctx.resource,
		ctx.fingerprint,
		text
	);
}
