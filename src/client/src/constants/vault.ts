export interface SecretInput {
	id?: string;
	key: string;
	value: string;
	tags: string[];
}

export interface SecretGetFilters {
	databaseConfigId?: string;
	tags?: string[];
	key?: string;
}

export interface SecretGetFiltersWithApiKey extends SecretGetFilters {
	apiKey: string;
}
