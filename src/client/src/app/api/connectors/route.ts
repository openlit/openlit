import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import {
	createTelemetrySource,
	listTelemetrySources,
} from "@/lib/telemetry-source-crud";
import { NextRequest } from "next/server";
import { withConnectorAccess, withConnectorAudit } from "@/lib/access/connector-route";
import { connectorIconPath } from "@/lib/platform/connectors/icons";

/**
 * Generic connector compatibility endpoint. Datasource instances are backed
 * by the existing telemetry-source repository until the data migration is
 * complete; future categories register their own repositories here.
 */
async function GETHandler() {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const [err, sources] = await asaw(listTelemetrySources());
	if (err) return errorResponse(err, "Failed to list connectors");
	return Response.json({
		connectors: ((sources || []) as Array<Record<string, unknown>>).map((source) => ({
			...source,
			icon: connectorIconPath(String(source.type || "")),
			category: "datasource",
			scope: "project",
		})),
	});
}

async function POSTHandler(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ err: "Invalid JSON" }, { status: 400 });
	}
	if (body.category && body.category !== "datasource") {
		return Response.json(
			{ err: `Connector category is not available in CE: ${String(body.category)}` },
			{ status: 400 }
		);
	}
	const [err, source] = await asaw(createTelemetrySource(body));
	if (err) return errorResponse(err, "Failed to create connector");
	return Response.json({ ...source, category: "datasource", scope: "project" });
}

export const GET = withConnectorAccess("read", GETHandler);
export const POST = withConnectorAudit(withConnectorAccess("create", POSTHandler));
