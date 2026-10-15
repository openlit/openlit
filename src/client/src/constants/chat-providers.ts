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
] as const;

export type ChatProviderId = (typeof CHAT_PROVIDER_IDS)[number];

export function isChatProvider(providerId: string): boolean {
	return (CHAT_PROVIDER_IDS as readonly string[]).includes(providerId);
}
