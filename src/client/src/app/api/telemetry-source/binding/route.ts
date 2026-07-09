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

export async function GET() {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const [err, bindings] = await asaw(listTelemetrySourceBindings());
	if (err) return errorResponse(err, "Failed to list telemetry source bindings");
	return Response.json({ bindings });
}

export async function PUT(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	let body: { signal?: unknown; sourceId?: unknown };
	try {
		body = await request.json();
	} catch {
		return Response.json({ err: TELEMETRY_SOURCE_INVALID_JSON }, { status: 400 });
	}

	const [err, binding] = await asaw(
		setTelemetrySourceBinding(body?.signal, String(body?.sourceId ?? ""))
	);
	if (err) return errorResponse(err, "Failed to set telemetry source binding");
	return Response.json(binding);
}

export async function DELETE(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const signal = request.nextUrl.searchParams.get("signal");
	const [err, result] = await asaw(deleteTelemetrySourceBinding(signal));
	if (err) return errorResponse(err, "Failed to delete telemetry source binding");
	return Response.json(result);
}
