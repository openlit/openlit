import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/utils/api-response";
import {
	deleteTelemetrySource,
	updateTelemetrySource,
} from "@/lib/telemetry-source-crud";
import { TELEMETRY_SOURCE_INVALID_JSON } from "@/constants/messages/en";
import { NextRequest } from "next/server";

export async function PATCH(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ err: TELEMETRY_SOURCE_INVALID_JSON }, { status: 400 });
	}

	const [err, source] = await asaw(
		updateTelemetrySource(params.id, body as Record<string, unknown>)
	);
	if (err) return errorResponse(err, "Failed to update telemetry source");
	return Response.json(source);
}

export async function DELETE(
	_request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const [err, res] = await asaw(deleteTelemetrySource(params.id));
	if (err) return errorResponse(err, "Failed to delete telemetry source");
	return Response.json(res);
}
