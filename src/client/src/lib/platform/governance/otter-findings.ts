import { getTraceAnalysisRuns } from "@/lib/platform/chat/improvement";
import {
	ensureTraceAnalysisDimensions,
	type TraceAnalysisFinding,
	type TraceAnalysisSeverity,
} from "@/types/trace-analysis";
import type {
	GovernanceFinding,
	GovernanceSeverity,
} from "@/types/governance-report";
import getMessage from "@/constants/messages";

const OTTER_SECURITY_DIMENSIONS = [
	"prompt_injection",
	"tool_misuse",
] as const;

type OtterSecurityDimension = (typeof OTTER_SECURITY_DIMENSIONS)[number];

function asGovernanceSeverity(
	severity: TraceAnalysisSeverity | string | undefined
): GovernanceSeverity {
	switch (severity) {
		case "critical":
		case "major":
		case "minor":
		case "info":
			return severity;
		default:
			return "minor";
	}
}

function mapOtterFinding(
	dimension: OtterSecurityDimension,
	finding: TraceAnalysisFinding,
	runId: string
): GovernanceFinding {
	const remediation =
		finding.suggested_fix ||
		(dimension === "prompt_injection"
			? getMessage().GOVERNANCE_REMEDIATION_PROMPT_INJECTION
			: getMessage().GOVERNANCE_REMEDIATION_TOOL_MISUSE);

	return {
		id: finding.id || `${dimension}-${runId}`,
		category: dimension,
		severity: asGovernanceSeverity(finding.severity),
		summary: finding.summary || dimension,
		detail: finding.detail || "",
		remediation,
		span_refs: Array.isArray(finding.span_refs)
			? finding.span_refs.filter(Boolean)
			: [],
		evidence: {
			source: "otter",
			dimension,
			run_id: runId,
			...(typeof finding.estimated_savings?.tokens === "number"
				? { estimated_savings_tokens: finding.estimated_savings.tokens }
				: {}),
			...(typeof finding.estimated_savings?.usd === "number"
				? { estimated_savings_usd: finding.estimated_savings.usd }
				: {}),
		},
	};
}

/**
 * Fold existing Otter AI Analysis security dimensions into governance findings.
 * Does not re-run the LLM — only reads the latest stored trace_analysis run.
 */
export async function loadOtterSecurityFindings(
	rootSpanId: string,
	databaseConfigId?: string
): Promise<{ findings: GovernanceFinding[]; otter_run_id?: string }> {
	const { data: runs, err } = await getTraceAnalysisRuns(
		rootSpanId,
		databaseConfigId,
		"trace_analysis"
	);
	if (err || !runs?.length) {
		return { findings: [] };
	}

	const latest = runs[runs.length - 1];
	let parsed: unknown;
	try {
		parsed =
			typeof latest.analysisJson === "string"
				? JSON.parse(latest.analysisJson)
				: latest.analysisJson;
	} catch {
		return { findings: [] };
	}

	const dimensions = ensureTraceAnalysisDimensions(
		parsed as Parameters<typeof ensureTraceAnalysisDimensions>[0]
	);
	const findings: GovernanceFinding[] = [];
	for (const dimension of OTTER_SECURITY_DIMENSIONS) {
		for (const finding of dimensions[dimension] || []) {
			findings.push(mapOtterFinding(dimension, finding, latest.id));
		}
	}

	return {
		findings,
		otter_run_id: findings.length ? latest.id : undefined,
	};
}
