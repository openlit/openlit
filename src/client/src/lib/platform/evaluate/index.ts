import asaw from "@/utils/asaw";
import { chatCompletion } from "./openai";

export async function evaluate(params: {
	prompt: string;
	selectedProviders: any[];
}) {
	return Promise.all(
		params.selectedProviders.map(({ provider, config }) => {
			switch (provider) {
				case "openai-chat":
					return asaw(chatCompletion({ ...config, prompt: params.prompt }));
				default:
					return ["Type not supported yet!", null];
			}
		})
	);
}
