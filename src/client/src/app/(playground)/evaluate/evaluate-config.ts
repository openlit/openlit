export type Providers = "openai-chat";

export type ProviderType = {
	key: Providers;
	title: string;
	subTitle: string;
	description: string;
	config: Record<string, any>[];
};

export const providersConfig: Record<Providers, ProviderType> = {
	"openai-chat": {
		key: "openai-chat",
		title: "OpenAI",
		subTitle: "Chat completions",
		description: "Chat gen",
		config: [
			{
				key: "api_key",
				label: "API Key",
				type: "input",
				placeholder: "OPENAI_API_KEY",
			},
			{
				key: "model",
				label: "Model",
				type: "select",
				placeholder: "select a model",
				options: [
					{
						label: "gpt-3.5-turbo",
						value: "gpt-3.5-turbo",
					},
					{
						label: "gpt-3.5-turbo-1106",
						value: "gpt-3.5-turbo-1106",
					},
					{
						label: "gpt-3.5-turbo-0125",
						value: "gpt-3.5-turbo-0125",
					},
					{
						label: "gpt-3.5-turbo-16k",
						value: "gpt-3.5-turbo-16k",
					},
					{
						label: "gpt-4",
						value: "gpt-4",
					},
					{
						label: "gpt-4-0613",
						value: "gpt-4-0613",
					},
					{
						label: "gpt-4-turbo-preview",
						value: "gpt-4-turbo-preview",
					},
					{
						label: "gpt-4-1106-preview",
						value: "gpt-4-1106-preview",
					},
					{
						label: "gpt-4-1106-vision-preview",
						value: "gpt-4-1106-vision-preview",
					},
					{
						label: "gpt-4-0125-preview",
						value: "gpt-4-0125-preview",
					},
					{
						label: "gpt-4-32k",
						value: "gpt-4-32k",
					},
					{
						label: "gpt-4-32k-0613",
						value: "gpt-4-32k-0613",
					},
					{
						label: "gpt-4-vision-preview",
						value: "gpt-4-vision-preview",
					},
				],
			},
			{
				key: "temperature",
				label: "Temperature",
				type: "slider",
				limits: { min: 0, max: 2, step: 0.1 },
				defaultValue: 1,
			},
			{
				key: "max_tokens",
				label: "Max tokens",
				type: "slider",
				limits: { min: 0, max: 4000, step: 1 },
				defaultValue: 100,
			},
			{
				key: "top_p",
				label: "Top P",
				type: "slider",
				limits: { min: 0, max: 1, step: 0.1 },
				defaultValue: 0.5,
			},
		],
	},
};
