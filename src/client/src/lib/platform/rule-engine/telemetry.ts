import type { MetricParams } from "../common";
import { listTraceRecords } from "../traces/read";

/**
 * Rule-engine telemetry reads must use the same signal router as Telemetry.
 * This keeps rule previews and field discovery working when traces are stored
 * in Tempo, Datadog, Jaeger, or another configured connector.
 */
export async function listRecentRuleTraces(limit = 100, environment?: string) {
	const end = new Date();
	const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
	const params: MetricParams = {
		timeLimit: { type: "CUSTOM", start, end },
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
		"deployment.environment": ["SpanAttributes", "deployment.environment"],
		"service.name": ["ResourceAttributes", "service.name"],
		"gen_ai.system": ["SpanAttributes", "gen_ai.system"],
		"gen_ai.request.model": ["SpanAttributes", "gen_ai.request.model"],
		"gen_ai.usage.input_tokens": ["SpanAttributes", "gen_ai.usage.input_tokens"],
		"gen_ai.usage.output_tokens": ["SpanAttributes", "gen_ai.usage.output_tokens"],
		"gen_ai.usage.total_cost": ["SpanAttributes", "gen_ai.usage.total_cost"],
		"gen_ai.request.temperature": ["SpanAttributes", "gen_ai.request.temperature"],
	};
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
