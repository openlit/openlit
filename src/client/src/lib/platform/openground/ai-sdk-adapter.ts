import { generateText } from "ai";
import { createModel } from "@/lib/platform/providers/create-model";

export interface ProviderConfig {
	provider: string;
	model: string;
	apiKey: string;
	baseUrl?: string;
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

export class AISdkAdapter {
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

		// Validate model name to prevent injection attacks
		if (!config.model || typeof config.model !== 'string') {
			throw new Error('Invalid model name');
		}

		const modelInstance = createModel(
			config.provider,
			config.apiKey,
			config.model,
			config.baseUrl
		);

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

		// Vercel AI SDK uses inputTokens/outputTokens (not promptTokens/completionTokens)
		const promptTokens = result.usage?.inputTokens ?? (result.usage as any)?.promptTokens ?? 0;
		const completionTokens = result.usage?.outputTokens ?? (result.usage as any)?.completionTokens ?? 0;

		return {
			text: result.text,
			usage: {
				promptTokens,
				completionTokens,
				totalTokens: promptTokens + completionTokens,
			},
			finishReason: result.finishReason,
			model: `${config.provider}/${config.model}`,
		};
	}
}
