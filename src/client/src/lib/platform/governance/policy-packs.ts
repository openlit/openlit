import type {
	GovernanceFinding,
	GovernanceFindingCategory,
	GovernancePolicyControl,
	GovernancePolicyFramework,
} from "@/types/governance-report";

type PolicyPackEntry = {
	framework: GovernancePolicyFramework;
	control_id: string;
	title: string;
	finding_categories: GovernanceFindingCategory[];
};

/**
 * Lightweight mapping from OpenLIT finding categories to common control IDs.
 * This is evidence scaffolding for auditors — not a full compliance product.
 */
export const GOVERNANCE_POLICY_PACK: PolicyPackEntry[] = [
	{
		framework: "nist_ai_rmf",
		control_id: "MAP-1.1",
		title: "Context of AI system use is understood",
		finding_categories: ["coding_agent", "policy", "harness"],
	},
	{
		framework: "nist_ai_rmf",
		control_id: "MEASURE-2.3",
		title: "AI system performance is evaluated",
		finding_categories: ["evaluation", "generation_health"],
	},
	{
		framework: "nist_ai_rmf",
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
		framework: "nist_ai_rmf",
		control_id: "GOVERN-1.2",
		title: "Accountability and governance roles",
		finding_categories: ["policy", "coding_agent"],
	},
	{
		framework: "eu_ai_act",
		control_id: "Art.9",
		title: "Risk management system",
		finding_categories: [
			"prompt_injection",
			"tool_misuse",
			"agent_loop",
			"span_error",
		],
	},
	{
		framework: "eu_ai_act",
		control_id: "Art.15",
		title: "Accuracy, robustness and cybersecurity",
		finding_categories: [
			"prompt_injection",
			"tool_misuse",
			"generation_health",
			"evaluation",
		],
	},
	{
		framework: "eu_ai_act",
		control_id: "Art.12",
		title: "Record-keeping / logging",
		finding_categories: ["coding_agent", "harness", "policy"],
	},
	{
		framework: "owasp_asi",
		control_id: "ASI01",
		title: "Agent goal hijack / prompt injection",
		finding_categories: ["prompt_injection"],
	},
	{
		framework: "owasp_asi",
		control_id: "ASI02",
		title: "Tool misuse and excessive agency",
		finding_categories: ["tool_misuse", "agent_loop", "harness"],
	},
	{
		framework: "owasp_asi",
		control_id: "ASI05",
		title: "Unexpected code execution / secrets exposure",
		finding_categories: ["coding_agent", "policy"],
	},
];

export function policyControlsForFindings(
	findings: GovernanceFinding[]
): GovernancePolicyControl[] {
	const present = new Set(findings.map((f) => f.category));
	const matched: GovernancePolicyControl[] = [];
	for (const entry of GOVERNANCE_POLICY_PACK) {
		const hitCategories = entry.finding_categories.filter((c) =>
			present.has(c)
		);
		if (!hitCategories.length) continue;
		matched.push({
			framework: entry.framework,
			control_id: entry.control_id,
			title: entry.title,
			finding_categories: hitCategories,
		});
	}
	return matched;
}
