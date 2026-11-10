import { definePolicyPack } from "./types";

/**
 * EU AI Act — selected articles commonly implicated by runtime telemetry
 * evidence (logging, robustness, oversight, deployer monitoring).
 *
 * This is evidence scaffolding for auditors, not a legal determination.
 * Extend controls here when you need denser Article coverage.
 */
export const euAiActPack = definePolicyPack({
	id: "eu-ai-act",
	framework: "eu_ai_act",
	version: "1.1.0",
	controls: [
		{
			control_id: "Art.9",
			title: "Risk management system",
			finding_categories: [
				"prompt_injection",
				"tool_misuse",
				"agent_loop",
				"span_error",
				"policy",
			],
		},
		{
			control_id: "Art.10",
			title: "Data and data governance",
			finding_categories: ["policy", "coding_agent", "evaluation"],
			rationale:
				"Content-capture and classification findings speak to how training/ops data is handled at runtime.",
		},
		{
			control_id: "Art.12",
			title: "Record-keeping / logging",
			finding_categories: ["coding_agent", "harness", "policy"],
		},
		{
			control_id: "Art.13",
			title: "Transparency and provision of information",
			finding_categories: ["coding_agent", "policy", "generation_health"],
		},
		{
			control_id: "Art.14",
			title: "Human oversight",
			finding_categories: [
				"tool_misuse",
				"agent_loop",
				"policy",
				"coding_agent",
			],
			rationale:
				"Autonomous tool loops and elevated permission modes implicate oversight effectiveness.",
		},
		{
			control_id: "Art.15",
			title: "Accuracy, robustness and cybersecurity",
			finding_categories: [
				"prompt_injection",
				"tool_misuse",
				"generation_health",
				"evaluation",
				"span_error",
			],
		},
		{
			control_id: "Art.26",
			title: "Obligations of deployers of high-risk AI systems",
			finding_categories: [
				"coding_agent",
				"harness",
				"policy",
				"evaluation",
				"generation_health",
			],
			min_severity: "minor",
		},
		{
			control_id: "Art.72",
			title: "Post-market monitoring by providers",
			finding_categories: [
				"generation_health",
				"evaluation",
				"agent_loop",
				"span_error",
			],
		},
	],
});
