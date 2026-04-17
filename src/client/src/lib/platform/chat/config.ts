import { dataCollector } from "../common";
import { OPENLIT_CHAT_CONFIG_TABLE } from "./table-details";
import Sanitizer from "@/utils/sanitizer";
import { getSecrets } from "../vault";

export interface ChatConfig {
	id?: string;
	provider: string;
	model: string;
	vaultId: string;
	meta?: string;
}

export interface ChatConfigWithApiKey extends ChatConfig {
	apiKey: string;
}

export async function getChatConfig(
	databaseConfigId?: string
): Promise<{ data?: ChatConfig; err?: unknown }> {
	const query = `
		SELECT id, provider, model, vault_id AS vaultId, meta,
			created_at AS createdAt, updated_at AS updatedAt
		FROM ${OPENLIT_CHAT_CONFIG_TABLE} FINAL
		ORDER BY updated_at DESC
		LIMIT 1
	`;

	const { data, err } = await dataCollector({ query }, "query", databaseConfigId);

	if (err) {
		return { err };
	}

	const records = data as ChatConfig[];
	if (!records || records.length === 0) {
		return { data: undefined };
	}

	return { data: records[0] };
}

export async function getChatConfigWithApiKey(
	databaseConfigId?: string
): Promise<{ data?: ChatConfigWithApiKey; err?: unknown }> {
	const { data: config, err } = await getChatConfig(databaseConfigId);

	if (err || !config) {
		return { err: err || "Chat configuration not found. Please configure your AI provider in Chat Settings." };
	}

	const { data: secrets, err: secretErr } = await getSecrets(
		{ databaseConfigId },
		{ selectValue: true }
	);

	if (secretErr || !secrets) {
		return { err: secretErr || "Failed to retrieve vault secrets" };
	}

	const secret = (secrets as any[]).find(
		(s: any) => s.id === config.vaultId
	);

	if (!secret?.value) {
		return { err: "API key not found in vault. Please check your chat configuration." };
	}

	return {
		data: {
			...config,
			apiKey: secret.value,
		},
	};
}

export async function upsertChatConfig(
	config: ChatConfig,
	databaseConfigId?: string
): Promise<{ data?: string; err?: unknown }> {
	const sanitizedProvider = Sanitizer.sanitizeValue(config.provider);
	const sanitizedModel = Sanitizer.sanitizeValue(config.model);
	const sanitizedVaultId = Sanitizer.sanitizeValue(config.vaultId);
	const sanitizedMeta = Sanitizer.sanitizeValue(config.meta || "{}");

	const { err } = await dataCollector(
		{
			table: OPENLIT_CHAT_CONFIG_TABLE,
			values: [
				{
					provider: sanitizedProvider,
					model: sanitizedModel,
					vault_id: sanitizedVaultId,
					meta: sanitizedMeta,
				},
			],
		},
		"insert",
		databaseConfigId
	);

	if (err) {
		return { err };
	}

	return { data: "Chat configuration saved successfully" };
}
