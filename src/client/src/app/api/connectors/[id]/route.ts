import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import {
	deleteTelemetrySource,
	updateTelemetrySource,
} from "@/lib/telemetry-source-crud";
import { NextRequest } from "next/server";
import { withConnectorAccess, withConnectorAudit } from "@/lib/access/connector-route";

function telemetrySourceId(id: string) {
	return id.startsWith("telemetry:") ? id.slice("telemetry:".length) : id;
}

async function PATCHHandler(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const body = (await request.json()) as Record<string, unknown>;
	const [err, connector] = await asaw(updateTelemetrySource(telemetrySourceId(params.id), body));
	if (err) return errorResponse(err, "Failed to update connector");
	return Response.json({ ...connector, category: "datasource", scope: "project" });
}

async function DELETEHandler(
	_request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const [err, result] = await asaw(deleteTelemetrySource(telemetrySourceId(params.id)));
	if (err) return errorResponse(err, "Failed to delete connector");
	return Response.json(result);
}

export const PATCH = withConnectorAudit(withConnectorAccess("update", PATCHHandler));
export const DELETE = withConnectorAudit(withConnectorAccess("delete", DELETEHandler));
