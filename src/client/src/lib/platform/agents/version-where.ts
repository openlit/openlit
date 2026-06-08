/**
 * Pure SQL builder for agent-version filtering.
 *
 * Kept in its own leaf module — separate from `version-filter.ts` —
 * because callers in the request hot path (e.g. `helpers/server/platform`)
 * pull this in transitively. The sibling `version-filter.ts` imports
 * `lib/platform/common` (which in turn pulls `next-auth` / `openid-client`
 * / `jose` ESM), and dragging that chain into every importer balloons
 * cold-start cost AND breaks Jest's CJS module loader on the
 * `helpers/server/platform.test.ts` suite.
 *
 * This module deliberately has *no* runtime imports — just the
 * `VersionFilter` type.
 */
import type { VersionFilter } from "@/types/platform";
// Pure, side-effect-free helper (regex only) — safe to import here without
// dragging in the DB/next-auth chain this leaf module deliberately avoids.
import { escapeClickHouseString } from "@/lib/clickhouse-escape";

const escape = escapeClickHouseString;

/**
 * ClickHouse DateTime values round-trip best with second precision. Some
 * agent-version rows come back with `.SSS` from upstream serialisation; strip
 * them so we don't blow up `parseDateTimeBestEffort`.
 */
function toClickHouseDateTime(value: string | Date): string {
	if (typeof value === "string") {
		const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
		if (m) return `${m[1]} ${m[2]}`;
	}
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime())
		? new Date().toISOString().slice(0, 19).replace("T", " ")
		: d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Build the SQL fragment that scopes a query to a single agent version.
 * Returns the empty string when no version is provided so the caller can
 * concatenate unconditionally.
 *
 * Hybrid logic:
 * - Match `openlit.agent.version_hash` directly when the version has any
 *   stamped spans (the cheap, exact case).
 * - Always OR in the time window so spans missing the attribute still match
 *   (covers historical traces from older SDK versions / non-instrumented
 *   processes).
 */
export function buildVersionWhereClause(
	filter: VersionFilter | undefined | null
): string {
	if (!filter || !filter.versionHash) return "";
	const first = toClickHouseDateTime(filter.firstSeen);
	const last = toClickHouseDateTime(filter.lastSeen);
	const window = `Timestamp BETWEEN parseDateTimeBestEffort('${first}') AND parseDateTimeBestEffort('${last}')`;
	if (filter.hasAttributeSpans) {
		const hash = escape(filter.versionHash);
		return `(SpanAttributes['openlit.agent.version_hash'] = '${hash}' OR (SpanAttributes['openlit.agent.version_hash'] = '' AND ${window}))`;
	}
	return `(${window})`;
}
