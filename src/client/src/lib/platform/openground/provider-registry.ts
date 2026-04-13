import { ProviderMetadata, ModelMetadata, ConfigField } from "@/types/openground";
import { dataCollector } from "@/lib/platform/common";
import Sanitizer from "@/utils/sanitizer";
import { OPENLIT_PROVIDER_MODELS_TABLE_NAME } from "./table-details";

// Re-export types for convenience
export type { ProviderMetadata, ModelMetadata, ConfigField };

/**
 * Static provider metadata — structural information only (name, description,
 * configSchema, vault requirement). The list of supported models is NO LONGER
 * stored here; models live in the openlit_provider_models ClickHouse table and
 * are fully editable via the manage-models UI.
 */
type StaticProviderMetadata = Omit<ProviderMetadata, "supportedModels">;

const PROVIDER_METADATA: Record<string, StaticProviderMetadata> = {
	openai: {
		providerId: "openai",
		displayName: "OpenAI",
		description: "GPT models from OpenAI",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature (0 = deterministic, 2 = very random)" },
			maxTokens: { min: 1, max: 16000, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	anthropic: {
		providerId: "anthropic",
		displayName: "Anthropic",
		description: "Claude models from Anthropic",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 1, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 8096, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	google: {
		providerId: "google",
		displayName: "Google AI",
		description: "Gemini models from Google",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 8192, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 0.95, description: "Nucleus sampling threshold" },
		},
	},
	mistral: {
		providerId: "mistral",
		displayName: "Mistral AI",
		description: "Mistral and Mixtral models",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 1, step: 0.1, default: 0.7, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 8192, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	groq: {
		providerId: "groq",
		displayName: "Groq",
		description: "Ultra-fast inference for open source models",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 32768, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	perplexity: {
		providerId: "perplexity",
		displayName: "Perplexity",
		description: "Models with online search capabilities",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 0.2, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 4096, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 0.9, description: "Nucleus sampling threshold" },
		},
	},
	azure: {
		providerId: "azure",
		displayName: "Azure OpenAI",
		description: "OpenAI models via Azure",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 16000, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	cohere: {
		providerId: "cohere",
		displayName: "Cohere",
		description: "Command models with RAG capabilities",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 5, step: 0.1, default: 0.3, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 4096, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 0.99, step: 0.01, default: 0.75, description: "Nucleus sampling threshold" },
		},
	},
	together: {
		providerId: "together",
		displayName: "Together AI",
		description: "Fast inference for open source models",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 1, step: 0.1, default: 0.7, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 8192, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 0.7, description: "Nucleus sampling threshold" },
		},
	},
	fireworks: {
		providerId: "fireworks",
		displayName: "Fireworks AI",
		description: "Production-ready LLM inference",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 16384, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	deepseek: {
		providerId: "deepseek",
		displayName: "DeepSeek",
		description: "Advanced reasoning and coding models",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 4096, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	xai: {
		providerId: "xai",
		displayName: "xAI",
		description: "Grok models with real-time knowledge",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 0, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 131072, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	huggingface: {
		providerId: "huggingface",
		displayName: "Hugging Face",
		description: "Open source models via Inference API",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 0.7, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 2048, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 0.95, description: "Nucleus sampling threshold" },
		},
	},
	replicate: {
		providerId: "replicate",
		displayName: "Replicate",
		description: "Run open source models in the cloud",
		requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 5, step: 0.01, default: 0.75, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 4096, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.01, default: 0.9, description: "Nucleus sampling threshold" },
		},
	},
};

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
	 * Get provider metadata only (no models). For UI lists that don't need models.
	 */
	static getProviderMetadata(
		providerId: string
	): StaticProviderMetadata | null {
		return PROVIDER_METADATA[providerId] || null;
	}

	static getAllProviderMetadata(): StaticProviderMetadata[] {
		return Object.values(PROVIDER_METADATA);
	}

	/**
	 * Get all providers with their models loaded from the DB.
	 */
	static async getAvailableProviders(
		databaseConfigId: string
	): Promise<ProviderMetadata[]> {
		const modelsByProvider = await loadAllModelsFromDb(databaseConfigId);

		return Object.values(PROVIDER_METADATA).map((provider) => ({
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
		const provider = PROVIDER_METADATA[providerId];
		if (!provider) return null;

		const models = await loadProviderModelsFromDb(providerId, databaseConfigId);
		return {
			...provider,
			supportedModels: models,
		};
	}

	/**
	 * Search providers by name or description (structural search — does not search models).
	 */
	static async searchProviders(
		query: string,
		databaseConfigId: string
	): Promise<ProviderMetadata[]> {
		const lowerQuery = query.toLowerCase();
		const matched = Object.values(PROVIDER_METADATA).filter(
			(provider) =>
				provider.displayName.toLowerCase().includes(lowerQuery) ||
				provider.description?.toLowerCase().includes(lowerQuery)
		);

		const modelsByProvider = await loadAllModelsFromDb(databaseConfigId);
		return matched.map((provider) => ({
			...provider,
			supportedModels: modelsByProvider[provider.providerId] || [],
		}));
	}

	/**
	 * Get models for a specific provider from DB.
	 */
	static async getProviderModels(
		providerId: string,
		databaseConfigId: string
	): Promise<ModelMetadata[]> {
		if (!PROVIDER_METADATA[providerId]) return [];
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
