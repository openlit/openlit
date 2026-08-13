/**
 * CE fallback: premium connector types are gated only by adapter registration
 * and the visible-types allow-list. Enterprise overrides this module to enforce
 * entitlements for paid datasource connectors (Datadog, New Relic, …).
 */
export async function assertPremiumConnectorAllowed(
	_type: string
): Promise<void> {
	// no-op in CE
}

/**
 * CE fallback: catalog UI never locks types by plan. Enterprise returns which
 * premium datasource types should show as locked for the current organisation.
 */
export async function getConnectorCatalogLocks(): Promise<{
	entitled: boolean;
	premiumTypes: ReadonlySet<string>;
}> {
	return { entitled: true, premiumTypes: new Set() };
}
