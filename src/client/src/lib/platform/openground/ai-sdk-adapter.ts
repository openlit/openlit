import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";

export interface ProviderConfig {
	provider: string;
	model: string;
	apiKey: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	systemPrompt?: string;
}

export interface GenerationResult {
	text: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	finishReason: string;
	model: string;
}

type ProviderFactory = (apiKey: string) => any;

export class AISdkAdapter {
	private static providerFactories: Record<string, ProviderFactory> = {
		openai: (apiKey: string) => createOpenAI({ apiKey }),
		anthropic: (apiKey: string) => createAnthropic({ apiKey }),
		google: (apiKey: string) => google,
		mistral: (apiKey: string) => createMistral({ apiKey }),
		cohere: (apiKey: string) => createCohere({ apiKey }),
		groq: (apiKey: string) => createOpenAI({
			baseURL: 'https://api.groq.com/openai/v1',
			apiKey
		}),
		perplexity: (apiKey: string) => createOpenAI({
			baseURL: 'https://api.perplexity.ai',
			apiKey
		}),
		azure: (apiKey: string) => createOpenAI({
			baseURL: process.env.AZURE_OPENAI_ENDPOINT || 'https://your-resource.openai.azure.com',
			apiKey,
			headers: {
				'api-key': apiKey,
			}
		}),
		together: (apiKey: string) => createOpenAI({
			baseURL: 'https://api.together.xyz/v1',
			apiKey
		}),
		fireworks: (apiKey: string) => createOpenAI({
			baseURL: 'https://api.fireworks.ai/inference/v1',
			apiKey
		}),
		deepseek: (apiKey: string) => createOpenAI({
			baseURL: 'https://api.deepseek.com',
			apiKey
		}),
		xai: (apiKey: string) => createOpenAI({
			baseURL: 'https://api.x.ai/v1',
			apiKey
		}),
		huggingface: (apiKey: string) => createOpenAI({
			baseURL: 'https://api-inference.huggingface.co/v1',
			apiKey
		}),
		replicate: (apiKey: string) => createOpenAI({
			baseURL: 'https://openai-proxy.replicate.com/v1',
			apiKey
		}),
	};

	/**
	 * Generate text completion using the specified provider and model
	 */
	static async generateCompletion(
		config: ProviderConfig
	): Promise<GenerationResult> {
		// Validate provider name to prevent prototype pollution
		if (!config.provider || typeof config.provider !== 'string') {
			throw new Error('Invalid provider name');
		}

		// Use hasOwnProperty to ensure we only access direct properties
		if (!Object.prototype.hasOwnProperty.call(this.providerFactories, config.provider)) {
			throw new Error(`Provider ${config.provider} not supported`);
		}

		const providerFactory = this.providerFactories[config.provider];
		if (typeof providerFactory !== 'function') {
			throw new Error(`Invalid provider factory for ${config.provider}`);
		}

		const provider = providerFactory(config.apiKey);
		const modelInstance = provider(config.model);

		// Build options object with only defined values
		const options: any = {
			model: modelInstance,
			prompt: config.systemPrompt || "",
		};

		if (config.temperature !== undefined) {
			options.temperature = config.temperature;
		}
		if (config.maxTokens !== undefined) {
			options.maxTokens = config.maxTokens;
		}
		if (config.topP !== undefined) {
			options.topP = config.topP;
		}

		const result = await generateText(options);

		return {
			text: result.text,
			usage: {
				promptTokens: (result.usage as any).promptTokens || 0,
				completionTokens: (result.usage as any).completionTokens || 0,
				totalTokens: (result.usage as any).totalTokens || 0,
			},
			finishReason: result.finishReason,
			model: `${config.provider}/${config.model}`,
		};
	}

	/**
	 * Register a custom provider factory
	 * Allows extending support to additional providers
	 */
	static registerProvider(providerId: string, factory: ProviderFactory): void {
		// Validate provider ID to prevent prototype pollution
		if (!providerId || typeof providerId !== 'string' || providerId.includes('__proto__') || providerId.includes('constructor') || providerId.includes('prototype')) {
			throw new Error('Invalid provider ID');
		}
		if (typeof factory !== 'function') {
			throw new Error('Provider factory must be a function');
		}
		this.providerFactories[providerId] = factory;
	}

	/**
	 * Get list of supported provider IDs
	 */
	static getSupportedProviders(): string[] {
		return Object.keys(this.providerFactories);
	}

	/**
	 * Check if a provider is supported
	 */
	static isProviderSupported(providerId: string): boolean {
		if (!providerId || typeof providerId !== 'string') {
			return false;
		}
		return Object.prototype.hasOwnProperty.call(this.providerFactories, providerId);
	}
}
