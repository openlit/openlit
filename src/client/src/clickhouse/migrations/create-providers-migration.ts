import { dataCollector } from "@/lib/platform/common";
import getMessage from "@/constants/messages";
import prisma from "@/lib/prisma";
import asaw from "@/utils/asaw";
import { getDBConfigById, getDBConfigByUser } from "@/lib/db-config";
import {
	OPENLIT_PROVIDERS_TABLE_NAME,
	OPENLIT_PROVIDER_MODELS_TABLE_NAME,
} from "@/lib/platform/providers/table-details";
import {
	OPENLIT_OPENGROUND_CONFIG_TABLE_NAME,
	OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME,
} from "@/lib/platform/openground/table-details";
import { DEFAULT_MODELS_BY_PROVIDER } from "@/lib/platform/providers/default-models";
import { consoleLog } from "@/utils/log";

const MIGRATION_ID = "create-providers-and-provider-models-tables";

/**
 * Creates the new independent provider management tables:
 *  - openlit_providers — provider API key configs
 *  - openlit_provider_models — ALL models (seeded defaults + user-created)
 *
 * Each ClickHouse instance is its own scope, so no database_config_id column
 * is needed inside these tables — the dataCollector routes to the right
 * ClickHouse via the databaseConfigId argument.
 *
 * On first run, copies data from the legacy openground-scoped tables and seeds
 * default (built-in) models from the static registry so all models are editable.
 */
export default async function CreateProvidersMigration(databaseConfigId?: string) {
	const [, dbConfig] = await asaw(
		databaseConfigId
			? getDBConfigById({ id: databaseConfigId })
			: getDBConfigByUser(true)
	);

	if (!dbConfig?.id) return { err: getMessage().DATABASE_CONFIG_NOT_FOUND };

	// Check if migration already ran
	const [, migrationExist] = await asaw(
		prisma.clickhouseMigrations.findFirst({
			where: {
				AND: {
					databaseConfigId: dbConfig.id,
					clickhouseMigrationId: MIGRATION_ID,
				},
			},
		})
	);

	if (migrationExist?.id) {
		return { migrationExist: true };
	}

	// 1. Create openlit_providers (provider configs / API key associations)
	const providersTableQuery = `
		CREATE TABLE IF NOT EXISTS ${OPENLIT_PROVIDERS_TABLE_NAME} (
			id UUID DEFAULT generateUUIDv4(),
			user_id String,
			provider String,
			vault_id String,
			model_id Nullable(String),
			is_active Boolean DEFAULT true,
			created_at DateTime DEFAULT now(),
			updated_at DateTime DEFAULT now(),

			INDEX id_index (id) TYPE bloom_filter GRANULARITY 1,
			INDEX provider_index (provider) TYPE bloom_filter GRANULARITY 1,
			INDEX active_index (is_active) TYPE bloom_filter GRANULARITY 1
		) ENGINE = MergeTree()
		ORDER BY (user_id, provider);
	`;

	// 2. Create openlit_provider_models (ALL models — seeded defaults + user-created)
	const modelsTableQuery = `
		CREATE TABLE IF NOT EXISTS ${OPENLIT_PROVIDER_MODELS_TABLE_NAME} (
			id UUID DEFAULT generateUUIDv4(),
			provider String,
			model_id String,
			display_name String,
			model_type String DEFAULT 'chat',
			context_window UInt32 DEFAULT 4096,
			input_price_per_m_token Float64 DEFAULT 0,
			output_price_per_m_token Float64 DEFAULT 0,
			capabilities Array(String) DEFAULT [],
			is_default Boolean DEFAULT false,

			created_by_user_id String DEFAULT '',
			created_at DateTime DEFAULT now(),
			updated_at DateTime DEFAULT now()
		) ENGINE = MergeTree()
		PRIMARY KEY (provider, model_id)
		ORDER BY (provider, model_id, created_at);
	`;

	const createResults = await Promise.all([
		dataCollector({ query: providersTableQuery }, "exec", dbConfig.id),
		dataCollector({ query: modelsTableQuery }, "exec", dbConfig.id),
	]);

	const createErrors = createResults.filter((res) => res.err);
	if (createErrors.length > 0) {
		console.error("Providers migration create errors:", createErrors);
		return { err: getMessage().OPERATION_FAILED };
	}

	// 3. Copy existing data from legacy openground_configs -> openlit_providers
	try {
		const copyConfigsQuery = `
			INSERT INTO ${OPENLIT_PROVIDERS_TABLE_NAME}
				(id, user_id, provider, vault_id, model_id, is_active, created_at, updated_at)
			SELECT id, user_id, provider, vault_id, model_id, is_active, created_at, updated_at
			FROM ${OPENLIT_OPENGROUND_CONFIG_TABLE_NAME}
		`;
		await dataCollector({ query: copyConfigsQuery }, "exec", dbConfig.id);
	} catch (e) {
		consoleLog("Legacy openground_configs not found or empty — skipping copy");
	}

	// 4. Copy existing custom models from legacy custom_models -> openlit_provider_models
	try {
		const copyModelsQuery = `
			INSERT INTO ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
				(id, provider, model_id, display_name, model_type, context_window,
				 input_price_per_m_token, output_price_per_m_token, capabilities,
				 is_default, created_by_user_id, created_at, updated_at)
			SELECT
				id, provider, model_id, display_name,
				COALESCE(model_type, 'chat') as model_type,
				context_window, input_price_per_m_token, output_price_per_m_token,
				capabilities,
				false as is_default,
				created_by_user_id, created_at, updated_at
			FROM ${OPENLIT_OPENGROUND_CUSTOM_MODELS_TABLE_NAME}
		`;
		await dataCollector({ query: copyModelsQuery }, "exec", dbConfig.id);
	} catch (e) {
		consoleLog("Legacy openground_custom_models not found or empty — skipping copy");
	}

	// 5. Seed default models from the static registry.
	//    Skip any (provider, model_id) that already exists (user may have copied one in step 4).
	const defaultModelValues: Record<string, unknown>[] = [];
	for (const [provider, models] of Object.entries(DEFAULT_MODELS_BY_PROVIDER)) {
		for (const model of models) {
			defaultModelValues.push({
				provider,
				model_id: model.id,
				display_name: model.displayName,
				model_type: "chat",
				context_window: model.contextWindow,
				input_price_per_m_token: model.inputPricePerMToken,
				output_price_per_m_token: model.outputPricePerMToken,
				capabilities: model.capabilities || [],
				is_default: true,
				created_by_user_id: "",
			});
		}
	}

	const existingQuery = `
		SELECT provider, model_id
		FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
	`;
	const { data: existingRows } = await dataCollector(
		{ query: existingQuery },
		"query",
		dbConfig.id
	);

	const existingKeys = new Set(
		((existingRows as any[]) || []).map((r) => `${r.provider}::${r.model_id}`)
	);

	const toSeed = defaultModelValues.filter(
		(m) => !existingKeys.has(`${m.provider}::${m.model_id}`)
	);

	if (toSeed.length > 0) {
		const { err: seedErr } = await dataCollector(
			{
				table: OPENLIT_PROVIDER_MODELS_TABLE_NAME,
				values: toSeed,
			},
			"insert",
			dbConfig.id
		);

		if (seedErr) {
			console.error("Error seeding default models:", seedErr);
			return { err: getMessage().OPERATION_FAILED };
		}
	}

	// Record migration success
	await prisma.clickhouseMigrations.create({
		data: {
			databaseConfigId: dbConfig.id,
			clickhouseMigrationId: MIGRATION_ID,
		},
	});

	return { data: "Providers migration successful" };
}
