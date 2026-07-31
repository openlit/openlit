import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { SERVER_EVENTS } from "@/constants/events";
import {
	createBoard,
	getBoards,
	updateBoard,
} from "@/lib/platform/manage-dashboard/board";
import PostHogServer from "@/lib/posthog";
import { Board } from "@/types/manage-dashboard";
import { NextRequest } from "next/server";

async function POSTHandler(request: NextRequest) {
	const startTimestamp = Date.now();
	const board: Board = await request.json();

	const res = await createBoard(board);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.DASHBOARD_CREATE_FAILURE : SERVER_EVENTS.DASHBOARD_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

async function PUTHandler(request: NextRequest) {
	const startTimestamp = Date.now();
	const board: Board & { updateParent?: boolean } = await request.json();
	const res = await updateBoard(board);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.DASHBOARD_UPDATE_FAILURE : SERVER_EVENTS.DASHBOARD_UPDATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

async function GETHandler(request: NextRequest) {
	const isHome = request.nextUrl.searchParams.get("home") === "true";
	const res = await getBoards(isHome);
	return Response.json(res);
}

export const GET = withCurrentOrganisationPermission("dashboard:read", GETHandler);
export const POST = withAudit(withCurrentOrganisationPermission("dashboard:create", POSTHandler));
export const PUT = withAudit(withCurrentOrganisationPermission("dashboard:update", PUTHandler));
