import { ProviderResult } from "@/lib/platform/openground-clickhouse";
import { ProviderMetadata } from "@/lib/platform/openground/provider-registry";

export type Providers = "anthropic" | "cohere" | "mistral" | "openai" | "google";

export type ProviderType = {
	key: Providers;
	title: string;
	subTitle: string;
	logo: string;
	logoDark: string;
	config: Record<string, any>[];
};

export type EvalutatedResponseData = Array<[string, any]>;

// New types for the updated architecture
export type PromptSource = {
	type: "custom" | "prompt-hub";
	content?: string; // For custom prompts
	promptId?: string; // For Prompt Hub
	promptName?: string; // Display name
	version?: number; // For Prompt Hub
	variables?: Record<string, string>; // Variable substitutions
};

export type SelectedProvider = {
	provider: string;
	model: string;
	hasVaultConfig: boolean;
	config: {
		temperature?: number;
		maxTokens?: number;
		topP?: number;
	};
};

export type OpengroundStore = {
	// Legacy fields (keep for backward compatibility)
	selectedProviders: {
		provider: Providers;
		config: Record<string, any>;
	}[];
	prompt: string;
	isLoading: boolean;

	// New fields for updated architecture
	promptSource: PromptSource;
	selectedProvidersNew: SelectedProvider[];
	evaluatedResponse: {
		isLoading: boolean;
		data?: EvalutatedResponseData | ProviderResult[]; // Support both old and new formats
	};
	availableProviders: ProviderMetadata[];

	// Actions
	setPromptSource: (source: PromptSource) => void;
	setPromptVariable: (key: string, value: string) => void;
	loadAvailableProviders: () => Promise<void>;
	addProviderNew: (provider: string, model: string, hasVaultConfig: boolean) => void;
	removeProviderNew: (index: number) => void;
	setProviderConfigNew: (index: number, config: Record<string, any>) => void;
	updateProviderModel: (index: number, model: string) => void;
	setEvaluatedData: (data: ProviderResult[]) => void;
	setEvaluatedLoading: (loading: boolean) => void;
	reset: () => void;

	// Legacy actions (keep for backward compatibility during migration)
	setProviderConfig: (path: string, value: any) => void;
	setPrompt: (prompt: string) => void;
	addProvider: (
		provider: Providers,
		configObject?: Record<string, any>
	) => void;
	removeProvider: (index: number) => void;
};
