import { NextRequest, NextResponse } from "next/server";
import { SERVER_EVENTS } from "@/constants/events";
import { getCurrentUser } from "@/lib/session";
import { listRecentRuleTraces, getRuleTraceFieldValue } from "@/lib/platform/rule-engine/telemetry";
import PostHogServer from "@/lib/posthog";

const SUPPORTED_FIELDS = new Set([
	"ServiceName", "SpanName", "SpanKind", "StatusCode",
	"deployment.environment", "service.name", "gen_ai.system", "gen_ai.request.model",
	"gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens",
	"gen_ai.usage.total_cost", "gen_ai.request.temperature",
]);

export async function GET(request: NextRequest) {
	const startTimestamp = Date.now();
	const user = await getCurrentUser();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const field = request.nextUrl.searchParams.get("field");
	if (!field || !SUPPORTED_FIELDS.has(field)) {
		return NextResponse.json({ values: [] });
	}

	let traces: Record<string, any>[];
	try {
		traces = await listRecentRuleTraces(1000);
	} catch {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_FIELD_VALUES_FAILURE,
			startTimestamp,
		});
		return NextResponse.json({ values: [] });
	}

	const values = Array.from(new Set(
		traces.map((trace) => getRuleTraceFieldValue(trace, field)).filter(Boolean)
	)).sort().slice(0, 100);
	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_FIELD_VALUES_SUCCESS,
		startTimestamp,
	});
	return NextResponse.json({ values });
}
