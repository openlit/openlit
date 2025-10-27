export interface OpengroundRequest {
	id: string;
	stats: string;
	createdByUser: {
			name: string;
			email: string;
	};
	databaseConfig: {
			name: string;
	};
}

export interface OpengroundStats {
	prompt: string;
	errors: string[];
	totalProviders: number;
	minCostProvider: string;
	minCost: number;
	minResponseTimeProvider: string;
	minResponseTime: number;
	minCompletionTokensProvider: string;
	minCompletionTokens: number;
}