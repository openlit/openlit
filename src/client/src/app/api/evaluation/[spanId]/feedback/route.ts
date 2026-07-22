import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { storeManualFeedback } from "@/lib/platform/evaluation";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";

async function POSTHandler(
	request: Request,
	{ params }: { params: Promise<{ spanId: string }> }
) {
	const startTimestamp = Date.now();
	const { spanId } = await params;
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

	const res: any = await storeManualFeedback(
		spanId,
		rating,
		comment?.trim() || undefined
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

export const POST = withAudit(withCurrentOrganisationPermission("evaluation:feedback", POSTHandler));
