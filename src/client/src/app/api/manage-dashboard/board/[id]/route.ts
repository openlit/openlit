import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { SERVER_EVENTS } from "@/constants/events";
import { deleteBoard, getBoardById, setMainDashboard, updatePinnedBoard } from "@/lib/platform/manage-dashboard/board";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";

async function DELETEHandler(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const startTimestamp = Date.now();
	const res = await deleteBoard(id);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.DASHBOARD_DELETE_FAILURE : SERVER_EVENTS.DASHBOARD_DELETE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

async function GETHandler(
	_: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const res = await getBoardById(id);
	return Response.json(res);
}

async function PATCHHandler(
	request: NextRequest,
	{ params: { id } }: { params: { id: string } }
) {
	const startTimestamp = Date.now();
	const body = await request.json();
	if (body.setMain) {
		const res = await setMainDashboard(id);
		PostHogServer.fireEvent({
			event: res.err ? SERVER_EVENTS.DASHBOARD_TOGGLE_MAIN_FAILURE : SERVER_EVENTS.DASHBOARD_TOGGLE_MAIN_SUCCESS,
			startTimestamp,
		});
		return Response.json(res);
	}

	if (body.updatePinned) {
		const res = await updatePinnedBoard(id);
		PostHogServer.fireEvent({
			event: res.err ? SERVER_EVENTS.DASHBOARD_TOGGLE_PINNED_FAILURE : SERVER_EVENTS.DASHBOARD_TOGGLE_PINNED_SUCCESS,
			startTimestamp,
		});
		return Response.json(res);
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.DASHBOARD_PATCH_FAILURE,
		startTimestamp,
	});
	return Response.json({ err: "Invalid PATCH request" }, { status: 400 });
}

export const GET = withCurrentOrganisationPermission("dashboard:read", GETHandler);
export const PATCH = withAudit(withCurrentOrganisationPermission("dashboard:update", PATCHHandler));
export const DELETE = withAudit(withCurrentOrganisationPermission("dashboard:delete", DELETEHandler));
