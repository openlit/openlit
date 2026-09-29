/**
 * CE fallback: no paid nav routes, so sidebar never shows lock icons.
 * Enterprise overrides this to read entitlement state for route-prefixed features.
 */
export function useIsNavLinkLocked(_link?: string): boolean {
	return false;
}
