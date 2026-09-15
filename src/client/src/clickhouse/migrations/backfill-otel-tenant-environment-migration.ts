import {
	OTEL_LOGS_TABLE_NAME,
	OTEL_METRICS_EXPONENTIAL_HISTOGRAM_TABLE_NAME,
	OTEL_METRICS_GAUGE_TABLE_NAME,
	OTEL_METRICS_HISTOGRAM_TABLE_NAME,
	OTEL_METRICS_SUM_TABLE_NAME,
	OTEL_METRICS_SUMMARY_TABLE_NAME,
	OTEL_TRACES_TABLE_NAME,
	dataCollector,
} from "@/lib/platform/common";
import { getDBConfigByIdInternal, getDBConfigByUser } from "@/lib/db-config";
import asaw from "@/utils/asaw";
import prisma from "@/lib/prisma";
import { consoleLog } from "@/utils/log";

const MIGRATION_ID = "backfill-otel-tenant-environment";

const OTEL_RESOURCE_TABLES = [
	OTEL_TRACES_TABLE_NAME,
	OTEL_LOGS_TABLE_NAME,
	OTEL_METRICS_GAUGE_TABLE_NAME,
	OTEL_METRICS_SUM_TABLE_NAME,
	OTEL_METRICS_HISTOGRAM_TABLE_NAME,
	OTEL_METRICS_SUMMARY_TABLE_NAME,
	OTEL_METRICS_EXPONENTIAL_HISTOGRAM_TABLE_NAME,
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
	let organisationId = "";
	if (dbConfig.projectId) {
		const project = await prisma.project.findUnique({
			where: { id: dbConfig.projectId },
			select: { organisationId: true },
		});
		organisationId = project?.organisationId || "";
	}

	const pairs = [
		["deployment.environment", environment],
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

	const where = `(
		empty(ifNull(ResourceAttributes['deployment.environment'], ''))
		OR lower(ResourceAttributes['deployment.environment']) IN ('default', 'default_environment', 'local')
	)`;

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
