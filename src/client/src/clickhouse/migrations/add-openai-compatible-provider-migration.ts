import migrationHelper from "./migration-helper";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@/constants/chat-providers";
import { DEFAULT_PROVIDERS } from "@/lib/platform/providers/default-models";
import { OPENLIT_PROVIDER_METADATA_TABLE_NAME } from "@/lib/platform/providers/table-details";

const MIGRATION_ID = "add-openai-compatible-provider";

/**
 * Adds the provider-level base URL and seeds the OpenAI-compatible provider on
 * instances that already ran the one-shot provider-metadata seed. Models and
 * pricing come from Manage Models, so no models are seeded.
 */
export default async function AddOpenAICompatibleProviderMigration(
	databaseConfigId?: string
) {
	const provider = DEFAULT_PROVIDERS.find(
		(p) => p.providerId === OPENAI_COMPATIBLE_PROVIDER_ID
	)!;

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries: [
			`ALTER TABLE ${OPENLIT_PROVIDER_METADATA_TABLE_NAME} ADD COLUMN IF NOT EXISTS base_url Nullable(String) AFTER config_schema`,
			{
				type: "insert",
				table: OPENLIT_PROVIDER_METADATA_TABLE_NAME,
				values: [
					{
						provider_id: provider.providerId,
						display_name: provider.displayName,
						description: provider.description,
						requires_vault: provider.requiresVault,
						config_schema: JSON.stringify(provider.configSchema),
						is_default: true,
					},
				],
			},
		],
	});

	return { migrationExist, queriesRun };
}
