import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { SERVER_EVENTS } from "@/constants/events";
import { updateAgentConfig } from "@/lib/platform/fleet-hub";
import { emitManagementAlertSignalSafe } from "@/lib/platform/alerts/signals";
import PostHogServer from "@/lib/posthog";

async function POSTHandler(request: Request, context: any) {
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
	emitManagementAlertSignalSafe({
		triggerType: "fleet_hub_config_update",
		event: "fleet_hub_config_updated",
		message: `Fleet Hub configuration for ${id} was updated.`,
		sourceId: id,
		fields: {
			agent_id: id,
			config_key: config && typeof config === "object" ? Object.keys(config)[0] || "" : "",
		},
		payloadSummary: {
			agentId: id,
			configKeys: config && typeof config === "object" ? Object.keys(config) : [],
		},
	});
	return Response.json(res);
}

export const POST = withAudit(withCurrentOrganisationPermission("fleet_hub:configure", POSTHandler));
