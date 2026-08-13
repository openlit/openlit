/**
 * Cache-aware chat cost calculation using Manage Models per-million prices.
 * Mirrors SDK get_chat_model_cost / OpenLitHelper.getChatModelCost semantics.
 */

export type PerMModelPrices = {
	inputPricePerMToken: number;
	outputPricePerMToken: number;
	cacheReadPricePerMToken?: number;
	cacheCreationPricePerMToken?: number;
};

export type ChatCostTokens = {
	promptTokens: number;
	completionTokens: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
};

/** Providers that report prompt/input tokens exclusive of cache tokens. */
const EXCLUSIVE_CACHE_PROVIDERS = new Set([
	"anthropic",
	"bedrock",
	"aws.bedrock",
	"aws_bedrock",
	"amazon.bedrock",
]);

/** Providers that report prompt/input tokens inclusive of cache tokens. */
const INCLUSIVE_CACHE_PROVIDERS = new Set([
	"openai",
	"azure",
	"azure_ai",
	"azure.ai",
	"groq",
	"google",
	"google_ai",
	"google_genai",
	"vertexai",
	"vertex_ai",
	"vertex.ai",
	"litellm",
	"langchain",
	"cohere",
	"xai",
	"claude_agent_sdk",
	"claude-agent-sdk",
	"pydo",
]);

/**
 * Decide whether promptTokens already include cache read/creation counts.
 */
export function promptTokensIncludeCache(
	provider: string,
	promptTokens: number,
	cacheReadTokens: number,
	cacheCreationTokens: number
): boolean {
	const normalized = (provider || "").trim().toLowerCase();
	if (EXCLUSIVE_CACHE_PROVIDERS.has(normalized)) {
		return false;
	}
	if (
		INCLUSIVE_CACHE_PROVIDERS.has(normalized) ||
		(normalized.includes("claude") && normalized.includes("agent")) ||
		normalized.startsWith("google") ||
		normalized.startsWith("vertex") ||
		normalized.startsWith("azure")
	) {
		return true;
	}

	const cacheTotal = (cacheReadTokens || 0) + (cacheCreationTokens || 0);
	if (cacheTotal > 0 && promptTokens >= cacheTotal) {
		return true;
	}
	return false;
}

/**
 * Compute USD cost from per-million token prices.
 * When cache prices are 0 / undefined, behavior matches legacy input+output only
 * (cache args do not change the result).
 */
export function getChatModelCostPerM(
	prices: PerMModelPrices,
	tokens: ChatCostTokens,
	options?: { promptTokensIncludeCache?: boolean }
): number {
	const promptTokens = tokens.promptTokens || 0;
	const completionTokens = tokens.completionTokens || 0;
	const cacheReadTokens = tokens.cacheReadTokens || 0;
	const cacheCreationTokens = tokens.cacheCreationTokens || 0;

	const cacheReadPrice = prices.cacheReadPricePerMToken || 0;
	const cacheCreationPrice = prices.cacheCreationPricePerMToken || 0;
	const inclusive = options?.promptTokensIncludeCache ?? false;

	let billablePromptTokens = promptTokens;
	let cacheCost = 0;

	if (cacheReadPrice > 0) {
		cacheCost += (cacheReadTokens / 1_000_000) * cacheReadPrice;
		if (inclusive) {
			billablePromptTokens -= cacheReadTokens;
		}
	}
	if (cacheCreationPrice > 0) {
		cacheCost += (cacheCreationTokens / 1_000_000) * cacheCreationPrice;
		if (inclusive) {
			billablePromptTokens -= cacheCreationTokens;
		}
	}

	billablePromptTokens = Math.max(billablePromptTokens, 0);

	return (
		(billablePromptTokens / 1_000_000) * (prices.inputPricePerMToken || 0) +
		(completionTokens / 1_000_000) * (prices.outputPricePerMToken || 0) +
		cacheCost
	);
}
