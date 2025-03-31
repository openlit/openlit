import { SERVER_EVENTS } from "@/constants/events";
import { autoEvaluate } from "@/lib/platform/evaluation";
import PostHogServer from "@/lib/posthog";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
	const formData = await request.json();

	const start = Date.now();
	const result = await autoEvaluate(formData);
	const end = Date.now();
	PostHogServer.capture({
		event: result.success
			? SERVER_EVENTS.EVALUATION_AUTO_SUCCESS
			: SERVER_EVENTS.EVALUATION_AUTO_FAILURE,
		distinctId: randomUUID(),
		properties: {
			responseTime: end - start,
		},
	});
	return Response.json(result);
}
