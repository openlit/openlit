import { SERVER_EVENTS } from "@/constants/events";
import { getAllAgents } from "@/lib/platform/fleet-hub";
import PostHogServer from "@/lib/posthog";

export async function GET() {
	const startTimestamp = Date.now();
	const res: any = await getAllAgents();
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.FLEET_HUB_LIST_FAILURE : SERVER_EVENTS.FLEET_HUB_LIST_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}