import { definePolicyPack } from "./types";

/**
 * NIST AI Risk Management Framework (AI RMF 1.0) — selected Govern / Map /
 * Measure / Manage functions mapped to OpenLIT finding categories.
 *
 * Extend this file to deepen NIST coverage; keep `control_id` stable so
 * exported passports remain comparable over time.
 */
export const nistAiRmfPack = definePolicyPack({
	id: "nist-ai-rmf",
	framework: "nist_ai_rmf",
	version: "1.1.0",
	controls: [
		{
			control_id: "GOVERN-1.1",
			title: "Legal and regulatory requirements are understood",
			finding_categories: ["policy", "coding_agent"],
			rationale:
				"Capture-mode and permission findings show whether deployment policies are enforced in telemetry.",
		},
		{
			control_id: "GOVERN-1.2",
			title: "Accountability and governance roles",
			finding_categories: ["policy", "coding_agent"],
		},
		{
			control_id: "GOVERN-1.3",
			title: "Processes for AI risk management are in place",
			finding_categories: ["policy", "evaluation", "harness"],
		},
		{
			control_id: "GOVERN-1.5",
			title: "Ongoing monitoring and review of AI risks",
			finding_categories: [
				"generation_health",
				"evaluation",
				"agent_loop",
				"span_error",
			],
		},
		{
			control_id: "MAP-1.1",
			title: "Context of AI system use is understood",
			finding_categories: ["coding_agent", "policy", "harness"],
		},
		{
			control_id: "MAP-2.1",
			title: "Risks related to third-party components are understood",
			finding_categories: ["tool_misuse", "harness", "coding_agent"],
		},
		{
			control_id: "MAP-2.3",
			title: "AI system impacts and harms are assessed",
			finding_categories: [
				"prompt_injection",
				"tool_misuse",
				"generation_health",
				"policy",
			],
			min_severity: "minor",
		},
		{
			control_id: "MAP-5.1",
			title: "AI system operational environment is documented",
			finding_categories: ["coding_agent", "harness", "policy"],
		},
		{
			control_id: "MEASURE-1.1",
			title: "Approaches for measuring AI risks are identified",
			finding_categories: ["evaluation", "generation_health", "harness"],
		},
		{
			control_id: "MEASURE-2.3",
			title: "AI system performance is evaluated",
			finding_categories: ["evaluation", "generation_health"],
		},
		{
			control_id: "MEASURE-2.6",
			title: "AI system security and resilience are evaluated",
			finding_categories: [
				"prompt_injection",
				"tool_misuse",
				"span_error",
				"agent_loop",
			],
		},
		{
			control_id: "MEASURE-2.7",
			title: "AI system privacy risks are evaluated",
			finding_categories: ["policy", "coding_agent"],
			rationale:
				"Full content capture and secret-adjacent policy findings indicate privacy measurement gaps.",
		},
		{
			control_id: "MEASURE-2.11",
			title: "Risk tracking measures are applied",
			finding_categories: ["evaluation", "generation_health", "agent_loop"],
		},
		{
			control_id: "MANAGE-1.1",
			title: "AI risks are prioritized and responded to",
			finding_categories: [
				"prompt_injection",
				"tool_misuse",
				"span_error",
				"agent_loop",
				"policy",
			],
			min_severity: "major",
		},
		{
			control_id: "MANAGE-2.2",
			title: "Mechanisms for AI incident response are established",
			finding_categories: ["span_error", "agent_loop", "prompt_injection"],
		},
		{
			control_id: "MANAGE-2.4",
			title: "Risk response for AI incidents",
			finding_categories: [
				"span_error",
				"agent_loop",
				"prompt_injection",
				"tool_misuse",
			],
		},
		{
			control_id: "MANAGE-4.1",
			title: "Post-deployment monitoring plans are implemented",
			finding_categories: [
				"generation_health",
				"evaluation",
				"harness",
				"coding_agent",
			],
		},
	],
});
