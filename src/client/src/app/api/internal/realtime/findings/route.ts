import { NextRequest } from "next/server";
import getMessage from "@/constants/messages";
import { isValidEngineRequest } from "@/helpers/server/engine-auth";
import {
	RealtimeFindingError,
	parseRealtimeFindingInput,
	pruneRealtimeFindings,
	recordRealtimeFinding,
} from "@/lib/platform/realtime/findings";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
	const messages = getMessage();
	if (!isValidEngineRequest(request)) {
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
		pruneRealtimeFindings().catch((error) =>
			console.error("[realtime] failed to prune findings", error)
		);
		return Response.json({ transition, id: finding?.id ?? null });
	} catch (error) {
		if (error instanceof RealtimeFindingError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		console.error("[realtime] failed to record finding", error);
		return Response.json({ error: messages.OPERATION_FAILED }, { status: 500 });
	}
}
