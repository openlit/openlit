/**
 * CE fallback for scanner route protection and audit hooks.
 * Enterprise replaces this neutral module through its path aliases.
 *
 * Library callers (Otter chat tools) use requireScannerAccess because they
 * do not go through HTTP wrappers.
 */
export type ScannerAction = "read" | "create" | "scan" | "install";

export function withScannerAccess<THandler>(
	_action: ScannerAction,
	handler: THandler
): THandler {
	return handler;
}

export function withScannerAudit<THandler>(handler: THandler): THandler {
	return handler;
}

export async function requireScannerAccess(_action: ScannerAction): Promise<void> {}
