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
