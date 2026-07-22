import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { SERVER_EVENTS } from "@/constants/events";
import {
	deleteWidget,
	getWidgetById,
	updateWidget,
} from "@/lib/platform/manage-dashboard/widget";
import PostHogServer from "@/lib/posthog";
import { Widget } from "@/types/manage-dashboard";
import { NextRequest } from "next/server";

// Delete widget
async function DELETEHandler(
	_: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const startTimestamp = Date.now();
	const res = await deleteWidget(id);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.DASHBOARD_WIDGET_DELETE_FAILURE : SERVER_EVENTS.DASHBOARD_WIDGET_DELETE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

// Get widget by id
async function GETHandler(
	_: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const res = await getWidgetById(id);
	return Response.json(res);
}

// Update widget
async function PUTHandler(request: NextRequest) {
	const startTimestamp = Date.now();
	const widget: Widget = await request.json();

	const res = await updateWidget(widget);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.DASHBOARD_WIDGET_UPDATE_FAILURE : SERVER_EVENTS.DASHBOARD_WIDGET_UPDATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

export const GET = withCurrentOrganisationPermission("dashboard:read", GETHandler);
export const PUT = withAudit(withCurrentOrganisationPermission("dashboard:update", PUTHandler));
export const DELETE = withAudit(withCurrentOrganisationPermission("dashboard:delete", DELETEHandler));
