import { definePolicyPack } from "./types";

/**
 * OWASP Top 10 for Agentic Applications (ASI) — mapped to OpenLIT
 * security / coding-agent finding categories.
 *
 * Add new ASI controls (or refine categories) in this file only; the
 * registry in `index.ts` already loads this pack.
 */
export const owaspAsiPack = definePolicyPack({
	id: "owasp-asi",
	framework: "owasp_asi",
	version: "1.1.0",
	controls: [
		{
			control_id: "ASI01",
			title: "Agent goal hijack / prompt injection",
			finding_categories: ["prompt_injection"],
		},
		{
			control_id: "ASI02",
			title: "Tool misuse and excessive agency",
			finding_categories: ["tool_misuse", "agent_loop", "harness"],
		},
		{
			control_id: "ASI03",
			title: "Identity and privilege abuse",
			finding_categories: ["policy", "coding_agent", "tool_misuse"],
			rationale:
				"Elevated permission modes and policy bypass signals map to privilege abuse.",
		},
		{
			control_id: "ASI04",
			title: "Supply chain and untrusted tools",
			finding_categories: ["tool_misuse", "harness", "coding_agent"],
		},
		{
			control_id: "ASI05",
			title: "Unexpected code execution / secrets exposure",
			finding_categories: ["coding_agent", "policy", "tool_misuse"],
		},
		{
			control_id: "ASI06",
			title: "Memory and context poisoning",
			finding_categories: [
				"prompt_injection",
				"generation_health",
				"evaluation",
			],
		},
		{
			control_id: "ASI07",
			title: "Insecure inter-agent communication",
			finding_categories: ["agent_loop", "harness", "tool_misuse"],
		},
		{
			control_id: "ASI08",
			title: "Cascading failures and unbounded agency",
			finding_categories: [
				"agent_loop",
				"span_error",
				"harness",
				"tool_misuse",
			],
			min_severity: "minor",
		},
		{
			control_id: "ASI09",
			title: "Human-agent trust exploitation",
			finding_categories: [
				"generation_health",
				"evaluation",
				"prompt_injection",
				"policy",
			],
		},
		{
			control_id: "ASI10",
			title: "Rogue agents and lack of oversight",
			finding_categories: [
				"agent_loop",
				"tool_misuse",
				"coding_agent",
				"policy",
			],
			min_severity: "major",
		},
	],
});
