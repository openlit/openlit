import { getEvaluationsForSpanId, setEvaluationsForSpanId } from "@/lib/platform/evaluation";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";

export async function GET(
	_: NextRequest,
	{ params }: { params: { spanId: string } }
) {
	const startTimestamp = Date.now();
	const { spanId } = params;

	const url = new URL(_.url);
	const environment = _.headers.get(OPENLIT_CONTEXT_HEADERS.environment) || undefined;
	const res: any = await getEvaluationsForSpanId(spanId, {
		traceId: url.searchParams.get("traceId") || undefined,
		environment,
	});
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

	const url = new URL(request.url);
	const environment = request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) || undefined;
	let res: any;
	try {
		res = await setEvaluationsForSpanId(spanId, {
			traceId: url.searchParams.get("traceId") || undefined,
			environment,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error("[evaluation] run request failed", {
			spanId,
			traceId: url.searchParams.get("traceId") || null,
			error: message,
		});
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_CREATE_FAILURE,
			startTimestamp,
		});
		return Response.json(
			{ err: message },
			{ status: message.toLowerCase().includes("trace") ? 404 : 400 }
		);
	}
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.EVALUATION_CREATE_FAILURE : SERVER_EVENTS.EVALUATION_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}
