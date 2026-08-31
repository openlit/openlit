/**
 * CE fallback for memory route protection and audit hooks.
 * Enterprise replaces this neutral module through its path aliases.
 *
 * Library callers (Otter chat tools) use requireMemoryAccess /
 * recordMemoryMutationAudit because they do not go through HTTP wrappers.
 */
export type MemoryAction = "read" | "create" | "update" | "delete" | "feedback";

export type MemoryMutationAuditInput = {
	action: Exclude<MemoryAction, "read">;
	targetId?: string;
	connectorId?: string;
	userId?: string;
	sessionId?: string;
	agentId?: string;
	contentLength?: number;
	rating?: unknown;
	hasReason?: boolean;
	source?: string;
};

export function withMemoryAccess<THandler>(
	_action: MemoryAction,
	handler: THandler
): THandler {
	return handler;
}

export function withMemoryAudit<THandler>(handler: THandler): THandler {
	return handler;
}

export async function requireMemoryAccess(_action: MemoryAction): Promise<void> {}

export async function recordMemoryMutationAudit(
	_input: MemoryMutationAuditInput
): Promise<void> {}
