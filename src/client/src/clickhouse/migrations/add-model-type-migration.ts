import migrationHelper from "./migration-helper";
import { OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME } from "@/lib/platform/openground/table-details";

const MIGRATION_ID = "add-model-type-column";

export default async function AddModelTypeMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME} ADD COLUMN IF NOT EXISTS model_type String DEFAULT 'chat'`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
