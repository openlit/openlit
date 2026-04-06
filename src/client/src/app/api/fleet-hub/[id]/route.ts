import { SERVER_EVENTS } from "@/constants/events";
import { getAgentByInstanceId } from "@/lib/platform/fleet-hub";
import PostHogServer from "@/lib/posthog";

export async function GET(_: Request, context: any) {
	const startTimestamp = Date.now();
	const { id } = context.params;
	const res = await getAgentByInstanceId(id);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.FLEET_HUB_GET_FAILURE : SERVER_EVENTS.FLEET_HUB_GET_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}
