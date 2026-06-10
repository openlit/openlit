import { ModelMetadata, ConfigField } from "@/types/openground";

/**
 * Default (built-in) provider metadata and models. Seeded into ClickHouse tables
 * on first run. After seeding these are NOT read at runtime — the DB is the
 * source of truth and everything is editable.
 */

export interface DefaultModelEntry extends ModelMetadata {
	modelType?: string;
}

export interface DefaultProviderEntry {
	providerId: string;
	displayName: string;
	description: string;
	requiresVault: boolean;
	configSchema: {
		temperature?: ConfigField;
		maxTokens?: ConfigField;
		topP?: ConfigField;
	};
}

export const DEFAULT_PROVIDERS: DefaultProviderEntry[] = [
	{
		providerId: "openai", displayName: "OpenAI", description: "GPT models from OpenAI", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature (0 = deterministic, 2 = very random)" },
			maxTokens: { min: 1, max: 16000, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "anthropic", displayName: "Anthropic", description: "Claude models from Anthropic", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 1, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 8096, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "google", displayName: "Google AI", description: "Gemini models from Google", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 8192, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 0.95, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "mistral", displayName: "Mistral AI", description: "Mistral and Mixtral models", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 1, step: 0.1, default: 0.7, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 8192, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "groq", displayName: "Groq", description: "Ultra-fast inference for open source models", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 32768, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "perplexity", displayName: "Perplexity", description: "Models with online search capabilities", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 0.2, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 4096, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 0.9, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "azure", displayName: "Azure OpenAI", description: "OpenAI models via Azure", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 16000, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "cohere", displayName: "Cohere", description: "Command models with RAG capabilities", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 5, step: 0.1, default: 0.3, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 4096, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 0.99, step: 0.01, default: 0.75, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "together", displayName: "Together AI", description: "Fast inference for open source models", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 1, step: 0.1, default: 0.7, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 8192, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 0.7, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "fireworks", displayName: "Fireworks AI", description: "Production-ready LLM inference", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 16384, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "deepseek", displayName: "DeepSeek", description: "Advanced reasoning and coding models", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 1, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 4096, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "xai", displayName: "xAI", description: "Grok models with real-time knowledge", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 0, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 131072, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 1, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "huggingface", displayName: "Hugging Face", description: "Open source models via Inference API", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 2, step: 0.1, default: 0.7, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 2048, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.1, default: 0.95, description: "Nucleus sampling threshold" },
		},
	},
	{
		providerId: "replicate", displayName: "Replicate", description: "Run open source models in the cloud", requiresVault: true,
		configSchema: {
			temperature: { min: 0, max: 5, step: 0.01, default: 0.75, description: "Sampling temperature" },
			maxTokens: { min: 1, max: 4096, step: 1, default: 1000, description: "Maximum tokens to generate" },
			topP: { min: 0, max: 1, step: 0.01, default: 0.9, description: "Nucleus sampling threshold" },
		},
	},
];

export const DEFAULT_MODELS_BY_PROVIDER: Record<string, DefaultModelEntry[]> = {
	openai: [
		{
			id: "gpt-4o",
			displayName: "GPT-4o",
			contextWindow: 128000,
			inputPricePerMToken: 2.5,
			outputPricePerMToken: 10.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-4o-mini",
			displayName: "GPT-4o Mini",
			contextWindow: 128000,
			inputPricePerMToken: 0.15,
			outputPricePerMToken: 0.6,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-4-turbo",
			displayName: "GPT-4 Turbo",
			contextWindow: 128000,
			inputPricePerMToken: 10.0,
			outputPricePerMToken: 30.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-3.5-turbo",
			displayName: "GPT-3.5 Turbo",
			contextWindow: 16385,
			inputPricePerMToken: 0.5,
			outputPricePerMToken: 1.5,
			capabilities: ["function-calling", "streaming"],
		},
		// GPT-5 family: shipped late 2025 with the same per-token rates
		// across the base and codex variants ($1.25 input / $10 output).
		// We seed the codex SKUs explicitly because the coding-agents
		// hook stamps `gen_ai.request.model = gpt-5-codex` (etc.) and the
		// auto-pricer otherwise skips them with "model not found". Each
		// generation gets its own row so the picker/recompute paths can
		// match the exact model id the agent reports.
		{
			id: "gpt-5",
			displayName: "GPT-5",
			contextWindow: 400000,
			inputPricePerMToken: 1.25,
			outputPricePerMToken: 10.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-5-codex",
			displayName: "GPT-5 Codex",
			contextWindow: 400000,
			inputPricePerMToken: 1.25,
			outputPricePerMToken: 10.0,
			capabilities: ["function-calling", "streaming"],
		},
		{
			id: "gpt-5-mini",
			displayName: "GPT-5 Mini",
			contextWindow: 400000,
			inputPricePerMToken: 0.25,
			outputPricePerMToken: 2.0,
			capabilities: ["function-calling", "streaming"],
		},
		{
			id: "gpt-5-nano",
			displayName: "GPT-5 Nano",
			contextWindow: 400000,
			inputPricePerMToken: 0.05,
			outputPricePerMToken: 0.4,
			capabilities: ["function-calling", "streaming"],
		},
		{
			id: "gpt-5-pro",
			displayName: "GPT-5 Pro",
			contextWindow: 400000,
			inputPricePerMToken: 15.0,
			outputPricePerMToken: 120.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-5.1",
			displayName: "GPT-5.1",
			contextWindow: 400000,
			inputPricePerMToken: 1.25,
			outputPricePerMToken: 10.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-5.1-codex",
			displayName: "GPT-5.1 Codex",
			contextWindow: 400000,
			inputPricePerMToken: 1.25,
			outputPricePerMToken: 10.0,
			capabilities: ["function-calling", "streaming"],
		},
		{
			id: "gpt-5.1-codex-max",
			displayName: "GPT-5.1 Codex Max",
			contextWindow: 1000000,
			inputPricePerMToken: 1.25,
			outputPricePerMToken: 10.0,
			capabilities: ["function-calling", "streaming"],
		},
		{
			id: "gpt-5.2",
			displayName: "GPT-5.2",
			contextWindow: 400000,
			inputPricePerMToken: 1.75,
			outputPricePerMToken: 14.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-5.2-codex",
			displayName: "GPT-5.2 Codex",
			contextWindow: 400000,
			inputPricePerMToken: 1.75,
			outputPricePerMToken: 14.0,
			capabilities: ["function-calling", "streaming"],
		},
		{
			id: "gpt-5.3-codex",
			displayName: "GPT-5.3 Codex",
			contextWindow: 400000,
			inputPricePerMToken: 1.75,
			outputPricePerMToken: 14.0,
			capabilities: ["function-calling", "streaming"],
		},
		// GPT-5.4 uses breakpoint pricing above 272K context; we seed
		// the standard tier here (the over-272K tier kicks in for the
		// minority of users running long prompts and is recomputed via
		// the manage-models UI if needed).
		{
			id: "gpt-5.4",
			displayName: "GPT-5.4",
			contextWindow: 1100000,
			inputPricePerMToken: 2.5,
			outputPricePerMToken: 15.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-5.4-mini",
			displayName: "GPT-5.4 Mini",
			contextWindow: 1100000,
			inputPricePerMToken: 0.75,
			outputPricePerMToken: 4.5,
			capabilities: ["function-calling", "streaming"],
		},
		{
			id: "gpt-5.4-nano",
			displayName: "GPT-5.4 Nano",
			contextWindow: 1100000,
			inputPricePerMToken: 0.2,
			outputPricePerMToken: 1.25,
			capabilities: ["function-calling", "streaming"],
		},
		{
			id: "gpt-5.5",
			displayName: "GPT-5.5",
			contextWindow: 400000,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 30.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "o3",
			displayName: "OpenAI o3",
			contextWindow: 200000,
			inputPricePerMToken: 2.0,
			outputPricePerMToken: 8.0,
			capabilities: ["function-calling", "reasoning", "streaming"],
		},
		{
			id: "o3-mini",
			displayName: "OpenAI o3 mini",
			contextWindow: 200000,
			inputPricePerMToken: 1.1,
			outputPricePerMToken: 4.4,
			capabilities: ["function-calling", "reasoning", "streaming"],
		},
		{
			id: "o4-mini",
			displayName: "OpenAI o4 mini",
			contextWindow: 200000,
			inputPricePerMToken: 1.1,
			outputPricePerMToken: 4.4,
			capabilities: ["function-calling", "reasoning", "streaming"],
		},
	],
	anthropic: [
		{
			id: "claude-3-5-sonnet-20240620",
			displayName: "Claude 3.5 Sonnet",
			contextWindow: 200000,
			inputPricePerMToken: 3.0,
			outputPricePerMToken: 15.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "claude-3-5-sonnet-20241022",
			displayName: "Claude 3.5 Sonnet (2024-10)",
			contextWindow: 200000,
			inputPricePerMToken: 3.0,
			outputPricePerMToken: 15.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "claude-3-5-haiku-20241022",
			displayName: "Claude 3.5 Haiku",
			contextWindow: 200000,
			inputPricePerMToken: 0.8,
			outputPricePerMToken: 4.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "claude-3-haiku-20240307",
			displayName: "Claude 3 Haiku",
			contextWindow: 200000,
			inputPricePerMToken: 0.25,
			outputPricePerMToken: 1.25,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "claude-3-sonnet-20240229",
			displayName: "Claude 3 Sonnet",
			contextWindow: 200000,
			inputPricePerMToken: 3.0,
			outputPricePerMToken: 15.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "claude-3-7-sonnet-20250219",
			displayName: "Claude 3.7 Sonnet",
			contextWindow: 200000,
			inputPricePerMToken: 3.0,
			outputPricePerMToken: 15.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		// Claude 4 family. Cursor/Claude Code stamp the bare id
		// (`claude-opus-4-7`) and Cursor also surfaces thinking-mode
		// variants under SKU-style suffixes (`-thinking-xhigh`, etc.).
		// We seed every variant we've observed in the wild so the
		// auto-pricer can match without falling back to the helper
		// JSON path. Opus 4 / 4.1 use the legacy $15/$75 rate; 4.5+
		// drops to $5/$25 per Anthropic's 2025-10 price change.
		{
			id: "claude-haiku-4-5",
			displayName: "Claude Haiku 4.5",
			contextWindow: 200000,
			inputPricePerMToken: 1.0,
			outputPricePerMToken: 5.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-haiku-4-5-20251001",
			displayName: "Claude Haiku 4.5 (2025-10)",
			contextWindow: 200000,
			inputPricePerMToken: 1.0,
			outputPricePerMToken: 5.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-sonnet-4-0",
			displayName: "Claude Sonnet 4",
			contextWindow: 200000,
			inputPricePerMToken: 3.0,
			outputPricePerMToken: 15.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-sonnet-4-5",
			displayName: "Claude Sonnet 4.5",
			contextWindow: 1000000,
			inputPricePerMToken: 3.0,
			outputPricePerMToken: 15.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-sonnet-4-6",
			displayName: "Claude Sonnet 4.6",
			contextWindow: 1000000,
			inputPricePerMToken: 3.0,
			outputPricePerMToken: 15.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-sonnet-4-7",
			displayName: "Claude Sonnet 4.7",
			contextWindow: 1000000,
			inputPricePerMToken: 3.0,
			outputPricePerMToken: 15.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-opus-4-0",
			displayName: "Claude Opus 4",
			contextWindow: 200000,
			inputPricePerMToken: 15.0,
			outputPricePerMToken: 75.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-opus-4-1",
			displayName: "Claude Opus 4.1",
			contextWindow: 200000,
			inputPricePerMToken: 15.0,
			outputPricePerMToken: 75.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-opus-4-5",
			displayName: "Claude Opus 4.5",
			contextWindow: 200000,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 25.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-opus-4-6",
			displayName: "Claude Opus 4.6",
			contextWindow: 1000000,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 25.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-opus-4-7",
			displayName: "Claude Opus 4.7",
			contextWindow: 1000000,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 25.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		// Cursor thinking-mode SKUs — the model is still Opus 4.7
		// under the hood (same token rate), but the surface id Cursor
		// stamps on coding_agent.llm.turn varies, so each gets its own
		// row to avoid auto-pricer misses.
		{
			id: "claude-opus-4-7-thinking-low",
			displayName: "Claude Opus 4.7 (thinking low)",
			contextWindow: 1000000,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 25.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-opus-4-7-thinking-medium",
			displayName: "Claude Opus 4.7 (thinking medium)",
			contextWindow: 1000000,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 25.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-opus-4-7-thinking-high",
			displayName: "Claude Opus 4.7 (thinking high)",
			contextWindow: 1000000,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 25.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "claude-opus-4-7-thinking-xhigh",
			displayName: "Claude Opus 4.7 (thinking xhigh)",
			contextWindow: 1000000,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 25.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
	],
	google: [
		{
			id: "gemini-1.5-pro",
			displayName: "Gemini 1.5 Pro",
			contextWindow: 2000000,
			inputPricePerMToken: 1.25,
			outputPricePerMToken: 5.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gemini-1.5-flash",
			displayName: "Gemini 1.5 Flash",
			contextWindow: 1000000,
			inputPricePerMToken: 0.075,
			outputPricePerMToken: 0.3,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gemini-1.0-pro",
			displayName: "Gemini 1.0 Pro",
			contextWindow: 32768,
			inputPricePerMToken: 0.5,
			outputPricePerMToken: 1.5,
			capabilities: ["function-calling", "streaming"],
		},
		// Gemini 2.0 / 2.5 / 3.x families — Coding agents (Cursor sub-agent
		// planners, Codex w/ Gemini backend, etc.) routinely emit these
		// model ids. We seed the ≤200K standard tier; if the request goes
		// long, the auto-pricer underestimates by ~2x but never zero, which
		// is closer to the truth than skipping.
		{
			id: "gemini-2.0-flash",
			displayName: "Gemini 2.0 Flash",
			contextWindow: 1000000,
			inputPricePerMToken: 0.1,
			outputPricePerMToken: 0.4,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gemini-2.5-pro",
			displayName: "Gemini 2.5 Pro",
			contextWindow: 2000000,
			inputPricePerMToken: 1.25,
			outputPricePerMToken: 10.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "gemini-2.5-flash",
			displayName: "Gemini 2.5 Flash",
			contextWindow: 1000000,
			inputPricePerMToken: 0.3,
			outputPricePerMToken: 2.5,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "gemini-2.5-flash-lite",
			displayName: "Gemini 2.5 Flash-Lite",
			contextWindow: 1000000,
			inputPricePerMToken: 0.1,
			outputPricePerMToken: 0.4,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gemini-3-flash",
			displayName: "Gemini 3 Flash",
			contextWindow: 1000000,
			inputPricePerMToken: 0.5,
			outputPricePerMToken: 3.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
		{
			id: "gemini-3.1-flash-lite",
			displayName: "Gemini 3.1 Flash-Lite",
			contextWindow: 1000000,
			inputPricePerMToken: 0.25,
			outputPricePerMToken: 1.5,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gemini-3.1-pro",
			displayName: "Gemini 3.1 Pro",
			contextWindow: 2000000,
			inputPricePerMToken: 2.0,
			outputPricePerMToken: 12.0,
			capabilities: ["function-calling", "vision", "streaming", "thinking"],
		},
	],
	mistral: [
		{
			id: "mistral-large-latest",
			displayName: "Mistral Large",
			contextWindow: 128000,
			inputPricePerMToken: 2.0,
			outputPricePerMToken: 6.0,
			capabilities: ["function-calling", "streaming"],
		},
		{
			id: "mistral-medium-latest",
			displayName: "Mistral Medium",
			contextWindow: 32000,
			inputPricePerMToken: 2.7,
			outputPricePerMToken: 8.1,
			capabilities: ["streaming"],
		},
		{
			id: "mistral-small-latest",
			displayName: "Mistral Small",
			contextWindow: 32000,
			inputPricePerMToken: 0.2,
			outputPricePerMToken: 0.6,
			capabilities: ["streaming"],
		},
	],
	groq: [
		{
			id: "llama-3.3-70b-versatile",
			displayName: "Llama 3.3 70B",
			contextWindow: 128000,
			inputPricePerMToken: 0.59,
			outputPricePerMToken: 0.79,
			capabilities: ["streaming"],
		},
		{
			id: "llama-3.1-8b-instant",
			displayName: "Llama 3.1 8B Instant",
			contextWindow: 128000,
			inputPricePerMToken: 0.05,
			outputPricePerMToken: 0.08,
			capabilities: ["streaming"],
		},
		{
			id: "mixtral-8x7b-32768",
			displayName: "Mixtral 8x7B",
			contextWindow: 32768,
			inputPricePerMToken: 0.24,
			outputPricePerMToken: 0.24,
			capabilities: ["streaming"],
		},
		{
			id: "gemma2-9b-it",
			displayName: "Gemma 2 9B",
			contextWindow: 8192,
			inputPricePerMToken: 0.2,
			outputPricePerMToken: 0.2,
			capabilities: ["streaming"],
		},
	],
	perplexity: [
		{
			id: "sonar-pro",
			displayName: "Sonar Pro",
			contextWindow: 127072,
			inputPricePerMToken: 3.0,
			outputPricePerMToken: 15.0,
			capabilities: ["streaming", "search"],
		},
		{
			id: "sonar",
			displayName: "Sonar",
			contextWindow: 127072,
			inputPricePerMToken: 1.0,
			outputPricePerMToken: 1.0,
			capabilities: ["streaming", "search"],
		},
		{
			id: "sonar-reasoning",
			displayName: "Sonar Reasoning",
			contextWindow: 127072,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 5.0,
			capabilities: ["streaming", "search", "reasoning"],
		},
	],
	azure: [
		{
			id: "gpt-4o",
			displayName: "GPT-4o",
			contextWindow: 128000,
			inputPricePerMToken: 2.5,
			outputPricePerMToken: 10.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-4o-mini",
			displayName: "GPT-4o Mini",
			contextWindow: 128000,
			inputPricePerMToken: 0.15,
			outputPricePerMToken: 0.6,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-4-turbo",
			displayName: "GPT-4 Turbo",
			contextWindow: 128000,
			inputPricePerMToken: 10.0,
			outputPricePerMToken: 30.0,
			capabilities: ["function-calling", "vision", "streaming"],
		},
		{
			id: "gpt-35-turbo",
			displayName: "GPT-3.5 Turbo",
			contextWindow: 16385,
			inputPricePerMToken: 0.5,
			outputPricePerMToken: 1.5,
			capabilities: ["function-calling", "streaming"],
		},
	],
	cohere: [
		{
			id: "command-r-plus",
			displayName: "Command R+",
			contextWindow: 128000,
			inputPricePerMToken: 3.0,
			outputPricePerMToken: 15.0,
			capabilities: ["function-calling", "streaming", "rag"],
		},
		{
			id: "command-r",
			displayName: "Command R",
			contextWindow: 128000,
			inputPricePerMToken: 0.5,
			outputPricePerMToken: 1.5,
			capabilities: ["function-calling", "streaming", "rag"],
		},
		{
			id: "command",
			displayName: "Command",
			contextWindow: 4096,
			inputPricePerMToken: 1.0,
			outputPricePerMToken: 2.0,
			capabilities: ["streaming"],
		},
		{
			id: "command-light",
			displayName: "Command Light",
			contextWindow: 4096,
			inputPricePerMToken: 0.3,
			outputPricePerMToken: 0.6,
			capabilities: ["streaming"],
		},
	],
	together: [
		{
			id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
			displayName: "Llama 3.1 70B Turbo",
			contextWindow: 131072,
			inputPricePerMToken: 0.88,
			outputPricePerMToken: 0.88,
			capabilities: ["streaming"],
		},
		{
			id: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
			displayName: "Llama 3.1 8B Turbo",
			contextWindow: 131072,
			inputPricePerMToken: 0.18,
			outputPricePerMToken: 0.18,
			capabilities: ["streaming"],
		},
		{
			id: "mistralai/Mixtral-8x7B-Instruct-v0.1",
			displayName: "Mixtral 8x7B",
			contextWindow: 32768,
			inputPricePerMToken: 0.6,
			outputPricePerMToken: 0.6,
			capabilities: ["streaming"],
		},
		{
			id: "Qwen/Qwen2.5-72B-Instruct-Turbo",
			displayName: "Qwen 2.5 72B Turbo",
			contextWindow: 32768,
			inputPricePerMToken: 1.2,
			outputPricePerMToken: 1.2,
			capabilities: ["streaming"],
		},
	],
	fireworks: [
		{
			id: "accounts/fireworks/models/llama-v3p1-70b-instruct",
			displayName: "Llama 3.1 70B",
			contextWindow: 131072,
			inputPricePerMToken: 0.9,
			outputPricePerMToken: 0.9,
			capabilities: ["streaming"],
		},
		{
			id: "accounts/fireworks/models/llama-v3p1-8b-instruct",
			displayName: "Llama 3.1 8B",
			contextWindow: 131072,
			inputPricePerMToken: 0.2,
			outputPricePerMToken: 0.2,
			capabilities: ["streaming"],
		},
		{
			id: "accounts/fireworks/models/mixtral-8x7b-instruct",
			displayName: "Mixtral 8x7B",
			contextWindow: 32768,
			inputPricePerMToken: 0.5,
			outputPricePerMToken: 0.5,
			capabilities: ["streaming"],
		},
		{
			id: "accounts/fireworks/models/qwen2p5-72b-instruct",
			displayName: "Qwen 2.5 72B",
			contextWindow: 32768,
			inputPricePerMToken: 0.9,
			outputPricePerMToken: 0.9,
			capabilities: ["streaming"],
		},
	],
	deepseek: [
		{
			id: "deepseek-chat",
			displayName: "DeepSeek Chat",
			contextWindow: 64000,
			inputPricePerMToken: 0.27,
			outputPricePerMToken: 1.1,
			capabilities: ["streaming", "reasoning"],
		},
		{
			id: "deepseek-coder",
			displayName: "DeepSeek Coder",
			contextWindow: 16000,
			inputPricePerMToken: 0.27,
			outputPricePerMToken: 1.1,
			capabilities: ["streaming", "coding"],
		},
	],
	xai: [
		{
			id: "grok-beta",
			displayName: "Grok Beta",
			contextWindow: 131072,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 15.0,
			capabilities: ["streaming", "real-time"],
		},
		{
			id: "grok-2",
			displayName: "Grok 2",
			contextWindow: 131072,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 15.0,
			capabilities: ["streaming", "real-time"],
		},
		{
			id: "grok-3",
			displayName: "Grok 3",
			contextWindow: 131072,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 15.0,
			capabilities: ["streaming", "real-time"],
		},
		{
			id: "grok-3-mini",
			displayName: "Grok 3 Mini",
			contextWindow: 131072,
			inputPricePerMToken: 1.0,
			outputPricePerMToken: 3.0,
			capabilities: ["streaming", "real-time"],
		},
		{
			id: "grok-vision-beta",
			displayName: "Grok Vision Beta",
			contextWindow: 8192,
			inputPricePerMToken: 5.0,
			outputPricePerMToken: 15.0,
			capabilities: ["streaming", "vision", "real-time"],
		},
	],
	huggingface: [
		{
			id: "meta-llama/Meta-Llama-3-70B-Instruct",
			displayName: "Llama 3 70B",
			contextWindow: 8192,
			inputPricePerMToken: 0.0,
			outputPricePerMToken: 0.0,
			capabilities: ["streaming"],
		},
		{
			id: "mistralai/Mistral-7B-Instruct-v0.3",
			displayName: "Mistral 7B",
			contextWindow: 32768,
			inputPricePerMToken: 0.0,
			outputPricePerMToken: 0.0,
			capabilities: ["streaming"],
		},
		{
			id: "google/gemma-2-9b-it",
			displayName: "Gemma 2 9B",
			contextWindow: 8192,
			inputPricePerMToken: 0.0,
			outputPricePerMToken: 0.0,
			capabilities: ["streaming"],
		},
	],
	replicate: [
		{
			id: "meta/meta-llama-3-70b-instruct",
			displayName: "Llama 3 70B",
			contextWindow: 8192,
			inputPricePerMToken: 0.65,
			outputPricePerMToken: 2.75,
			capabilities: ["streaming"],
		},
		{
			id: "meta/meta-llama-3-8b-instruct",
			displayName: "Llama 3 8B",
			contextWindow: 8192,
			inputPricePerMToken: 0.05,
			outputPricePerMToken: 0.25,
			capabilities: ["streaming"],
		},
		{
			id: "mistralai/mixtral-8x7b-instruct-v0.1",
			displayName: "Mixtral 8x7B",
			contextWindow: 32768,
			inputPricePerMToken: 0.3,
			outputPricePerMToken: 1.0,
			capabilities: ["streaming"],
		},
	],
};
