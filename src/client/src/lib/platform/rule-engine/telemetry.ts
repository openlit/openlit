import type { MetricParams } from "../common";
import { listTraceRecords } from "../traces/read";

/**
 * Rule-engine telemetry reads must use the same signal router as Telemetry.
 * This keeps rule previews and field discovery working when traces are stored
 * in Tempo, Datadog, Jaeger, or another configured connector.
 */
export async function listRecentRuleTraces(limit = 100, environment?: string) {
	const end = new Date();
	// Rule authoring needs a representative sample even when telemetry is not
	// continuously ingested (local/dev projects commonly have week-long gaps).
	// Keep the query bounded, but use a 30-day window rather than silently
	// returning no field values or preview candidates after seven days.
	const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
	const params: MetricParams = {
		// Keep timestamps in the same ISO-8601 form used by telemetry API
		// payloads. Interpolating Date objects produces locale text such as
		// "Thu Jul 30 ... (India Standard Time)", which ClickHouse's
		// parseDateTimeBestEffort cannot parse.
		timeLimit: {
			type: "CUSTOM",
			start: start.toISOString(),
			end: end.toISOString(),
		},
		limit,
		offset: 0,
		sorting: { type: "Timestamp", direction: "desc" },
		environment,
	};
	const result = await listTraceRecords(params);
	if (result.err) throw new Error(String(result.err));
	return (result.records || []) as Record<string, any>[];
}

export function getRuleTraceFieldValue(
	trace: Record<string, any>,
	field: string
): string {
	const attributeFields: Record<string, ["SpanAttributes" | "ResourceAttributes", string]> = {
		"service.name": ["ResourceAttributes", "service.name"],
		"gen_ai.system": ["SpanAttributes", "gen_ai.system"],
		"gen_ai.request.model": ["SpanAttributes", "gen_ai.request.model"],
		"gen_ai.usage.input_tokens": ["SpanAttributes", "gen_ai.usage.input_tokens"],
		"gen_ai.usage.output_tokens": ["SpanAttributes", "gen_ai.usage.output_tokens"],
		"gen_ai.usage.total_cost": ["SpanAttributes", "gen_ai.usage.total_cost"],
		"gen_ai.request.temperature": ["SpanAttributes", "gen_ai.request.temperature"],
		"gen_ai.tool.name": ["SpanAttributes", "gen_ai.tool.name"],
		"gen_ai.tool.call.name": ["SpanAttributes", "gen_ai.tool.call.name"],
		"coding_agent.client": ["SpanAttributes", "coding_agent.client"],
		"coding_agent.policy.permission_mode": [
			"SpanAttributes",
			"coding_agent.policy.permission_mode",
		],
		"coding_agent.content_capture_mode": [
			"SpanAttributes",
			"coding_agent.content_capture_mode",
		],
		"coding_agent.user.classification": [
			"SpanAttributes",
			"coding_agent.user.classification",
		],
		"coding_agent.session.outcome": [
			"SpanAttributes",
			"coding_agent.session.outcome",
		],
		"coding_agent.tool.name": ["SpanAttributes", "coding_agent.tool.name"],
	};
	if (field === "deployment.environment") {
		return String(
			trace.ResourceAttributes?.["deployment.environment"] ??
			trace.SpanAttributes?.["deployment.environment"] ??
			trace.SpanAttributes?.["gen_ai.environment"] ??
			""
		);
	}
	if (
		field.startsWith("coding_agent.") ||
		field === "gen_ai.tool.name" ||
		field === "gen_ai.tool.call.name"
	) {
		return String(
			trace.SpanAttributes?.[field] ??
				trace.ResourceAttributes?.[field] ??
				""
		);
	}
	const attribute = attributeFields[field];
	if (attribute) {
		const [scope, key] = attribute;
		return String(trace[scope]?.[key] ?? "");
	}

	const directFields: Record<string, string> = {
		ServiceName: "ServiceName",
		SpanName: "SpanName",
		SpanKind: "SpanKind",
		Duration: "Duration",
		StatusCode: "StatusCode",
	};
	return String(trace[directFields[field] || field] ?? "");
}
