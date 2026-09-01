import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { createTelemetrySource } from "@/lib/telemetry-source-crud";
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
import { validateOpenPlaitClickHouseConnection } from "@/lib/platform/openplait";
import { availableConnectorTypeDescriptors } from "@/lib/platform/connectors/catalog";
import {
	createMemoryConnector,
	isMemoryConnectorType,
} from "@/lib/platform/connectors/memory/crud";
import { fireConnectorCreateTelemetry } from "@/helpers/server/connector-analytics";

/**
 * Generic connector endpoint. Datasource instances are exposed through the
 * connector contract while legacy repositories remain compatibility stores
 * for existing platform features. Memory connectors persist on ConnectorInstance.
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
			category: String(connector.category || "datasource"),
			scope: "project",
		};
		}),
		availableTypeDescriptors: availableConnectorTypeDescriptors(),
	});
}

async function POSTHandler(request: NextRequest) {
	const startTimestamp = Date.now();
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return Response.json({ err: "Invalid JSON" }, { status: 400 });
	}
	const category = String(body.category || "");
	const type = String(body.type || "");
	const environment = String(body.environment || "production");
	if (category === "memory" || isMemoryConnectorType(type)) {
		const [err, connector] = await asaw(createMemoryConnector(body));
		if (err) {
			fireConnectorCreateTelemetry({
				success: false,
				type: type || "memory",
				environment,
				startTimestamp,
			});
			return errorResponse(err, "Failed to create connector");
		}
		fireConnectorCreateTelemetry({
			success: true,
			type: String((connector as { type?: string })?.type || type || "memory"),
			environment,
			startTimestamp,
		});
		return Response.json(connector);
	}
	if (category && category !== "datasource") {
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
		const [validationErr] = await asaw(
			validateOpenPlaitClickHouseConnection({
				host: String(settings.host || ""),
				port: String(settings.port || ""),
				database: String(settings.database || ""),
				username: String(settings.username || ""),
				password: String(credentials.password || ""),
				query: String(settings.query || ""),
			})
		);
		if (validationErr) {
			fireConnectorCreateTelemetry({
				success: false,
				type: "clickhouse",
				environment,
				startTimestamp,
			});
			return errorResponse(
				validationErr,
				"Failed to validate ClickHouse connector through OpenPlait"
			);
		}
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
		if (dbErr) {
			fireConnectorCreateTelemetry({
				success: false,
				type: "clickhouse",
				environment,
				startTimestamp,
			});
			return errorResponse(dbErr, "Failed to save ClickHouse connector");
		}
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
		fireConnectorCreateTelemetry({
			success: true,
			type: "clickhouse",
			environment,
			startTimestamp,
		});
		return Response.json({
			...(connector || { name: body.name, type: "clickhouse", environment: body.environment }),
			category: "datasource",
			scope: "project",
		});
	}
	const [err, source] = await asaw(createTelemetrySource(body));
	if (err) {
		fireConnectorCreateTelemetry({
			success: false,
			type: type || "unknown",
			environment,
			startTimestamp,
		});
		return errorResponse(err, "Failed to create connector");
	}
	fireConnectorCreateTelemetry({
		success: true,
		type: String((source as { type?: string })?.type || type),
		environment,
		startTimestamp,
	});
	return Response.json({ ...source, category: "datasource", scope: "project" });
}

export const GET = withConnectorAccess("read", GETHandler);
export const POST = withConnectorAudit(withConnectorAccess("create", POSTHandler));
