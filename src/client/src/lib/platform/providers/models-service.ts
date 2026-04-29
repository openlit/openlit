import { dataCollector } from "@/lib/platform/common";
import Sanitizer from "@/utils/sanitizer";
import { OPENLIT_PROVIDER_MODELS_TABLE_NAME } from "./table-details";
import { CustomModel, CustomModelInput, ModelMetadata } from "@/types/openground";

/**
 * Model management service for openlit_provider_models.
 *
 * All models (seeded defaults + user-created) live in a single table per
 * ClickHouse instance. Every model returned by this service is editable/deletable.
 */

/**
 * Get all models for a database config, optionally filtered by provider.
 */
export async function getCustomModels(
	userId: string,
	databaseConfigId: string,
	provider?: string
): Promise<{ data?: CustomModel[]; err?: string }> {
	const whereConditions: string[] = [];

	if (provider) {
		whereConditions.push(`provider = '${Sanitizer.sanitizeValue(provider)}'`);
	}

	const whereClause = whereConditions.length > 0
		? `WHERE ${whereConditions.join(" AND ")}`
		: "";

	const query = `
		SELECT
			toString(id) as id,
			model_id,
			provider,
			display_name as displayName,
			model_type as modelType,
			context_window as contextWindow,
			input_price_per_m_token as inputPricePerMToken,
			output_price_per_m_token as outputPricePerMToken,
			capabilities,
			is_default as isDefault
		FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
		${whereClause}
		ORDER BY provider, is_default DESC, created_at DESC
	`;

	const { data, err } = await dataCollector(
		{ query },
		"query",
		databaseConfigId
	);

	if (err) {
		return { err: err as string };
	}

	return { data: (data as CustomModel[]) || [] };
}

/**
 * Get all models grouped by provider.
 */
export async function getCustomModelsGroupedByProvider(
	userId: string,
	databaseConfigId: string
): Promise<{ data?: Record<string, CustomModel[]>; err?: string }> {
	const { data: models, err } = await getCustomModels(userId, databaseConfigId);

	if (err) {
		return { err };
	}

	const grouped: Record<string, CustomModel[]> = {};
	(models || []).forEach((model) => {
		if (!grouped[model.provider!]) {
			grouped[model.provider!] = [];
		}
		grouped[model.provider!].push(model);
	});

	return { data: grouped };
}

/**
 * Create a new model.
 */
export async function createCustomModel(
	userId: string,
	databaseConfigId: string,
	input: CustomModelInput
): Promise<{ data?: CustomModel; err?: string }> {
	if (!input.provider || !input.model_id || !input.displayName) {
		return { err: "Provider, model ID, and display name are required" };
	}

	const { err } = await dataCollector(
		{
			table: OPENLIT_PROVIDER_MODELS_TABLE_NAME,
			values: [
				{
					provider: input.provider,
					model_id: input.model_id,
					display_name: input.displayName,
					model_type: input.modelType || "chat",
					context_window: input.contextWindow || 4096,
					input_price_per_m_token: input.inputPricePerMToken || 0,
					output_price_per_m_token: input.outputPricePerMToken || 0,
					capabilities: input.capabilities || [],
					is_default: false,
					created_by_user_id: userId,
				},
			],
		},
		"insert",
		databaseConfigId
	);

	if (err) {
		return { err: err as string };
	}

	const selectQuery = `
		SELECT
			toString(id) as id,
			model_id,
			provider,
			display_name as displayName,
			model_type as modelType,
			context_window as contextWindow,
			input_price_per_m_token as inputPricePerMToken,
			output_price_per_m_token as outputPricePerMToken,
			capabilities,
			is_default as isDefault
		FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
		WHERE provider = '${Sanitizer.sanitizeValue(input.provider)}'
		  AND model_id = '${Sanitizer.sanitizeValue(input.model_id)}'
		ORDER BY created_at DESC
		LIMIT 1
	`;

	const { data: newModel, err: selectErr } = await dataCollector(
		{ query: selectQuery },
		"query",
		databaseConfigId
	);

	if (selectErr) {
		return { err: selectErr as string };
	}

	return { data: (newModel as any[])?.[0] as CustomModel };
}

/**
 * Update an existing model. Matches on the (provider, model_id) composite key.
 */
export async function updateCustomModel(
	userId: string,
	databaseConfigId: string,
	id: string,
	input: Partial<CustomModelInput>
): Promise<{ data?: boolean; err?: string }> {
	const updateFields: string[] = [];

	if (input.displayName !== undefined) {
		updateFields.push(`display_name = '${Sanitizer.sanitizeValue(input.displayName)}'`);
	}
	if (input.modelType !== undefined) {
		updateFields.push(`model_type = '${Sanitizer.sanitizeValue(input.modelType)}'`);
	}
	if (input.contextWindow !== undefined) {
		updateFields.push(`context_window = ${input.contextWindow}`);
	}
	if (input.inputPricePerMToken !== undefined) {
		updateFields.push(`input_price_per_m_token = ${input.inputPricePerMToken}`);
	}
	if (input.outputPricePerMToken !== undefined) {
		updateFields.push(`output_price_per_m_token = ${input.outputPricePerMToken}`);
	}
	if (input.capabilities !== undefined) {
		const capabilitiesArray = input.capabilities
			.map((c) => `'${Sanitizer.sanitizeValue(c)}'`)
			.join(", ");
		updateFields.push(`capabilities = [${capabilitiesArray}]`);
	}

	updateFields.push(`updated_at = now()`);

	if (updateFields.length === 0) {
		return { err: "No fields to update" };
	}

	const updateQuery = `
		ALTER TABLE ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
		UPDATE ${updateFields.join(", ")}
		WHERE (toString(id) = '${Sanitizer.sanitizeValue(id)}' OR model_id = '${Sanitizer.sanitizeValue(id)}')
	`;

	const { err } = await dataCollector(
		{ query: updateQuery },
		"exec",
		databaseConfigId
	);

	if (err) {
		return { err: err as string };
	}

	return { data: true };
}

/**
 * Delete a model.
 */
export async function deleteCustomModel(
	userId: string,
	databaseConfigId: string,
	id: string
): Promise<{ data?: boolean; err?: string }> {
	const deleteQuery = `
		DELETE FROM ${OPENLIT_PROVIDER_MODELS_TABLE_NAME}
		WHERE (toString(id) = '${Sanitizer.sanitizeValue(id)}' OR model_id = '${Sanitizer.sanitizeValue(id)}')
	`;

	const { err } = await dataCollector(
		{ query: deleteQuery },
		"exec",
		databaseConfigId
	);

	if (err) {
		return { err: err as string };
	}

	return { data: true };
}

/**
 * Get models for a provider (used when merging with provider metadata).
 */
export async function getCustomModelsForProvider(
	userId: string,
	databaseConfigId: string,
	providerId: string
): Promise<{ data?: ModelMetadata[]; err?: string }> {
	const { data: models, err } = await getCustomModels(
		userId,
		databaseConfigId,
		providerId
	);

	if (err) {
		return { err };
	}

	const transformed = (models || []).map((model) => ({
		id: model.model_id,
		displayName: model.displayName,
		contextWindow: model.contextWindow,
		inputPricePerMToken: model.inputPricePerMToken,
		outputPricePerMToken: model.outputPricePerMToken,
		capabilities: model.capabilities,
	}));

	return { data: transformed };
}
