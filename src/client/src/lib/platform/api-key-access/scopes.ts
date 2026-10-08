// Community edition: API keys are not scoped and have access to every
// API-key-enabled feature. The enterprise build overrides this module.

export type ApiKeyScope = string;

export type ApiKeyScopeDefinition = {
	id: ApiKeyScope;
	label: string;
	description: string;
	pathPrefixes: string[];
	grantPermission: string;
};

export const API_KEY_SCOPES: ApiKeyScopeDefinition[] = [];

export function isApiKeyScope(_value: unknown): _value is ApiKeyScope {
	return false;
}

export function normalizeApiKeyScopes(_values: unknown): ApiKeyScope[] {
	return [];
}

export function isApiKeyPathAllowed(
	_pathname: string,
	_scopes: string[] | null | undefined
): boolean {
	return true;
}

export function isApiKeyScopeAllowed(
	_scopes: string[] | null | undefined,
	_scope: ApiKeyScope
): boolean {
	return true;
}

export const API_KEY_SCOPES_ENABLED = false;
