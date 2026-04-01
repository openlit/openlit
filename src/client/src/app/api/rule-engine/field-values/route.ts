import { NextRequest, NextResponse } from "next/server";
import { SERVER_EVENTS } from "@/constants/events";
import { getCurrentUser } from "@/lib/session";
import { dataCollector, OTEL_TRACES_TABLE_NAME } from "@/lib/platform/common";
import PostHogServer from "@/lib/posthog";

// Maps condition field names to ClickHouse column expressions
const FIELD_COLUMN_MAP: Record<string, string> = {
	ServiceName: "ServiceName",
	SpanName: "SpanName",
	SpanKind: "SpanKind",
	StatusCode: "StatusCode",
	"deployment.environment": "SpanAttributes['deployment.environment']",
	"service.name": "ResourceAttributes['service.name']",
	"gen_ai.system": "SpanAttributes['gen_ai.system']",
	"gen_ai.request.model": "SpanAttributes['gen_ai.request.model']",
};

export async function GET(request: NextRequest) {
	const startTimestamp = Date.now();
	const user = await getCurrentUser();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const field = request.nextUrl.searchParams.get("field");
	if (!field || !FIELD_COLUMN_MAP[field]) {
		return NextResponse.json({ values: [] });
	}

	const columnExpr = FIELD_COLUMN_MAP[field];

	const query = `
		SELECT DISTINCT ${columnExpr} AS val
		FROM ${OTEL_TRACES_TABLE_NAME}
		WHERE notEmpty(toString(${columnExpr}))
		ORDER BY val ASC
		LIMIT 100;
	`;

	const { data, err } = await dataCollector({ query }, "query");
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_FIELD_VALUES_FAILURE,
			startTimestamp,
		});
		return NextResponse.json({ values: [] });
	}

	const values = ((data as any[]) || []).map((row: any) => String(row.val)).filter(Boolean);
	PostHogServer.fireEvent({
		event: SERVER_EVENTS.RULE_FIELD_VALUES_SUCCESS,
		startTimestamp,
	});
	return NextResponse.json({ values });
}
