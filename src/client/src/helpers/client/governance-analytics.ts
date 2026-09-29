import type { GovernanceSeverity } from "@/types/governance-report";

export function governanceReportEventProps(input: {
	spanId: string;
	traceId?: string;
	riskLevel?: GovernanceSeverity | "none";
	findingCount?: number;
	ruleMatchCount?: number;
	evaluationCount?: number;
	analysisLimited?: boolean;
}) {
	return {
		span_id: input.spanId,
		trace_id: input.traceId,
		risk_level: input.riskLevel,
		finding_count: input.findingCount,
		rule_match_count: input.ruleMatchCount,
		evaluation_count: input.evaluationCount,
		analysis_limited: input.analysisLimited ?? false,
	};
}
