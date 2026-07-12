/**
 * Neutral, OSS-safe placeholder for enterprise-only middleware matcher
 * routes. Empty in CE.
 *
 * WARNING: Do NOT spread this into `config.matcher` in `src/middleware.ts`.
 * Next.js statically analyzes the matcher at build time and cannot resolve a
 * spread of an imported binding, so it silently falls back to a
 * match-everything matcher (`^/.*$`). That makes the entire middleware stack
 * run on every request (static assets 500, public files redirect to /login).
 * Because Next requires a compile-time-constant matcher, the enterprise build
 * extends matched routes by overriding the filesystem-routed `src/middleware.ts`
 * with its own static literal — not by injecting values through this array.
 */
export const ENTERPRISE_MIDDLEWARE_MATCHERS: string[] = [];
