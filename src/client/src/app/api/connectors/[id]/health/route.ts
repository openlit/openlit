import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import {
	healthCheckTelemetrySource,
	validateTelemetrySourceAISignal,
} from "@/lib/telemetry-source-crud";
import { withConnectorAccess, withConnectorAudit } from "@/lib/access/connector-route";

const DEFAULT_PROBE_MS = 60 * 60 * 1000;

function telemetrySourceId(id: string) {
	return id.startsWith("telemetry:") ? id.slice("telemetry:".length) : id;
}

async function healthAndValidate(id: string) {
	const sourceId = telemetrySourceId(id);
	const [healthErr, health] = await asaw(healthCheckTelemetrySource(sourceId));
	if (healthErr) return errorResponse(healthErr, "Connector health check failed");

	const end = new Date();
	const start = new Date(end.getTime() - DEFAULT_PROBE_MS);
	const [validateErr, validation] = await asaw(
		validateTelemetrySourceAISignal(sourceId, { start, end })
	);
	if (validateErr) {
		return errorResponse(validateErr, "Connector AI validation failed");
	}

	return Response.json({ health, validation });
}

async function GETHandler(
	_request: Request,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	return healthAndValidate(params.id);
}

async function POSTHandler(
	_request: Request,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	return healthAndValidate(params.id);
}

export const GET = withConnectorAudit(withConnectorAccess("test", GETHandler));
export const POST = withConnectorAudit(withConnectorAccess("test", POSTHandler));
