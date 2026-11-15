import migrationHelper from "./migration-helper";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@/constants/chat-providers";
import { DEFAULT_PROVIDERS } from "@/lib/platform/providers/default-models";
import { OPENLIT_PROVIDER_METADATA_TABLE_NAME } from "@/lib/platform/providers/table-details";
import { escapeClickHouseString } from "@/lib/clickhouse-escape";

const MIGRATION_ID = "add-openai-compatible-provider";

/**
 * Adds the provider-level base URL and seeds the OpenAI-compatible provider on
 * instances that already ran the one-shot provider-metadata seed. Models and
 * pricing come from Manage Models, so no models are seeded.
 *
 * Users could already create providers with any ID. The table replaces rows
 * by `provider_id`, so an unconditional insert would overwrite a provider a
 * user had named `openai-compatible`. The seed only inserts when no row has
 * that ID; an existing one is kept as it is, with its models and pricing.
 */
export default async function AddOpenAICompatibleProviderMigration(
	databaseConfigId?: string
) {
	const provider = DEFAULT_PROVIDERS.find(
		(p) => p.providerId === OPENAI_COMPATIBLE_PROVIDER_ID
	)!;
	const text = (value: string) => `'${escapeClickHouseString(value)}'`;

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries: [
			`ALTER TABLE ${OPENLIT_PROVIDER_METADATA_TABLE_NAME} ADD COLUMN IF NOT EXISTS base_url Nullable(String) AFTER config_schema`,
			`INSERT INTO ${OPENLIT_PROVIDER_METADATA_TABLE_NAME}
				(provider_id, display_name, description, requires_vault, config_schema, is_default)
			SELECT
				${text(provider.providerId)},
				${text(provider.displayName)},
				${text(provider.description)},
				${provider.requiresVault ? "true" : "false"},
				${text(JSON.stringify(provider.configSchema))},
				true
			WHERE (
				SELECT count()
				FROM ${OPENLIT_PROVIDER_METADATA_TABLE_NAME}
				WHERE provider_id = ${text(provider.providerId)}
			) = 0`,
		],
	});

	return { migrationExist, queriesRun };
}
