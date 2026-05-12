/**
 * Cache-Control header policies for `/api/agents/**` read routes.
 *
 * Mirrors (and reinforces) the in-process SWR cache the data layer already
 * uses, but on the HTTP transport so:
 *
 *   - Browser back/forward returns cached responses without re-fetching.
 *   - CDNs / edge proxies (Vercel, Cloudflare) can serve repeated reads
 *     without round-tripping to the origin.
 *   - SWR-aware fetchers reuse the same response across components on the
 *     same page render without re-validating immediately.
 *
 * `s-maxage` controls the shared-cache (CDN/edge) freshness window.
 * `stale-while-revalidate` lets the cache serve a stale response while it
 * triggers a background refresh -- the user always gets an instant render.
 *
 * Tunables are conservative; the underlying materializer cron refreshes
 * every ~30s and per-agent invalidation triggers an immediate cache bust
 * via the SWR layer in `lib/platform/agents/cache.ts`.
 */
export const CACHE_HEADERS = {
	/**
	 * Volatile data (agents list, request counts) -- short cache, longer
	 * stale window so the UI feels snappy on rapid page transitions.
	 */
	list: "private, max-age=5, s-maxage=15, stale-while-revalidate=60",
	/**
	 * Per-agent detail (summary card, snapshot). Versions don't change
	 * second-to-second; a slightly longer cache is safe.
	 */
	detail: "private, max-age=10, s-maxage=30, stale-while-revalidate=120",
	/**
	 * Version history and per-version artifacts (system prompt, tools). These
	 * are immutable once the materializer writes them -- aggressive cache.
	 */
	versions: "private, max-age=60, s-maxage=300, stale-while-revalidate=600",
	/**
	 * Aggregate DAG. Backed by a wider trace sample so the underlying data
	 * shifts as new requests come in.
	 */
	graph: "private, max-age=15, s-maxage=60, stale-while-revalidate=300",
	/**
	 * Version timeline (bar chart). Stable per-version, refreshes on new
	 * traffic.
	 */
	timeline: "private, max-age=30, s-maxage=60, stale-while-revalidate=300",
} as const;

export type CachePolicy = keyof typeof CACHE_HEADERS;

export function withCacheHeaders(
	body: unknown,
	policy: CachePolicy,
	init: ResponseInit = {}
): Response {
	const headers = new Headers(init.headers);
	headers.set("Cache-Control", CACHE_HEADERS[policy]);
	// Differentiate cached responses per `versionHash` query param without
	// forcing CDNs to vary on full URL. Most CDNs vary on the URL anyway --
	// this is belt-and-suspenders.
	headers.append("Vary", "Cookie");
	return Response.json(body, { ...init, headers });
}
