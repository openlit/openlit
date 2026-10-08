import { NextRequest } from "next/server";
import getMessage from "@/constants/messages";
import { isValidCronJobRequest } from "@/helpers/server/cron-auth";
import {
	RealtimeFindingError,
	parseRealtimeFindingInput,
	recordRealtimeFinding,
} from "@/lib/platform/realtime/findings";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
	const messages = getMessage();
	if (!isValidCronJobRequest(request)) {
		return Response.json({ error: messages.FORBIDDEN_ACTION }, { status: 403 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: messages.REALTIME_FINDING_INVALID_JSON }, { status: 400 });
	}

	try {
		const input = parseRealtimeFindingInput(body);
		const { transition, finding } = await recordRealtimeFinding(input);
		return Response.json({ transition, id: finding?.id ?? null });
	} catch (error) {
		if (error instanceof RealtimeFindingError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		console.error("[realtime] failed to record finding", error);
		return Response.json({ error: messages.OPERATION_FAILED }, { status: 500 });
	}
}
