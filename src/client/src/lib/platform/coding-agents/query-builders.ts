/**
 * Pure SQL-builder helpers for the coding-agents query layer.
 *
 * This file is split out from `queries.ts` so the helpers can be
 * unit-tested without importing the database / session / auth
 * surface that the runtime callers depend on. Anything in here
 * must remain dependency-free of:
 *
 *   - `next-auth` (pulls in openid-client during jest module init)
 *   - the ClickHouse client / db-config plumbing
 *   - any browser-only utilities
 *
 * If you're adding a function with side effects (e.g. it runs a
 * query) it belongs in `queries.ts`, not here.
 */

/**
 * escape encodes a string for safe interpolation into a single-
 * quoted ClickHouse literal. We escape backslashes first (so the
 * later apostrophe substitution doesn't double-escape its own
 * output) and then escape single quotes with a backslash, matching
 * the historical helper that lived inline in `queries.ts`.
 *
 * Callers should still prefer parameterized query helpers wherever
 * they exist — this escape is the floor, not the ceiling.
 */
export function escape(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * SessionsHavingOptions is the narrow shape of the options object
 * that `buildSessionsHaving` cares about. We don't import the full
 * `ListSessionsOptions` to keep this file dependency-free; the
 * runtime caller passes the full struct and we only read the
 * filter-relevant subset.
 *
 * The string fields accept `null` as well as `undefined` because
 * the real `ListSessionsOptions` in `queries.ts` is sourced from
 * URL search params that explicitly pass `null` to mean "no
 * filter" (the API request layer treats `undefined` as
 * "untouched"). Narrowing to `string | undefined` here would
 * force every caller into a `?? undefined` dance and was the
 * source of the docker-build typecheck regression that prompted
 * this comment.
 */
export interface SessionsHavingOptions {
	vendor?: string | null;
	user?: string | null;
	classification?: string | null;
	includeSubagents?: boolean;
}

/**
 * buildSessionsHaving composes the HAVING clause for `listSessions`'s
 * post-aggregation filter set.
 *
 * Filters are applied AFTER aggregation so the coalesced
 * vendor/user values are filtered correctly (the same coalesce
 * chain that produces the row is what we filter on). This avoids
 * a regression where filtering on user='alice' rejected rows
 * where alice's identity only lived on `user.email` or fell
 * through to the `service.name` fallback.
 */
export function buildSessionsHaving(opts: SessionsHavingOptions): string {
	const havingClauses: string[] = [];
	if (opts.vendor) {
		havingClauses.push(`vendor = '${escape(opts.vendor)}'`);
	}
	if (opts.user) {
		havingClauses.push(`user = '${escape(opts.user)}'`);
	}
	if (opts.classification) {
		havingClauses.push(`classification = '${escape(opts.classification)}'`);
	}
	// Hide subagent rows by default: they fold under the parent chat
	// via CHAT_ID_EXPR; listing them at the top level produces
	// duplicate-looking rows for one user-perceived chat. Callers
	// debugging linkage gaps can opt back in.
	if (!opts.includeSubagents) {
		havingClauses.push(`is_subagent = 0`);
	}
	return havingClauses.length
		? `HAVING ${havingClauses.join(" AND ")}`
		: "";
}
