import getMessage from "@/constants/messages";
import { getDBConfigByIdInternal, getDBConfigByUser } from "@/lib/db-config";
import { dataCollector } from "@/lib/platform/common";
import {
	DEFAULT_MODELS_BY_PROVIDER,
	DEFAULT_PROVIDERS,
} from "@/lib/platform/providers/default-models";
import {
	OPENLIT_PROVIDER_METADATA_TABLE_NAME,
	OPENLIT_PROVIDER_MODELS_TABLE_NAME,
} from "@/lib/platform/providers/table-details";
import prisma from "@/lib/prisma";
import asaw from "@/utils/asaw";
import { consoleLog } from "@/utils/log";

const MIGRATION_ID = "seed-orcarouter-provider";
const PROVIDER_ID = "orcarouter";

/**
 * Existing ClickHouse instances already ran the one-shot provider-metadata
 * and provider-models seeds, so they never pick up providers added to the
 * static registries later. Insert OrcaRouter (and only OrcaRouter) when it
 * is missing, without overwriting user-edited rows.
 */
export default async function SeedOrcaRouterProviderMigration(
	databaseConfigId?: string
) {
	const [, dbConfig] = await asaw(
		databaseConfigId
			? getDBConfigByIdInternal({ id: databaseConfigId })
			: getDBConfigByUser(true)
	);

	if (!dbConfig?.id) return { err: getMessage().DATABASE_CONFIG_NOT_FOUND };

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

	const provider = DEFAULT_PROVIDERS.find((p) => p.providerId === PROVIDER_ID);
	const models = DEFAULT_MODELS_BY_PROVIDER[PROVIDER_ID] || [];
	if (!provider) {
		return { err: getMessage().OPERATION_FAILED };
	}

	const { data: existingProviders, err: providerQueryErr } = await dataCollector(
		{
			query: `
				SELECT provider_id
				FROM ${OPENLIT_PROVIDER_METADATA_TABLE_NAME}
				WHERE provider_id = '${PROVIDER_ID}'
			`,
		},
		"query",
		dbConfig.id
	);
	if (providerQueryErr) {
		consoleLog(providerQueryErr);
		return { err: getMessage().OPERATION_FAILED };
	}

	if (!((existingProviders as { provider_id: string }[]) || []).length) {
		const { err: insertProviderErr } = await dataCollector(
			{
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
			"insert",
			dbConfig.id
		);
		if (insertProviderErr) {
			console.error("Error seeding OrcaRouter provider metadata:", insertProviderErr);
			return { err: getMessage().OPERATION_FAILED };
		}
	}

	const { data: existingModels, err: modelQueryErr } = await dataCollector(
		{
			query: `
				SELECT model_id
				FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
				WHERE provider = '${PROVIDER_ID}'
			`,
		},
		"query",
		dbConfig.id
	);
	if (modelQueryErr) {
		consoleLog(modelQueryErr);
		return { err: getMessage().OPERATION_FAILED };
	}

	const existingModelIds = new Set(
		((existingModels as { model_id: string }[]) || []).map((row) => row.model_id)
	);
	const toSeed = models
		.filter((model) => !existingModelIds.has(model.id))
		.map((model) => ({
			provider: PROVIDER_ID,
			model_id: model.id,
			display_name: model.displayName,
			model_type: "chat",
			context_window: model.contextWindow,
			input_price_per_m_token: model.inputPricePerMToken,
			output_price_per_m_token: model.outputPricePerMToken,
			cache_read_price_per_m_token: model.cacheReadPricePerMToken || 0,
			cache_creation_price_per_m_token: model.cacheCreationPricePerMToken || 0,
			capabilities: model.capabilities || [],
			is_default: true,
			created_by_user_id: "",
		}));

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
			console.error("Error seeding OrcaRouter models:", seedErr);
			return { err: getMessage().OPERATION_FAILED };
		}
	}

	await prisma.clickhouseMigrations.create({
		data: {
			databaseConfigId: dbConfig.id,
			clickhouseMigrationId: MIGRATION_ID,
		},
	});

	return { data: "OrcaRouter provider seed successful" };
}
