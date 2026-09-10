import prisma from "@/lib/prisma";
import type { DatabaseConfig, TelemetrySource } from "@prisma/client";

const DATABASE_CONNECTOR_PREFIX = "database:";
const TELEMETRY_CONNECTOR_PREFIX = "telemetry:";

function databaseConnectorId(id: string) {
	return `${DATABASE_CONNECTOR_PREFIX}${id}`;
}

function telemetryConnectorId(id: string) {
	return `${TELEMETRY_CONNECTOR_PREFIX}${id}`;
}

/**
 * Keep the generic connector registry in sync with the legacy ClickHouse
 * record. DatabaseConfig remains a compatibility store for platform features
 * that still require its relations, while ConnectorInstance is the canonical
 * integration identity exposed to connector consumers.
 */
export async function syncDatabaseConfigConnector(config: DatabaseConfig) {
	const settings = JSON.stringify({
		username: config.username,
		host: config.host,
		port: config.port,
		database: config.database,
		query: config.query || "",
	});

	return prisma.connectorInstance.upsert({
		where: { id: databaseConnectorId(config.id) },
		create: {
			id: databaseConnectorId(config.id),
			category: "datasource",
			type: "clickhouse",
			name: config.name,
			environment: config.environment || "production",
			projectId: config.projectId,
			settings,
			status: "active",
			metadata: JSON.stringify({ legacyKind: "database-config", legacyId: config.id }),
		},
		update: {
			name: config.name,
			environment: config.environment || "production",
			projectId: config.projectId,
			settings,
			status: "active",
		},
	});
}

/** Keep a TelemetrySource row visible through the generic connector registry. */
export async function syncTelemetrySourceConnector(source: TelemetrySource) {
	return prisma.connectorInstance.upsert({
		where: { id: telemetryConnectorId(source.id) },
		create: {
			id: telemetryConnectorId(source.id),
			category: "datasource",
			type: source.type,
			name: source.name,
			environment: source.environment || "production",
			projectId: source.projectId,
			settings: source.settings || "{}",
			secretRef: source.secretRef,
			status: "active",
			metadata: JSON.stringify({ legacyKind: "telemetry-source", legacyId: source.id, signals: source.signals, isDefault: source.isDefault }),
		},
		update: {
			type: source.type,
			name: source.name,
			environment: source.environment || "production",
			projectId: source.projectId,
			settings: source.settings || "{}",
			secretRef: source.secretRef,
			status: "active",
			metadata: JSON.stringify({ legacyKind: "telemetry-source", legacyId: source.id, signals: source.signals, isDefault: source.isDefault }),
		},
	});
}

export async function removeLegacyConnector(kind: "database-config" | "telemetry-source", id: string) {
	await prisma.connectorInstance.deleteMany({
		where: { id: kind === "database-config" ? databaseConnectorId(id) : telemetryConnectorId(id) },
	});
}

/** Backfill and return the current project's unified connector instances. */
export async function listProjectConnectorInstances(projectId: string) {
	const [databases, sources] = await Promise.all([
		prisma.databaseConfig.findMany({ where: { projectId } }),
		prisma.telemetrySource.findMany({ where: { projectId } }),
	]);
	await Promise.all([
		...databases.map(syncDatabaseConfigConnector),
		...sources.map(syncTelemetrySourceConnector),
	]);
	const connectors = await prisma.connectorInstance.findMany({
		where: { projectId },
		orderBy: [{ environment: "asc" }, { createdAt: "asc" }],
	});
	return connectors.map((connector) => {
		let metadata: Record<string, unknown> = {};
		try { metadata = JSON.parse(connector.metadata || "{}") || {}; } catch { /* keep defaults */ }
		const isDatasource = connector.category === "datasource";
		return {
			...connector,
			signals: isDatasource
				? (connector.type === "clickhouse"
					? "traces,logs,metrics,intelligence"
					: metadata.signals || "traces,logs,metrics")
				: "",
			isDefault: isDatasource && metadata.isDefault === true,
			hasSecret: !!connector.secretRef,
		};
	});
}
