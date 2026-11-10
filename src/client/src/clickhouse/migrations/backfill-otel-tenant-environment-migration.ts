import { dataCollector } from "@/lib/platform/common";
import { getDBConfigByIdInternal, getDBConfigByUser } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import prisma from "@/lib/prisma";
import { consoleLog } from "@/utils/log";

const MIGRATION_ID = "backfill-otel-tenant-environment";

// Literal table names: this module is loaded from db-config -> migrations while
// `@/lib/platform/common` is still initializing, so importing OTEL_* constants
// there throws "Cannot access before initialization".
const OTEL_RESOURCE_TABLES = [
	"otel_traces",
	"otel_logs",
	"otel_metrics_gauge",
	"otel_metrics_sum",
	"otel_metrics_histogram",
	"otel_metrics_summary",
	"otel_metrics_exponential_histogram",
];

function escapeClickHouseString(value: string) {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isMissingTable(err: unknown) {
	const message = String(err || "").toLowerCase();
	return (
		message.includes("unknown table") ||
		message.includes("doesn't exist") ||
		message.includes("does not exist")
	);
}

export default async function BackfillOtelTenantEnvironmentMigration(
	databaseConfigId?: string
) {
	let err, dbConfig;
	if (databaseConfigId) {
		[err, dbConfig] = await asaw(getDBConfigByIdInternal({ id: databaseConfigId }));
	} else {
		[err, dbConfig] = await asaw(getDBConfigByUser(true));
	}

	if (err || !dbConfig?.id) return { migrationExist: false, queriesRun: false };

	const [, migrationExist] = await asaw(
		prisma.clickhouseMigrations.findFirst({
			where: {
				AND: {
					databaseConfigId: dbConfig.id as string,
					clickhouseMigrationId: MIGRATION_ID,
				},
			},
		})
	);

	if (migrationExist?.id) {
		return { migrationExist: true, queriesRun: false };
	}

	const environment =
		typeof dbConfig.environment === "string" && dbConfig.environment.trim()
			? dbConfig.environment.trim()
			: "production";

	// Unstamped rows in a store shared by several tenants cannot be attributed
	// to any one of them; stamping them with this config's tenant would hand
	// another tenant's data to this one.
	const [, sharingConfigs] = await asaw(
		prisma.databaseConfig.findMany({
			where: {
				host: dbConfig.host,
				port: dbConfig.port,
				database: dbConfig.database,
				NOT: { id: dbConfig.id },
			},
			select: { projectId: true, environment: true },
		})
	);
	const sharedAcrossTenants = (sharingConfigs || []).some(
		(other: { projectId: string | null; environment: string | null }) =>
			(other.projectId || null) !== (dbConfig.projectId || null) ||
			(other.environment || "production").trim() !== environment
	);
	if (sharedAcrossTenants) {
		consoleLog(
			`OTLP tenant environment backfill skipped for ${dbConfig.id}: ClickHouse store is shared with another project or environment`
		);
		await asaw(
			prisma.clickhouseMigrations.create({
				data: {
					databaseConfigId: dbConfig.id,
					clickhouseMigrationId: MIGRATION_ID,
				},
			})
		);
		return { migrationExist: false, queriesRun: false };
	}
	let organisationId = "";
	if (dbConfig.projectId) {
		const project = await prisma.project.findUnique({
			where: { id: dbConfig.projectId },
			select: { organisationId: true },
		});
		organisationId = project?.organisationId || "";
	}

	const pairs = [
		["organisation.environment.name", environment],
		...(organisationId
			? [["openlit.organisation.id", organisationId] as const]
			: []),
		...(dbConfig.projectId
			? [["openlit.project.id", dbConfig.projectId] as const]
			: []),
	];
	const mapLiteral = pairs
		.map(
			([key, value]) =>
				`'${escapeClickHouseString(key)}', '${escapeClickHouseString(value)}'`
		)
		.join(", ");

	const whereParts = [
		`empty(ifNull(ResourceAttributes['organisation.environment.name'], ''))`,
	];
	if (organisationId) {
		whereParts.push(
			`empty(ifNull(ResourceAttributes['openlit.organisation.id'], ''))`
		);
	}
	if (dbConfig.projectId) {
		whereParts.push(
			`empty(ifNull(ResourceAttributes['openlit.project.id'], ''))`
		);
	}
	const where = `(${whereParts.join("\n\t\tOR ")})`;

	try {
		for (const table of OTEL_RESOURCE_TABLES) {
			const { err: updateErr } = await dataCollector(
				{
					query: `
						ALTER TABLE ${table}
						UPDATE ResourceAttributes = mapUpdate(ifNull(ResourceAttributes, map()), map(${mapLiteral}))
						WHERE ${where}
					`,
				},
				"exec",
				dbConfig.id
			);
			if (updateErr && !isMissingTable(updateErr)) {
				consoleLog(
					`OTLP tenant environment backfill failed on ${table}: ${updateErr}`
				);
				return { migrationExist: false, queriesRun: false, err: updateErr };
			}
		}

		await asaw(
			prisma.clickhouseMigrations.create({
				data: {
					databaseConfigId: dbConfig.id,
					clickhouseMigrationId: MIGRATION_ID,
				},
			})
		);
		return { migrationExist: false, queriesRun: true };
	} catch (migrationError) {
		consoleLog(`OTLP tenant environment backfill error: ${migrationError}`);
		return { migrationExist: false, queriesRun: false, err: migrationError };
	}
}
