import { intelligenceDataCollector } from "../common";
import { OPENLIT_CHAT_CONFIG_TABLE } from "./table-details";
import Sanitizer from "@/utils/sanitizer";
import getMessage from "@/constants/messages";
import {
	isChatProvider,
	OPENAI_COMPATIBLE_PROVIDER_ID,
} from "@/constants/chat-providers";
import { ProviderRegistry } from "@/lib/platform/providers/provider-registry";
import asaw from "@/utils/asaw";
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
	baseUrl?: string;
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

	const { data, err } = await intelligenceDataCollector({ query }, "query", databaseConfigId);

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

	const [baseUrlErr, baseUrl] = await asaw(
		ProviderRegistry.getBaseUrl(config.provider, databaseConfigId)
	);
	if (baseUrlErr) {
		return { err: baseUrlErr };
	}

	if (config.provider === OPENAI_COMPATIBLE_PROVIDER_ID) {
		if (!baseUrl) {
			return { err: getMessage().OPENAI_COMPATIBLE_BASE_URL_REQUIRED };
		}
		if (!config.vaultId) {
			return { data: { ...config, apiKey: "", baseUrl } };
		}
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
			baseUrl,
		},
	};
}

export async function clearChatConfigKey(
	provider: string,
	databaseConfigId: string
): Promise<{ err?: unknown }> {
	return intelligenceDataCollector(
		{
			query: `
				ALTER TABLE ${OPENLIT_CHAT_CONFIG_TABLE}
				UPDATE vault_id = ''
				WHERE provider = '${Sanitizer.sanitizeValue(provider)}'
				SETTINGS mutations_sync = 1
			`,
		},
		"exec",
		databaseConfigId
	);
}

export async function upsertChatConfig(
	config: ChatConfig,
	databaseConfigId?: string
): Promise<{ data?: string; err?: unknown }> {
	if (!isChatProvider(config.provider)) {
		return { err: getMessage().PROVIDER_EVALUATION_ONLY_ERROR };
	}
	const sanitizedProvider = Sanitizer.sanitizeValue(config.provider);
	const sanitizedModel = Sanitizer.sanitizeValue(config.model);
	const sanitizedVaultId = Sanitizer.sanitizeValue(config.vaultId);
	const sanitizedMeta = Sanitizer.sanitizeValue(config.meta || "{}");

	const { err } = await intelligenceDataCollector(
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
