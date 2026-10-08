/**
 * CE fallback for API key route protection and audit hooks.
 * Enterprise replaces this neutral module through its path aliases.
 */
export type ApiKeyAction = "read" | "create" | "update" | "delete";

export function withApiKeyAccess<THandler>(
	_action: ApiKeyAction,
	handler: THandler
): THandler {
	return handler;
}

export function withApiKeyAudit<THandler>(handler: THandler): THandler {
	return handler;
}
