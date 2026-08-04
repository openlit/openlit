import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { createTelemetrySource, availableSourceTypeDescriptors } from "@/lib/telemetry-source-crud";
import { upsertDBConfig } from "@/lib/db-config";
import { NextRequest } from "next/server";
import { withConnectorAccess, withConnectorAudit } from "@/lib/access/connector-route";
import { connectorIconPath } from "@/lib/platform/connectors/icons";
import {
	getCurrentOrganisation,
	getCurrentProjectForOrganisation,
} from "@/lib/organisation";
import { listProjectConnectorInstances } from "@/lib/platform/connectors/instances";
import { isVisibleConnectorType } from "@/lib/platform/connectors/visible-types";

/**
 * Generic connector endpoint. Datasource instances are exposed through the
 * connector contract while legacy repositories remain compatibility stores
 * for existing platform features.
 */
async function GETHandler() {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const organisation = await getCurrentOrganisation();
	const project = organisation?.id
		? await getCurrentProjectForOrganisation(organisation.id)
		: null;
	if (!project?.id) return Response.json({ connectors: [] });
	const [err, connectors] = await asaw(listProjectConnectorInstances(project.id));
	if (err) return errorResponse(err, "Failed to list connectors");
	return Response.json({
		connectors: ((connectors || []) as Array<Record<string, unknown>>).filter((connector) => isVisibleConnectorType(connector.type)).map((connector) => {
			const { secretRef: _secretRef, ...safeConnector } = connector;
			return {
			...safeConnector,
			icon: connectorIconPath(String(connector.type || "")),
			category: "datasource",
			scope: "project",
		};
		}),
		availableTypeDescriptors: availableSourceTypeDescriptors().filter((descriptor) => isVisibleConnectorType(descriptor.type)).map((descriptor) => ({
			...descriptor,
			icon: connectorIconPath(descriptor.type),
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
	if (body.type === "clickhouse") {
		const settings = body.settings && typeof body.settings === "object"
			? body.settings as Record<string, unknown>
			: {};
		const credentials = body.credentials && typeof body.credentials === "object"
			? body.credentials as Record<string, unknown>
			: {};
		const [dbErr] = await asaw(upsertDBConfig({
			name: body.name,
			environment: body.environment,
			username: settings.username,
			host: settings.host,
			port: settings.port,
			database: settings.database,
			query: settings.query,
			password: credentials.password,
		} as any, typeof body.id === "string" ? body.id : undefined));
		if (dbErr) return errorResponse(dbErr, "Failed to save ClickHouse connector");
		const organisation = await getCurrentOrganisation();
		const project = organisation?.id
			? await getCurrentProjectForOrganisation(organisation.id)
			: null;
		const refreshed = project?.id ? await listProjectConnectorInstances(project.id) : [];
		const connector = refreshed.find((item) =>
			item.type === "clickhouse" &&
			item.name === String(body.name || "") &&
			(item.environment || "production") === String(body.environment || "production")
		);
		return Response.json({
			...(connector || { name: body.name, type: "clickhouse", environment: body.environment }),
			category: "datasource",
			scope: "project",
		});
	}
	const [err, source] = await asaw(createTelemetrySource(body));
	if (err) return errorResponse(err, "Failed to create connector");
	return Response.json({ ...source, category: "datasource", scope: "project" });
}

export const GET = withConnectorAccess("read", GETHandler);
export const POST = withConnectorAudit(withConnectorAccess("create", POSTHandler));
