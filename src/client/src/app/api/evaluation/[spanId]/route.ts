import { getEvaluationsForSpanId, setEvaluationsForSpanId } from "@/lib/platform/evaluation";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";

export async function GET(
	_: NextRequest,
	{ params }: { params: { spanId: string } }
) {
	const startTimestamp = Date.now();
	const { spanId } = params;

	const res: any = await getEvaluationsForSpanId(spanId);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.EVALUATION_GET_FAILURE : SERVER_EVENTS.EVALUATION_GET_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

export async function POST(
	request: Request,
	{ params }: { params: { spanId: string } }
) {
	const startTimestamp = Date.now();

	const { spanId } = params;

	const res: any = await setEvaluationsForSpanId(spanId);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.EVALUATION_CREATE_FAILURE : SERVER_EVENTS.EVALUATION_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}
