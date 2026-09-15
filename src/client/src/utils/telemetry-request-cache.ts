/**
 * Short-lived browser cache for read-only Telemetry / metrics POSTs.
 * Tab remounts and 1m poll windows reuse the last response instead of
 * re-triggering expensive external L1 sampling on every navigation.
 */

interface CacheEntry {
	value: unknown;
	expiresAt: number;
}

const store = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 45_000;
/** Floor relative-range timestamps so remounts within the poll window share a key. */
const TIME_QUANTUM_MS = 30_000;
const MAX_ENTRIES = 80;

const CACHEABLE_URL =
	/^\/api\/(metrics|telemetry)\b/;

function prune(now: number) {
	for (const [key, entry] of Array.from(store.entries())) {
		if (entry.expiresAt <= now) store.delete(key);
	}
	while (store.size > MAX_ENTRIES) {
		const oldest = store.keys().next().value;
		if (oldest === undefined) break;
		store.delete(oldest);
	}
}

/** True for Telemetry/metrics read routes that are safe to cache briefly. */
export function isCacheableTelemetryUrl(url: string): boolean {
	try {
		const path = url.startsWith("http") ? new URL(url).pathname : url;
		return CACHEABLE_URL.test(path);
	} catch {
		return false;
	}
}

function quantizeIso(value: unknown): unknown {
	if (typeof value !== "string" && !(value instanceof Date)) return value;
	const d = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(d.getTime())) return value;
	const floored = Math.floor(d.getTime() / TIME_QUANTUM_MS) * TIME_QUANTUM_MS;
	return new Date(floored).toISOString();
}

/**
 * Normalize request bodies so relative time-range remounts (end=now()) share
 * a cache key within TIME_QUANTUM_MS. CUSTOM ranges with fixed ends are left
 * as-is after ISO normalization.
 */
export function normalizeTelemetryCacheBody(body: string | undefined): string {
	if (!body) return "";
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>;
		const timeLimit = parsed.timeLimit as Record<string, unknown> | undefined;
		if (timeLimit && typeof timeLimit === "object") {
			const type = String(timeLimit.type || "");
			if (type && type !== "CUSTOM") {
				parsed.timeLimit = {
					...timeLimit,
					start: quantizeIso(timeLimit.start),
					end: quantizeIso(timeLimit.end),
				};
			} else if (type === "CUSTOM") {
				parsed.timeLimit = {
					...timeLimit,
					start:
						typeof timeLimit.start === "string" || timeLimit.start instanceof Date
							? new Date(timeLimit.start as string | Date).toISOString()
							: timeLimit.start,
					end:
						typeof timeLimit.end === "string" || timeLimit.end instanceof Date
							? new Date(timeLimit.end as string | Date).toISOString()
							: timeLimit.end,
				};
			}
		}
		return JSON.stringify(parsed);
	} catch {
		return body;
	}
}

function cacheKeyFor(url: string, body: string | undefined): string {
	return `${url}::${normalizeTelemetryCacheBody(body)}`;
}

/** Synchronous peek for stale-while-revalidate UI seeding. */
export function peekTelemetryRequestCache<T = unknown>(
	url: string,
	body: string | undefined
): T | null {
	if (!isCacheableTelemetryUrl(url)) return null;
	const key = cacheKeyFor(url, body);
	const hit = store.get(key);
	if (!hit || hit.expiresAt <= Date.now()) return null;
	return hit.value as T;
}

export async function withTelemetryRequestCache<T>(
	url: string,
	body: string | undefined,
	loader: () => Promise<T>,
	ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
	if (!isCacheableTelemetryUrl(url)) return loader();

	const key = cacheKeyFor(url, body);
	const now = Date.now();
	const hit = store.get(key);
	if (hit && hit.expiresAt > now) return hit.value as T;

	const pending = inFlight.get(key);
	if (pending) return pending as Promise<T>;

	const promise = (async () => {
		try {
			const value = await loader();
			store.set(key, { value, expiresAt: Date.now() + ttlMs });
			prune(Date.now());
			return value;
		} finally {
			inFlight.delete(key);
		}
	})();
	inFlight.set(key, promise);
	return promise;
}

/** Test-only. */
export function __clearTelemetryRequestCache() {
	store.clear();
	inFlight.clear();
}
