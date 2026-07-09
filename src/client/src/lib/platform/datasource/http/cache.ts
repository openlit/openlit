/**
 * Per-source in-memory query cache with TTL and in-flight de-duplication.
 *
 * External vendors (notably Datadog: 300 spans req/hr) rate-limit aggressively,
 * so identical queries within a short window must be served from cache and
 * concurrent identical queries must share a single in-flight request.
 */

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/** Build a stable cache key from a source id and a query descriptor. */
export function cacheKey(sourceId: string, parts: unknown): string {
	return `${sourceId}::${stableStringify(parts)}`;
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const keys = Object.keys(value as Record<string, unknown>).sort();
	return `{${keys
		.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
		.join(",")}}`;
}

/**
 * Get-or-load with TTL + in-flight coalescing. Concurrent callers with the
 * same key await the same request; results are cached for `ttlMs`.
 */
export async function cachedQuery<T>(
	key: string,
	ttlMs: number,
	loader: () => Promise<T>
): Promise<T> {
	const now = Date.now();
	const hit = store.get(key);
	if (hit && hit.expiresAt > now) {
		return hit.value as T;
	}
	const pending = inFlight.get(key);
	if (pending) return pending as Promise<T>;

	const promise = (async () => {
		try {
			const value = await loader();
			store.set(key, { value, expiresAt: Date.now() + ttlMs });
			return value;
		} finally {
			inFlight.delete(key);
		}
	})();
	inFlight.set(key, promise);
	return promise;
}

/** Test-only / admin: clear the cache. */
export function __clearCache(): void {
	store.clear();
	inFlight.clear();
}
