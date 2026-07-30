import { storeManualFeedback } from "@/lib/platform/evaluation";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";

export async function POST(
	request: Request,
	{ params }: { params: { spanId: string } }
) {
	const startTimestamp = Date.now();
	const { spanId } = params;
	const body = await request.json();
	const { rating, comment } = body as {
		rating?: "positive" | "negative" | "neutral";
		comment?: string;
	};

	if (!rating || !["positive", "negative", "neutral"].includes(rating)) {
		return Response.json(
			{ err: "Invalid rating. Must be positive, negative, or neutral." },
			{ status: 400 }
		);
	}

	const url = new URL(request.url);
	const environment = request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) || undefined;
	const res: any = await storeManualFeedback(
		spanId,
		rating,
		comment?.trim() || undefined,
		undefined,
		{
			traceId: url.searchParams.get("traceId") || undefined,
			environment,
		}
	);

	if (res?.err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_FEEDBACK_FAILURE,
			startTimestamp,
		});
		return Response.json(res, { status: 500 });
	}
	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_FEEDBACK_SUCCESS,
		startTimestamp,
	});
	return Response.json({ success: true });
}
