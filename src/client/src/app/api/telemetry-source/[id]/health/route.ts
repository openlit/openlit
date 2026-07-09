import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/utils/api-response";
import {
	healthCheckTelemetrySource,
	validateTelemetrySourceAISignal,
} from "@/lib/telemetry-source-crud";
import { NextRequest } from "next/server";

const DEFAULT_PROBE_MS = 60 * 60 * 1000;

export async function GET(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const [healthErr, health] = await asaw(
		healthCheckTelemetrySource(params.id)
	);
	if (healthErr)
		return errorResponse(healthErr, "Failed to health-check telemetry source");

	const end = new Date();
	const start = new Date(end.getTime() - DEFAULT_PROBE_MS);
	const [validateErr, validation] = await asaw(
		validateTelemetrySourceAISignal(params.id, { start, end })
	);
	if (validateErr)
		return errorResponse(validateErr, "Failed to validate telemetry source");

	return Response.json({ health, validation });
}
