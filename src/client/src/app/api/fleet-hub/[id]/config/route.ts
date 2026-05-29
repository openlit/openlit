import { SERVER_EVENTS } from "@/constants/events";
import { updateAgentConfig } from "@/lib/platform/fleet-hub";
import PostHogServer from "@/lib/posthog";

export async function POST(request: Request, context: any) {
	const startTimestamp = Date.now();
	const { id } = context.params;
	const { config } = await request.json();
	const res = await updateAgentConfig(id, config);

	// Check if there was an error from the OpAMP server
	if (res.err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.FLEET_HUB_CONFIG_UPDATE_FAILURE,
			startTimestamp,
		});
		return Response.json(res.err,
			{ status: res.status || 500 }
		);
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.FLEET_HUB_CONFIG_UPDATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}