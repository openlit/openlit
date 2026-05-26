/**
 * Single-flight in-process LRU with stale-while-revalidate semantics.
 *
 * Policy
 *  - Fresh entry (now < freshUntil) → return immediately, no loader call.
 *  - Stale entry (freshUntil ≤ now < staleUntil) → return stale value AND
 *    kick off a background refresh. The next caller sees the updated value.
 *  - Expired / missing entry → await loader. Concurrent callers for the same
 *    key share the same in-flight promise so a thundering herd collapses to
 *    one DB call.
 *
 * The cache is intentionally process-local. The materializer keeps the
 * underlying ClickHouse tables warm enough that even cold lookups are fast.
 */

type Entry<T> = {
	value: T;
	freshUntil: number;
	staleUntil: number;
};

const MAX_ENTRIES = 5_000;

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function touch<T>(key: string, entry: Entry<T>) {
	// Map preserves insertion order; re-insert to move to MRU position.
	store.delete(key);
	store.set(key, entry as Entry<unknown>);
}

function evictIfNeeded() {
	while (store.size > MAX_ENTRIES) {
		const oldestKey = store.keys().next().value;
		if (oldestKey === undefined) return;
		store.delete(oldestKey);
	}
}

function singleFlight<T>(key: string, loader: () => Promise<T>): Promise<T> {
	const existing = inflight.get(key);
	if (existing) return existing as Promise<T>;
	const promise = (async () => {
		try {
			return await loader();
		} finally {
			inflight.delete(key);
		}
	})();
	inflight.set(key, promise as Promise<unknown>);
	return promise;
}

export interface SWRPolicy {
	freshMs: number;
	staleMs: number;
}

/**
 * Cache the result of `loader` under `key` with stale-while-revalidate.
 */
export async function swr<T>(
	key: string,
	policy: SWRPolicy,
	loader: () => Promise<T>
): Promise<T> {
	const now = Date.now();
	const cached = store.get(key) as Entry<T> | undefined;

	if (cached && now < cached.freshUntil) {
		touch(key, cached);
		return cached.value;
	}

	if (cached && now < cached.staleUntil) {
		// Serve stale immediately, refresh in background.
		touch(key, cached);
		void singleFlight(key, loader)
			.then((value) => {
				store.set(key, {
					value: value as unknown,
					freshUntil: Date.now() + policy.freshMs,
					staleUntil: Date.now() + policy.freshMs + policy.staleMs,
				});
				evictIfNeeded();
			})
			.catch(() => {
				// Swallow background-refresh failures; next request will retry.
			});
		return cached.value;
	}

	const value = await singleFlight(key, loader);
	store.set(key, {
		value: value as unknown,
		freshUntil: Date.now() + policy.freshMs,
		staleUntil: Date.now() + policy.freshMs + policy.staleMs,
	});
	evictIfNeeded();
	return value as T;
}

/** Invalidate any cached entry for a given key. Used by /refresh endpoint. */
export function invalidate(key: string) {
	store.delete(key);
}

/** Invalidate every cached entry whose key starts with the given prefix. */
export function invalidatePrefix(prefix: string) {
	const target = prefix.endsWith("*") ? prefix.slice(0, -1) : prefix;
	for (const key of Array.from(store.keys())) {
		if (key.startsWith(target)) store.delete(key);
	}
}

/** Test-only: clear all cached entries. */
export function _resetForTests() {
	store.clear();
	inflight.clear();
}

/** Test-only: peek at cache size. */
export function _cacheSizeForTests() {
	return store.size;
}

// ── Predefined policies ──────────────────────────────────────────────────────

export const POLICY_LIST: SWRPolicy = { freshMs: 30_000, staleMs: 5 * 60_000 };
export const POLICY_DETAIL: SWRPolicy = { freshMs: 30_000, staleMs: 5 * 60_000 };
export const POLICY_VERSIONS: SWRPolicy = { freshMs: 5 * 60_000, staleMs: 60 * 60_000 };
export const POLICY_TOOLS: SWRPolicy = { freshMs: 5 * 60_000, staleMs: 60 * 60_000 };
