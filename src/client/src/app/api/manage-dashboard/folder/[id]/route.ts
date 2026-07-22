import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { SERVER_EVENTS } from "@/constants/events";
import { deleteFolder, getFolderById } from "@/lib/platform/manage-dashboard/folder";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";

async function DELETEHandler(
	_: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const startTimestamp = Date.now();
	const res = await deleteFolder(id);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.FOLDER_DELETE_FAILURE : SERVER_EVENTS.FOLDER_DELETE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

async function GETHandler(
	_: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const res = await getFolderById(id);
	return Response.json(res);
}

export const GET = withCurrentOrganisationPermission("dashboard:read", GETHandler);
export const DELETE = withAudit(withCurrentOrganisationPermission("dashboard:delete", DELETEHandler));
