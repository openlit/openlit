import { ProviderMetadata, ModelMetadata, ConfigField } from "@/types/openground";
import { dataCollector } from "@/lib/platform/common";
import Sanitizer from "@/utils/sanitizer";
import {
	OPENLIT_PROVIDER_MODELS_TABLE_NAME,
	OPENLIT_PROVIDER_METADATA_TABLE_NAME,
} from "./table-details";

// Re-export types for convenience
export type { ProviderMetadata, ModelMetadata, ConfigField };

type ProviderMetadataRow = {
	provider_id: string;
	display_name: string;
	description: string;
	requires_vault: boolean;
	config_schema: string;
	is_default: boolean;
};

function parseProviderRow(row: ProviderMetadataRow): Omit<ProviderMetadata, "supportedModels"> {
	let configSchema: ProviderMetadata["configSchema"] = {};
	try {
		configSchema = JSON.parse(row.config_schema || "{}");
	} catch {
		// keep empty
	}
	return {
		providerId: row.provider_id,
		displayName: row.display_name,
		description: row.description || "",
		requiresVault: !!row.requires_vault,
		configSchema,
	};
}

/**
 * Load all provider metadata rows from ClickHouse.
 */
async function loadAllProvidersFromDb(
	databaseConfigId: string
): Promise<Omit<ProviderMetadata, "supportedModels">[]> {
	try {
		const query = `
			SELECT
				provider_id,
				display_name,
				description,
				requires_vault,
				config_schema,
				is_default
			FROM ${OPENLIT_PROVIDER_METADATA_TABLE_NAME} FINAL
			ORDER BY is_default DESC, display_name ASC
		`;

		const { data } = await dataCollector({ query }, "query", databaseConfigId);
		return ((data as ProviderMetadataRow[]) || []).map(parseProviderRow);
	} catch (error) {
		console.error("Error loading provider metadata:", error);
		return [];
	}
}

async function loadProviderFromDb(
	providerId: string,
	databaseConfigId: string
): Promise<Omit<ProviderMetadata, "supportedModels"> | null> {
	try {
		const query = `
			SELECT
				provider_id,
				display_name,
				description,
				requires_vault,
				config_schema,
				is_default
			FROM ${OPENLIT_PROVIDER_METADATA_TABLE_NAME} FINAL
			WHERE provider_id = '${Sanitizer.sanitizeValue(providerId)}'
			LIMIT 1
		`;

		const { data } = await dataCollector({ query }, "query", databaseConfigId);
		const rows = (data as ProviderMetadataRow[]) || [];
		return rows.length > 0 ? parseProviderRow(rows[0]) : null;
	} catch (error) {
		console.error("Error loading provider:", providerId, error);
		return null;
	}
}

/**
 * Load all models for a database config from openlit_provider_models,
 * grouped by providerId.
 */
async function loadAllModelsFromDb(
	databaseConfigId: string
): Promise<Record<string, ModelMetadata[]>> {
	try {
		const query = `
			SELECT
				provider,
				model_id as id,
				display_name as displayName,
				model_type as modelType,
				context_window as contextWindow,
				input_price_per_m_token as inputPricePerMToken,
				output_price_per_m_token as outputPricePerMToken,
				capabilities
			FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
			ORDER BY provider, is_default DESC, created_at DESC
		`;

		const { data } = await dataCollector({ query }, "query", databaseConfigId);
		const rows = (data as any[]) || [];

		const grouped: Record<string, ModelMetadata[]> = {};
		for (const row of rows) {
			const provider = row.provider;
			if (!grouped[provider]) grouped[provider] = [];
			grouped[provider].push({
				id: row.id,
				displayName: row.displayName,
				modelType: row.modelType,
				contextWindow: Number(row.contextWindow) || 0,
				inputPricePerMToken: Number(row.inputPricePerMToken) || 0,
				outputPricePerMToken: Number(row.outputPricePerMToken) || 0,
				capabilities: row.capabilities || [],
			});
		}
		return grouped;
	} catch (error) {
		console.error("Error loading provider models:", error);
		return {};
	}
}

async function loadProviderModelsFromDb(
	providerId: string,
	databaseConfigId: string
): Promise<ModelMetadata[]> {
	try {
		const query = `
			SELECT
				model_id as id,
				display_name as displayName,
				model_type as modelType,
				context_window as contextWindow,
				input_price_per_m_token as inputPricePerMToken,
				output_price_per_m_token as outputPricePerMToken,
				capabilities
			FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
			WHERE provider = '${Sanitizer.sanitizeValue(providerId)}'
			ORDER BY is_default DESC, created_at DESC
		`;

		const { data } = await dataCollector({ query }, "query", databaseConfigId);
		return ((data as any[]) || []).map((row) => ({
			id: row.id,
			displayName: row.displayName,
			modelType: row.modelType,
			contextWindow: Number(row.contextWindow) || 0,
			inputPricePerMToken: Number(row.inputPricePerMToken) || 0,
			outputPricePerMToken: Number(row.outputPricePerMToken) || 0,
			capabilities: row.capabilities || [],
		}));
	} catch (error) {
		console.error("Error loading provider models for", providerId, error);
		return [];
	}
}

export class ProviderRegistry {
	/**
	 * Get all providers with their models loaded from the DB.
	 */
	static async getAvailableProviders(
		databaseConfigId: string
	): Promise<ProviderMetadata[]> {
		const [providers, modelsByProvider] = await Promise.all([
			loadAllProvidersFromDb(databaseConfigId),
			loadAllModelsFromDb(databaseConfigId),
		]);

		return providers.map((provider) => ({
			...provider,
			supportedModels: modelsByProvider[provider.providerId] || [],
		}));
	}

	/**
	 * Get a specific provider with models from DB.
	 */
	static async getProviderById(
		providerId: string,
		databaseConfigId: string
	): Promise<ProviderMetadata | null> {
		const provider = await loadProviderFromDb(providerId, databaseConfigId);
		if (!provider) return null;

		const models = await loadProviderModelsFromDb(providerId, databaseConfigId);
		return { ...provider, supportedModels: models };
	}

	/**
	 * Search providers by name or description.
	 */
	static async searchProviders(
		query: string,
		databaseConfigId: string
	): Promise<ProviderMetadata[]> {
		const allProviders = await this.getAvailableProviders(databaseConfigId);
		const lowerQuery = query.toLowerCase();
		return allProviders.filter(
			(p) =>
				p.displayName.toLowerCase().includes(lowerQuery) ||
				p.description?.toLowerCase().includes(lowerQuery)
		);
	}

	/**
	 * Get models for a specific provider from DB.
	 */
	static async getProviderModels(
		providerId: string,
		databaseConfigId: string
	): Promise<ModelMetadata[]> {
		return loadProviderModelsFromDb(providerId, databaseConfigId);
	}

	/**
	 * Get a specific model (for e.g. cost calculation).
	 */
	static async getModel(
		providerId: string,
		modelId: string,
		databaseConfigId: string
	): Promise<ModelMetadata | null> {
		const models = await loadProviderModelsFromDb(providerId, databaseConfigId);
		return models.find((m) => m.id === modelId) || null;
	}
}
