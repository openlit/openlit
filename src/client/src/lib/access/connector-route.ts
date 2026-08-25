/**
 * CE fallback for connector route protection and audit hooks.
 * Enterprise replaces this neutral module through its path aliases.
 */
export type ConnectorAction = "read" | "create" | "update" | "delete" | "test" | "bind";

export function withConnectorAccess<THandler>(
	_action: ConnectorAction,
	handler: THandler
): THandler {
	return handler;
}

export function withConnectorAudit<THandler>(handler: THandler): THandler {
	return handler;
}

