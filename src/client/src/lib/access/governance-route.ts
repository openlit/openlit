/**
 * CE fallback for governance route protection and audit hooks.
 * Enterprise replaces this neutral module through its path aliases.
 */
export type GovernanceAction = "read" | "export";

export function withGovernanceAccess<THandler>(
	_action: GovernanceAction,
	handler: THandler
): THandler {
	return handler;
}

export function withGovernanceAudit<THandler>(handler: THandler): THandler {
	return handler;
}
