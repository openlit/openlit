export type ApiKey = {
	apiKey?: string;
	apiKeyPreview?: string;
	createdAt: string;
	createdByUser: {
		email: string;
	};
	id: string;
	name: string;
	// Enterprise per-feature access. `null` = full access.
	scopes?: string[] | null;
};
