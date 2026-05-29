import { SERVER_EVENTS } from "@/constants/events";
import { updateTlsConnection } from "@/lib/platform/fleet-hub";
import PostHogServer from "@/lib/posthog";

export async function POST(request: Request, context: any) {
	const startTimestamp = Date.now();
	const { id } = context.params;
	const { tlsMin } = await request.json();
	const res = await updateTlsConnection(id, tlsMin);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.FLEET_HUB_TLS_CONNECTION_FAILURE : SERVER_EVENTS.FLEET_HUB_TLS_CONNECTION_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}