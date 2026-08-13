/**
 * Per-source in-memory query cache with TTL, in-flight de-duplication, and a
 * byte-aware soft budget so full OTLP payloads cannot grow RSS without bound.
 *
 * External vendors (notably Datadog: 300 spans req/hr) rate-limit aggressively,
 * so identical queries within a short window must be served from cache and
 * concurrent identical queries must share a single in-flight request.
 */

interface CacheEntry<T> {
	value: T;
	expiresAt: number;
	/** Approximate serialized size in bytes (UTF-8 JSON estimate). */
	bytes: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/** Soft cap so a long-lived process cannot grow the Map without bound. */
export const MAX_CACHE_ENTRIES = 500;

/** Soft RSS budget for cached payloads (entries + values). */
export const MAX_CACHE_BYTES = 64 * 1024 * 1024;

let totalBytes = 0;

/** Build a stable cache key from a source id and a query descriptor. */
export function cacheKey(sourceId: string, parts: unknown): string {
	return `${sourceId}::${stableStringify(parts)}`;
}

/** Approximate UTF-8 byte size of a cached value. */
export function estimateCacheBytes(value: unknown): number {
	try {
		const encoded = JSON.stringify(value) ?? "null";
		return typeof Buffer !== "undefined"
			? Buffer.byteLength(encoded, "utf8")
			: encoded.length;
	} catch {
		// Non-JSON-serializable values (rare): charge a conservative fixed cost.
		return 4 * 1024;
	}
}

function deleteEntry(key: string): void {
	const existing = store.get(key);
	if (!existing) return;
	totalBytes = Math.max(0, totalBytes - existing.bytes);
	store.delete(key);
}

function pruneExpired(now: number): void {
	for (const [key, entry] of Array.from(store.entries())) {
		if (entry.expiresAt <= now) deleteEntry(key);
	}
	while (store.size > MAX_CACHE_ENTRIES || totalBytes > MAX_CACHE_BYTES) {
		const oldest = store.keys().next().value;
		if (oldest === undefined) break;
		deleteEntry(oldest);
	}
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
			const expiresAt = Date.now() + ttlMs;
			const bytes = estimateCacheBytes(value);
			// Skip caching oversized single payloads that would dominate the budget.
			if (bytes <= MAX_CACHE_BYTES) {
				deleteEntry(key);
				store.set(key, { value, expiresAt, bytes });
				totalBytes += bytes;
			}
			pruneExpired(Date.now());
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
	totalBytes = 0;
}

/** Test-only: inspect cache accounting. */
export function __cacheStats(): { entries: number; bytes: number } {
	return { entries: store.size, bytes: totalBytes };
}
