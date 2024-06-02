import asaw from "@/utils/asaw";
import OpenAIProvider from "./providers/openai";
import AnthropicProvider from "./providers/anthropic";
import CohereProvider from "./providers/cohere";
import MistralProvider from "./providers/mistral";

type evaluateParams = {
	prompt: string;
	selectedProviders: any[];
};

export async function evaluate(params: evaluateParams) {
	return Promise.all(
		params.selectedProviders.map(({ provider, config }) => {
			const objectParams = { ...config, prompt: params.prompt };
			switch (provider) {
				case "openai":
					return asaw(OpenAIProvider.evaluate(objectParams));
				case "anthropic":
					return asaw(AnthropicProvider.evaluate(objectParams));
				case "cohere":
					return asaw(CohereProvider.evaluate(objectParams));
				case "mistral":
					return asaw(MistralProvider.evaluate(objectParams));
				default:
					return ["Type not supported yet!", null];
			}
		})
	);
}
