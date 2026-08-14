import { dataCollector } from "../common";
import { OPENLIT_CHAT_CONFIG_TABLE } from "./table-details";
import Sanitizer from "@/utils/sanitizer";
import { getSecretById } from "../vault";
import { isEncrypted } from "@/utils/crypto";

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

	const { data: secrets, err: secretErr } = await getSecretById(
		config.vaultId,
		databaseConfigId,
		false,
		{ logDecryptErrors: false }
	);

	if (secretErr || !secrets) {
		return { err: secretErr || "Failed to retrieve vault secrets" };
	}

	const secret = (secrets as any[])?.[0];

	if (!secret?.value) {
		return { err: "API key not found in vault. Please check your chat configuration." };
	}

	if (typeof secret.value === "string" && isEncrypted(secret.value)) {
		return {
			err:
				"Unable to decrypt the configured Chat API key. Re-save the selected Vault secret or set the same OPENLIT_VAULT_ENCRYPTION_KEY/NEXTAUTH_SECRET that was used to encrypt it.",
		};
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
