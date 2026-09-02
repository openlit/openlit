import { getRequestEnvironment } from "@/constants/openlit-context";
import {
	GOVERNANCE_INVALID_SPAN_ID,
	GOVERNANCE_MISSING_SPAN_ID,
} from "@/constants/messages/en";
import {
	withGovernanceAccess,
	withGovernanceAudit,
} from "@/lib/access/governance-route";
import { withRouteAccess } from "@/lib/access/route-access";
import { fireGovernanceReportTelemetry } from "@/helpers/server/governance-analytics";
import { buildTraceGovernanceReport } from "@/lib/platform/governance/trace-report";
import { validateGovernanceSpanId } from "@/lib/platform/governance/validate";
import { resolveIntelligenceClickHouseDbConfigId } from "@/lib/platform/intelligence/source";
import { errorResponse } from "@/utils/api-response";

async function GETHandler(
	request: Request,
	context: { params?: { id?: string } }
) {
	const startTimestamp = Date.now();
	const { id } = context.params || {};
	const url = new URL(request.url);
	const traceId = url.searchParams.get("traceId") || undefined;

	if (!id) {
		fireGovernanceReportTelemetry({
			success: false,
			startTimestamp,
			spanId: "",
			traceId,
			reason: "missing_span",
		});
		return errorResponse(GOVERNANCE_MISSING_SPAN_ID, GOVERNANCE_MISSING_SPAN_ID, 400);
	}

	const spanId = validateGovernanceSpanId(id);
	if (!spanId) {
		fireGovernanceReportTelemetry({
			success: false,
			startTimestamp,
			spanId: id,
			traceId,
			reason: "invalid_span",
		});
		return errorResponse(
			GOVERNANCE_INVALID_SPAN_ID,
			GOVERNANCE_INVALID_SPAN_ID,
			400
		);
	}

	const environment =
		url.searchParams.get("environment") || getRequestEnvironment(request);

	const databaseConfigId =
		(await resolveIntelligenceClickHouseDbConfigId({ environment })) ||
		undefined;

	const result = await buildTraceGovernanceReport(spanId, {
		traceId,
		environment,
		databaseConfigId,
	});

	if (result.err) {
		fireGovernanceReportTelemetry({
			success: false,
			startTimestamp,
			spanId,
			traceId,
			error: String(result.err),
		});
		return errorResponse(result.err, String(result.err), 400);
	}

	const report = result.report!;
	fireGovernanceReportTelemetry({
		success: true,
		startTimestamp,
		spanId,
		traceId: report.trace_id,
		riskLevel: report.risk_level,
		findingCount: report.finding_count,
		ruleMatchCount: report.rule_match_count,
		evaluationCount: report.evaluations.length,
		analysisLimited: report.analysis_limited,
	});

	return Response.json({ report });
}

export const GET = withGovernanceAudit(
	withRouteAccess(
		"traces.read",
		withGovernanceAccess("read", GETHandler),
		{ requireDbConfig: true }
	)
);
