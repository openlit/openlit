import { SERVER_EVENTS } from "@/constants/events";
import { autoUpdatePricing } from "@/lib/platform/pricing";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const startTimestamp = Date.now();
	const formData = await request.json();
	const result = await autoUpdatePricing(formData);
	PostHogServer.fireEvent({
		event: result.success
			? SERVER_EVENTS.PRICING_AUTO_RUN_SUCCESS
			: SERVER_EVENTS.PRICING_AUTO_RUN_FAILURE,
		startTimestamp,
	});
	return Response.json(result);
}
