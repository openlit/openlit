import { SERVER_EVENTS } from "@/constants/events";
import {
	governanceReportEventProps,
} from "@/helpers/client/governance-analytics";
import type { GovernanceSeverity } from "@/types/governance-report";
import PostHogServer from "@/lib/posthog";

export function fireGovernanceReportTelemetry(input: {
	success: boolean;
	startTimestamp: number;
	spanId: string;
	traceId?: string;
	reason?: string;
	error?: string;
	riskLevel?: GovernanceSeverity | "none";
	findingCount?: number;
	ruleMatchCount?: number;
	evaluationCount?: number;
	analysisLimited?: boolean;
}) {
	PostHogServer.fireEvent({
		event: input.success
			? SERVER_EVENTS.GOVERNANCE_REPORT_SUCCESS
			: SERVER_EVENTS.GOVERNANCE_REPORT_FAILURE,
		startTimestamp: input.startTimestamp,
		properties: {
			...governanceReportEventProps({
				spanId: input.spanId,
				traceId: input.traceId,
				riskLevel: input.riskLevel,
				findingCount: input.findingCount,
				ruleMatchCount: input.ruleMatchCount,
				evaluationCount: input.evaluationCount,
				analysisLimited: input.analysisLimited,
			}),
			reason: input.reason,
			error: input.error,
		},
	});
}
