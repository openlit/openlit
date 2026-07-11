import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/utils/api-response";
import {
	availableSourceTypes,
	availableSourceTypeDescriptors,
	createTelemetrySource,
	listTelemetrySources,
	resolveProjectSignalCapabilities,
} from "@/lib/telemetry-source-crud";
import { TELEMETRY_SOURCE_INVALID_JSON } from "@/constants/messages/en";
import { NextRequest } from "next/server";

export async function GET() {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const [err, sources] = await asaw(listTelemetrySources());
	if (err) return errorResponse(err, "Failed to list telemetry sources");
	const [, signalCapabilities] = await asaw(resolveProjectSignalCapabilities());
	return Response.json({
		sources,
		availableTypes: availableSourceTypes(),
		availableTypeDescriptors: availableSourceTypeDescriptors(),
		signalCapabilities: signalCapabilities ?? null,
	});
}

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ err: TELEMETRY_SOURCE_INVALID_JSON }, { status: 400 });
	}

	const [err, source] = await asaw(
		createTelemetrySource(body as Record<string, unknown>)
	);
	if (err) return errorResponse(err, "Failed to create telemetry source");
	return Response.json(source);
}
