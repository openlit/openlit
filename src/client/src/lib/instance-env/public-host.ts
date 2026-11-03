import { lookup } from "dns/promises";
import { isPrivateIp } from "./values";

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { publicHost: boolean; expiresAt: number }>();

/**
 * Resolves a hostname and reports whether every address is public. Used before
 * OpenLIT makes server-side requests to an admin-configured host such as the
 * Okta issuer, so a public-looking name cannot point at an internal service.
 */
export async function resolvesToPublicHost(hostname: string): Promise<boolean> {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	const cached = cache.get(host);
	if (cached && cached.expiresAt > Date.now()) return cached.publicHost;

	let publicHost = false;
	try {
		const addresses = await lookup(host, { all: true });
		publicHost = addresses.length > 0 && !addresses.some((entry) => isPrivateIp(entry.address));
	} catch {
		publicHost = false;
	}
	cache.set(host, { publicHost, expiresAt: Date.now() + CACHE_TTL_MS });
	return publicHost;
}

export function clearPublicHostCache() {
	cache.clear();
}
