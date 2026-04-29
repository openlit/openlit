import { dataCollector } from "@/lib/platform/common";
import migrationHelper from "./migration-helper";
import { OPENLIT_PROVIDER_METADATA_TABLE_NAME } from "@/lib/platform/providers/table-details";
import { DEFAULT_PROVIDERS } from "@/lib/platform/providers/default-models";

const MIGRATION_ID = "create-provider-metadata-table";

/**
 * Creates the openlit_provider_metadata table and seeds it with the 14
 * built-in providers. After this migration, providers are fully editable
 * and new ones can be added via the UI or import API.
 */
export default async function CreateProviderMetadataMigration(
	databaseConfigId?: string
) {
	const createQuery = `
		CREATE TABLE IF NOT EXISTS ${OPENLIT_PROVIDER_METADATA_TABLE_NAME} (
			provider_id String,
			display_name String,
			description String DEFAULT '',
			requires_vault Boolean DEFAULT true,
			config_schema String DEFAULT '{}',
			is_default Boolean DEFAULT false,
			created_at DateTime DEFAULT now(),
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		PRIMARY KEY (provider_id)
		ORDER BY (provider_id);
	`;

	const seedValues = DEFAULT_PROVIDERS.map((p) => ({
		provider_id: p.providerId,
		display_name: p.displayName,
		description: p.description,
		requires_vault: p.requiresVault,
		config_schema: JSON.stringify(p.configSchema),
		is_default: true,
	}));

	const queries = [
		createQuery,
		{
			type: "insert" as const,
			table: OPENLIT_PROVIDER_METADATA_TABLE_NAME,
			values: seedValues,
		},
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
