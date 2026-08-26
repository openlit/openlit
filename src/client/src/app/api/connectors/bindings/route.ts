import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import {
	deleteTelemetrySourceBinding,
	listTelemetrySourceBindings,
	setTelemetrySourceBinding,
} from "@/lib/telemetry-source-crud";
import { NextRequest } from "next/server";
import { withConnectorAccess, withConnectorAudit } from "@/lib/access/connector-route";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";

async function GETHandler(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const environment = request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) ||
		new URL(request.url).searchParams.get("environment") || undefined;
	const [err, bindings] = await asaw(listTelemetrySourceBindings(environment));
	if (err) return errorResponse(err, "Failed to list connector bindings");
	return Response.json({ bindings });
}

async function PUTHandler(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	let body: { signal?: unknown; connectorId?: string; sourceId?: string; environment?: string };
	try {
		body = (await request.json()) as {
			signal?: unknown;
			connectorId?: string;
			sourceId?: string;
			environment?: string;
		};
	} catch {
		return Response.json({ err: "Invalid JSON" }, { status: 400 });
	}
	const connectorId = body.connectorId || body.sourceId;
	if (!connectorId) return Response.json({ err: "connectorId is required" }, { status: 400 });
	const [err, binding] = await asaw(setTelemetrySourceBinding(body.signal, connectorId, body.environment));
	if (err) return errorResponse(err, "Failed to bind connector");
	return Response.json({ ...binding, connectorId: binding?.sourceId });
}

async function DELETEHandler(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const signal = new URL(request.url).searchParams.get("signal");
	const environment = request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) ||
		new URL(request.url).searchParams.get("environment") || undefined;
	const [err, result] = await asaw(deleteTelemetrySourceBinding(signal, environment));
	if (err) return errorResponse(err, "Failed to remove connector binding");
	return Response.json(result);
}

export const GET = withConnectorAccess("read", GETHandler);
export const PUT = withConnectorAudit(withConnectorAccess("bind", PUTHandler));
export const DELETE = withConnectorAudit(withConnectorAccess("bind", DELETEHandler));
