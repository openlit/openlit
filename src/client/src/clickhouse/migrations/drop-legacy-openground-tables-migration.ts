import migrationHelper from "./migration-helper";
import {
	OPENLIT_OPENGROUND_CONFIG_TABLE_NAME,
	OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME,
} from "@/lib/platform/openground/table-details";

const MIGRATION_ID = "drop-legacy-openground-config-and-custom-models-tables";

/**
 * Drops the legacy openground-scoped tables once their data has been copied
 * into the independent openlit_providers / openlit_provider_models tables.
 *
 * Runs AFTER create-providers-migration. `DROP TABLE IF EXISTS` makes this
 * safe on fresh installs that never had the legacy tables.
 */
export default async function DropLegacyOpengroundTablesMigration(
	databaseConfigId?: string
) {
	const queries = [
		`DROP TABLE IF EXISTS ${OPENLIT_OPENGROUND_CONFIG_TABLE_NAME}`,
		`DROP TABLE IF EXISTS ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
