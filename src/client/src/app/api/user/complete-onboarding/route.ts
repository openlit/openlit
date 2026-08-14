import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

export async function POST() {
	const startTimestamp = Date.now();
	const [err, user] = await asaw(getCurrentUser());

	if (err || !user) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.USER_ONBOARDING_COMPLETE_FAILURE,
			startTimestamp,
		});
		return Response.json("Unauthorized", {
			status: 401,
		});
	}

	await prisma.user.update({
		where: { id: user.id },
		data: { hasCompletedOnboarding: true },
	});

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.USER_ONBOARDING_COMPLETE_SUCCESS,
		startTimestamp,
	});
	return Response.json({ success: true });
}
