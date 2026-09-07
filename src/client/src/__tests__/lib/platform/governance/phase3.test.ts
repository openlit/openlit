import {
	computeGovernanceReportId,
	buildGovernancePassport,
	GOVERNANCE_REPORT_ID_ATTR,
} from "@/lib/platform/governance/passport";
import { policyControlsForFindings } from "@/lib/platform/governance/policy-packs";
import type { GovernanceFinding } from "@/types/governance-report";

describe("governance passport", () => {
	it("computes a stable report id", () => {
		const base = {
			trace_id: "t1",
			root_span_id: "s1",
			risk_level: "major" as const,
			finding_count: 2,
			rule_match_count: 1,
			summary: "two findings",
		};
		expect(computeGovernanceReportId(base)).toBe(
			computeGovernanceReportId(base)
		);
		expect(computeGovernanceReportId(base)).toHaveLength(24);
	});

	it("builds a passport envelope", () => {
		const passport = buildGovernancePassport({
			trace_id: "t1",
			root_span_id: "s1",
			risk_level: "critical",
			summary: "critical",
			harness: {
				span_count: 1,
				max_depth: 1,
				llm_call_count: 0,
				tool_call_count: 0,
				retrieval_call_count: 0,
				embedding_call_count: 0,
				database_call_count: 0,
				http_call_count: 0,
				error_count: 0,
				total_cost_usd: 0,
				total_tokens: 0,
				total_duration_ms: 0,
				models_used: [],
				tools_used: [],
			},
			rules: [],
			security: [],
			evaluations: [],
			finding_count: 0,
			rule_match_count: 0,
		});
		expect(passport.attribute_key).toBe(GOVERNANCE_REPORT_ID_ATTR);
		expect(passport.report_id).toBeTruthy();
		expect(passport.report.report_id).toBe(passport.report_id);
		expect(passport.schema_version).toBe("1.0.0");
	});
});

describe("governance policy packs", () => {
	it("maps prompt injection to OWASP and EU controls", () => {
		const findings: GovernanceFinding[] = [
			{
				id: "1",
				category: "prompt_injection",
				severity: "critical",
				summary: "injection",
				detail: "detail",
				span_refs: ["s1"],
			},
		];
		const controls = policyControlsForFindings(findings);
		expect(controls.some((c) => c.framework === "owasp_asi")).toBe(true);
		expect(controls.some((c) => c.framework === "eu_ai_act")).toBe(true);
		expect(controls.some((c) => c.control_id === "ASI01")).toBe(true);
	});
});
