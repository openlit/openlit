export type Providers = "anthropic" | "cohere" | "mistral" | "openai";

export type ProviderType = {
	key: Providers;
	title: string;
	subTitle: string;
	logo: string;
	logoDark: string;
	config: Record<string, any>[];
};

export type EvalutatedResponseData = Array<[string, any]>;

export type OpengroundStore = {
	selectedProviders: {
		provider: Providers;
		config: Record<string, any>;
	}[];
	evaluatedResponse: {
		isLoading: boolean;
		data?: EvalutatedResponseData;
	};
	prompt: string;
	isLoading: boolean;
	setProviderConfig: (path: string, value: any) => void;
	setPrompt: (prompt: string) => void;
	addProvider: (
		provider: Providers,
		configObject?: Record<string, any>
	) => void;
	removeProvider: (index: number) => void;
	reset: () => void;
	setEvaluatedLoading: (l: boolean) => void;
	setEvaluatedData: (data: EvalutatedResponseData) => void;
};