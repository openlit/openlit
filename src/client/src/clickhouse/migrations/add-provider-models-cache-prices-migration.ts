import migrationHelper from "./migration-helper";
import { OPENLIT_PROVIDER_MODELS_TABLE_NAME } from "@/lib/platform/providers/table-details";

const MIGRATION_ID = "add-provider-models-cache-prices";

/**
 * Adds optional cache-read / cache-creation price columns to
 * openlit_provider_models so Manage Models and auto-pricing can bill
 * prompt-cache tokens at dedicated rates.
 */
export default async function AddProviderModelsCachePricesMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${OPENLIT_PROVIDER_MODELS_TABLE_NAME} ADD COLUMN IF NOT EXISTS cache_read_price_per_m_token Float64 DEFAULT 0 AFTER output_price_per_m_token`,
		`ALTER TABLE ${OPENLIT_PROVIDER_MODELS_TABLE_NAME} ADD COLUMN IF NOT EXISTS cache_creation_price_per_m_token Float64 DEFAULT 0 AFTER cache_read_price_per_m_token`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
