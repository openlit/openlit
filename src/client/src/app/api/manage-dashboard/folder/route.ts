import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { SERVER_EVENTS } from "@/constants/events";
import {
	createFolder,
	getFolders,
	updateFolder,
} from "@/lib/platform/manage-dashboard/folder";
import PostHogServer from "@/lib/posthog";
import { Folder } from "@/types/manage-dashboard";
import { NextRequest } from "next/server";

async function POSTHandler(request: NextRequest) {
	const startTimestamp = Date.now();
	const folder: Folder = await request.json();

	const res = await createFolder(folder);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.FOLDER_CREATE_FAILURE : SERVER_EVENTS.FOLDER_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

async function PUTHandler(request: NextRequest) {
	const startTimestamp = Date.now();
	const folder: Folder = await request.json();

	const res = await updateFolder(folder);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.FOLDER_UPDATE_FAILURE : SERVER_EVENTS.FOLDER_UPDATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

async function GETHandler() {
	const res = await getFolders();
	return Response.json(res);
}

export const GET = withCurrentOrganisationPermission("dashboard:read", GETHandler);
export const POST = withAudit(withCurrentOrganisationPermission("dashboard:create", POSTHandler));
export const PUT = withAudit(withCurrentOrganisationPermission("dashboard:update", PUTHandler));
