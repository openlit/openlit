import { createHash } from "crypto";
import type { TraceGovernanceReport } from "@/types/governance-report";

export const GOVERNANCE_PASSPORT_SCHEMA_VERSION = "1.0.0";
export const GOVERNANCE_REPORT_ID_ATTR = "openlit.governance.report_id";

export type GovernancePassportEnvelope = {
	schema_version: string;
	exported_at: string;
	report_id: string;
	attribute_key: typeof GOVERNANCE_REPORT_ID_ATTR;
	report: TraceGovernanceReport;
};

/** Deterministic passport id for a built report (stable across re-exports). */
export function computeGovernanceReportId(
	report: Pick<
		TraceGovernanceReport,
		| "trace_id"
		| "root_span_id"
		| "risk_level"
		| "finding_count"
		| "rule_match_count"
		| "summary"
	>
): string {
	const material = [
		report.trace_id,
		report.root_span_id,
		report.risk_level,
		String(report.finding_count),
		String(report.rule_match_count),
		report.summary,
	].join("|");
	return createHash("sha256").update(material).digest("hex").slice(0, 24);
}

export function stampGovernanceReportId(
	report: TraceGovernanceReport
): TraceGovernanceReport {
	if (report.report_id) return report;
	return {
		...report,
		report_id: computeGovernanceReportId(report),
	};
}

export function buildGovernancePassport(
	report: TraceGovernanceReport,
	opts?: { exportedAt?: string }
): GovernancePassportEnvelope {
	const stamped = stampGovernanceReportId(report);
	return {
		schema_version: GOVERNANCE_PASSPORT_SCHEMA_VERSION,
		exported_at: opts?.exportedAt || new Date().toISOString(),
		report_id: stamped.report_id!,
		attribute_key: GOVERNANCE_REPORT_ID_ATTR,
		report: stamped,
	};
}
