import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/utils/api-response";
import {
	deleteTelemetrySourceBinding,
	listTelemetrySourceBindings,
	setTelemetrySourceBinding,
} from "@/lib/telemetry-source-crud";
import { TELEMETRY_SOURCE_INVALID_JSON } from "@/constants/messages/en";
import { NextRequest } from "next/server";
import { withConnectorAccess, withConnectorAudit } from "@/lib/access/connector-route";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";

async function GETHandler(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const [err, bindings] = await asaw(
		listTelemetrySourceBindings(
			request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) ||
			request.nextUrl.searchParams.get("environment") ||
			undefined
		)
	);
	if (err) return errorResponse(err, "Failed to list telemetry source bindings");
	return Response.json({ bindings });
}

async function PUTHandler(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	let body: { signal?: unknown; sourceId?: unknown; environment?: unknown };
	try {
		body = await request.json();
	} catch {
		return Response.json({ err: TELEMETRY_SOURCE_INVALID_JSON }, { status: 400 });
	}

	const [err, binding] = await asaw(
		setTelemetrySourceBinding(body?.signal, String(body?.sourceId ?? ""), body?.environment)
	);
	if (err) return errorResponse(err, "Failed to set telemetry source binding");
	return Response.json(binding);
}

async function DELETEHandler(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const signal = request.nextUrl.searchParams.get("signal");
	const [err, result] = await asaw(
		deleteTelemetrySourceBinding(
			signal,
			request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) ||
			request.nextUrl.searchParams.get("environment") ||
			undefined
		)
	);
	if (err) return errorResponse(err, "Failed to delete telemetry source binding");
	return Response.json(result);
}

export const GET = withConnectorAccess("read", GETHandler);
export const PUT = withConnectorAudit(withConnectorAccess("bind", PUTHandler));
export const DELETE = withConnectorAudit(withConnectorAccess("bind", DELETEHandler));
