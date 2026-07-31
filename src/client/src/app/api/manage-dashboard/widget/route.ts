import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { SERVER_EVENTS } from "@/constants/events";
import { createWidget, getWidgets } from "@/lib/platform/manage-dashboard/widget";
import PostHogServer from "@/lib/posthog";
import { Widget } from "@/types/manage-dashboard";
import { NextRequest } from "next/server";

async function POSTHandler(request: NextRequest) {
	const widget: Widget = await request.json();
	const startTimestamp = Date.now();
	const res = await createWidget(widget);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.DASHBOARD_WIDGET_CREATE_FAILURE : SERVER_EVENTS.DASHBOARD_WIDGET_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

async function GETHandler() {
	const res = await getWidgets();
	return Response.json(res);
}

export const GET = withCurrentOrganisationPermission("dashboard:read", GETHandler);
export const POST = withAudit(withCurrentOrganisationPermission("dashboard:create", POSTHandler));
