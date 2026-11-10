/** Self-hosted or local endpoint speaking the OpenAI API. Its API key is optional. */
export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible";

/**
 * Providers that Chat and OpenGround can call via generateText / streamText.
 * TypeSafe Jev is evaluation-only and is intentionally omitted.
 */
export const CHAT_PROVIDER_IDS = [
	"openai",
	"anthropic",
	"google",
	"mistral",
	"cohere",
	"groq",
	"perplexity",
	"azure",
	"together",
	"fireworks",
	"deepseek",
	"xai",
	"huggingface",
	"replicate",
	"minimax",
	"orcarouter",
	OPENAI_COMPATIBLE_PROVIDER_ID,
] as const;

export type ChatProviderId = (typeof CHAT_PROVIDER_IDS)[number];

export function isChatProvider(providerId: string): boolean {
	return (CHAT_PROVIDER_IDS as readonly string[]).includes(providerId);
}
