import { ProviderRegistry } from "@/lib/platform/providers/provider-registry";
import { consoleLog } from "@/utils/log";
import { getChatModelCostPerM, type ChatCostTokens } from "./chat-cost";

export type ModelCostCalculator = (tokens: ChatCostTokens) => number;

/**
 * Looks up the model's Manage Models prices once and returns a calculator for
 * them, so streaming callbacks can price usage synchronously. A model with no
 * prices costs 0 rather than a guessed rate. Without a database config id the
 * lookup uses the current one, as `ProviderRegistry.getBaseUrl` does.
 */
export async function getModelCostCalculator(
	provider: string,
	model: string,
	databaseConfigId?: string
): Promise<ModelCostCalculator> {
	const free: ModelCostCalculator = () => 0;
	if (!provider || !model) return free;

	try {
		const metadata = await ProviderRegistry.getModel(
			provider,
			model,
			databaseConfigId as string
		);
		if (!metadata) {
			consoleLog(
				`Model cost: '${model}' not found under provider '${provider}' in Manage Models`
			);
			return free;
		}
		const prices = {
			inputPricePerMToken: metadata.inputPricePerMToken,
			outputPricePerMToken: metadata.outputPricePerMToken,
			cacheReadPricePerMToken: metadata.cacheReadPricePerMToken,
			cacheCreationPricePerMToken: metadata.cacheCreationPricePerMToken,
		};
		return (tokens) =>
			getChatModelCostPerM(prices, tokens, { promptTokensIncludeCache: true });
	} catch (error) {
		consoleLog("Model cost lookup failed:", error);
		return free;
	}
}
