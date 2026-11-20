/**
 * LLM providers Trustabl `enrich` supports, and their keys in Vault.
 *
 * Keys are looked up by the env var name Trustabl reads (for example
 * `ANTHROPIC_API_KEY`) among the current user's Vault secrets. Listing never
 * reads secret values; only a run resolves the value, inside the request.
 */

import { getSecrets } from "@/lib/platform/vault";
import { DEFAULT_MODELS_BY_PROVIDER } from "@/lib/platform/providers/default-models";
import { SCANNER_ENRICH_KEY_MISSING } from "@/constants/messages/en";
import { SCANNER_ENRICH_PROVIDERS, scannerEnrichProviderEnvKey } from "./enrich-params";
import type { ScannerEnrichProvider } from "./types";

export { SCANNER_ENRICH_PROVIDERS };

export type ScannerEnrichProviderInfo = (typeof SCANNER_ENRICH_PROVIDERS)[number] & {
	hasKey: boolean;
	models: string[];
};

const NON_CHAT_MODEL = /embed|tts|whisper|dall-e|moderation/i;

/** Chat models from OpenLIT's built-in catalog, newest first. */
export function scannerEnrichModels(provider: ScannerEnrichProvider): string[] {
	return (DEFAULT_MODELS_BY_PROVIDER[provider] || [])
		.filter((model) => (!model.modelType || model.modelType === "chat") && !NON_CHAT_MODEL.test(model.id))
		.map((model) => model.id)
		.reverse();
}

async function vaultHasKey(key: string): Promise<boolean> {
	try {
		const result = await getSecrets({ key });
		return Array.isArray(result?.data) && result.data.length > 0;
	} catch {
		return false;
	}
}

export async function listScannerEnrichProviders(): Promise<ScannerEnrichProviderInfo[]> {
	return Promise.all(
		SCANNER_ENRICH_PROVIDERS.map(async (provider) => ({
			...provider,
			hasKey: await vaultHasKey(provider.envKey),
			models: scannerEnrichModels(provider.id),
		}))
	);
}

export async function resolveScannerEnrichProviderKey(
	provider: ScannerEnrichProvider
): Promise<string> {
	const envKey = scannerEnrichProviderEnvKey(provider);
	let rows: { value?: unknown }[] = [];
	try {
		const result = await getSecrets({ key: envKey }, { selectValue: true });
		rows = Array.isArray(result?.data) ? (result.data as { value?: unknown }[]) : [];
	} catch {
		rows = [];
	}
	const value = rows
		.map((row) => (typeof row.value === "string" ? row.value.trim() : ""))
		.find(Boolean);
	if (!value) throw new Error(SCANNER_ENRICH_KEY_MISSING(envKey));
	return value;
}
