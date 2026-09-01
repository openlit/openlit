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
import {
	clearedRoutingSourceId,
	fireSignalRoutingChangedTelemetry,
} from "@/helpers/server/connector-analytics";

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
	const startTimestamp = Date.now();
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
	fireSignalRoutingChangedTelemetry({
		signal: String(binding?.signal || body?.signal || ""),
		environment: String(binding?.environment || body?.environment || "production"),
		previousSourceId: binding?.previousSourceId,
		nextSourceId: String(binding?.sourceId ?? body?.sourceId ?? ""),
		previousConnectorType: binding?.previousSourceType,
		nextConnectorType: binding?.nextSourceType,
		startTimestamp,
	});
	return Response.json(binding);
}

async function DELETEHandler(request: NextRequest) {
	const startTimestamp = Date.now();
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const signal = request.nextUrl.searchParams.get("signal");
	const environment =
		request.headers.get(OPENLIT_CONTEXT_HEADERS.environment) ||
		request.nextUrl.searchParams.get("environment") ||
		"production";
	const [err, result] = await asaw(
		deleteTelemetrySourceBinding(
			signal,
			environment
		)
	);
	if (err) return errorResponse(err, "Failed to delete telemetry source binding");
	fireSignalRoutingChangedTelemetry({
		signal: String(result?.signal || signal || ""),
		environment: String(result?.environment || environment),
		previousSourceId: result?.previousSourceId,
		nextSourceId: clearedRoutingSourceId(),
		previousConnectorType: result?.previousSourceType,
		startTimestamp,
	});
	return Response.json(result);
}

export const GET = withConnectorAccess("read", GETHandler);
export const PUT = withConnectorAudit(withConnectorAccess("bind", PUTHandler));
export const DELETE = withConnectorAudit(withConnectorAccess("bind", DELETEHandler));
