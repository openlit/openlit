import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/utils/api-response";
import { getCurrentUser } from "@/lib/session";
import { createProjectEnvironment, listProjectEnvironments } from "@/lib/project-environment";
import { withConnectorAccess, withConnectorAudit } from "@/lib/access/connector-route";

async function GETHandler() {
	if (!(await getCurrentUser())) return Response.json("Unauthorized", { status: 401 });
	const [err, environments] = await asaw(listProjectEnvironments());
	return err ? errorResponse(err, "Failed to list environments") : Response.json({ environments });
}

async function POSTHandler(request: NextRequest) {
	if (!(await getCurrentUser())) return Response.json("Unauthorized", { status: 401 });
	const body = (await request.json()) as { name?: unknown };
	const [err, environment] = await asaw(createProjectEnvironment(body.name));
	return err ? errorResponse(err, "Failed to create environment") : Response.json({ environment });
}

export const GET = withConnectorAccess("read", GETHandler);
export const POST = withConnectorAudit(withConnectorAccess("create", POSTHandler));
