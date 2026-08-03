import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { healthCheckTelemetrySource } from "@/lib/telemetry-source-crud";
import { withConnectorAccess, withConnectorAudit } from "@/lib/access/connector-route";

function telemetrySourceId(id: string) {
	return id.startsWith("telemetry:") ? id.slice("telemetry:".length) : id;
}

async function POSTHandler(
	_request: Request,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const [err, health] = await asaw(healthCheckTelemetrySource(telemetrySourceId(params.id)));
	if (err) return errorResponse(err, "Connector health check failed");
	return Response.json({ health });
}

export const POST = withConnectorAudit(withConnectorAccess("test", POSTHandler));
