import { encodingForModel, TiktokenModel } from "js-tiktoken";

export default class OpenLitHelper {
	static readonly PROMPT_TOKEN_FACTOR = 1000;
	static pricingInfo: any;

	static openaiTokens(text: string, model: string): number {
		try {
			const encoding = encodingForModel(model as TiktokenModel);
			return encoding.encode(text).length;
		} catch (error) {
			console.error(`Error in openaiTokens: ${error}`);
			throw error;
		}
	}

	static generalTokens(text: string): number {
		const encoding = encodingForModel("gpt2");
		return encoding.encode(text).length;
	}

	// Cache-aware cost calculation, kept in parity with the SDK helpers.
	// When the model pricing defines cacheReadPrice / cacheCreationPrice the
	// matching cache tokens are billed at those rates. Providers that report
	// promptTokens inclusive of cache tokens (OpenAI, LangChain) should pass
	// promptTokensIncludeCache=true so cached tokens are not billed twice;
	// providers that report them exclusively (Anthropic native) leave it false.
	static getChatModelCost(
		model: string,
		promptTokens: number,
		completionTokens: number,
		cacheReadTokens: number = 0,
		cacheCreationTokens: number = 0,
		promptTokensIncludeCache: boolean = false
	): string {
		try {
			const modelPricing = this.pricingInfo.chat[model];
			const cacheRead = cacheReadTokens || 0;
			const cacheCreation = cacheCreationTokens || 0;

			let billablePromptTokens = promptTokens;
			let cacheCost = 0;

			if (modelPricing.cacheReadPrice != null) {
				cacheCost +=
					(cacheRead / OpenLitHelper.PROMPT_TOKEN_FACTOR) *
					modelPricing.cacheReadPrice;
				if (promptTokensIncludeCache) {
					billablePromptTokens -= cacheRead;
				}
			}
			if (modelPricing.cacheCreationPrice != null) {
				cacheCost +=
					(cacheCreation / OpenLitHelper.PROMPT_TOKEN_FACTOR) *
					modelPricing.cacheCreationPrice;
				if (promptTokensIncludeCache) {
					billablePromptTokens -= cacheCreation;
				}
			}
			if (billablePromptTokens < 0) {
				billablePromptTokens = 0;
			}

			return (
				(billablePromptTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) *
					modelPricing.promptPrice +
				(completionTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) *
					modelPricing.completionPrice +
				cacheCost
			).toFixed(8);
		} catch (error) {
			console.error(`Error in getChatModelCost: ${error}`);
			return "0";
		}
	}

	static getEmbedModelCost(model: string, promptTokens: number): number {
		try {
			return (
				(promptTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) *
				this.pricingInfo.embeddings[model]
			);
		} catch (error) {
			console.error(`Error in getEmbedModelCost: ${error}`);
			return 0;
		}
	}

	static getImageModelCost(
		model: string,
		size: string,
		quality: number
	): number {
		try {
			return this.pricingInfo.images[model][quality][size];
		} catch (error) {
			console.error(`Error in getImageModelCost: ${error}`);
			return 0;
		}
	}

	static getAudioModelCost(model: string, prompt: string): number {
		try {
			return (
				(prompt.length / OpenLitHelper.PROMPT_TOKEN_FACTOR) *
				this.pricingInfo.audio[model]
			);
		} catch (error) {
			console.error(`Error in getAudioModelCost: ${error}`);
			return 0;
		}
	}

	static async fetchPricingInfo() {
		const pricingUrl =
			"https://raw.githubusercontent.com/openlit/openlit/main/assets/pricing.json";
		try {
			const response = await fetch(pricingUrl);
			if (response.ok) {
				this.pricingInfo = await response.json();
			} else {
				throw new Error(
					`HTTP error occurred while fetching pricing info: ${response.status}`
				);
			}
		} catch (error) {
			console.error(
				`Unexpected error occurred while fetching pricing info: ${error}`
			);
			return {};
		}
	}
}
