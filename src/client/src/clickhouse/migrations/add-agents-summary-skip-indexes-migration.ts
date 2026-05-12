import { AGENTS_SUMMARY_TABLE } from "@/lib/platform/agents/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-agents-summary-skip-indexes-2026-05-12";

/**
 * Adds skip indexes to `openlit_agents_summary` to speed up two hot read
 * patterns observed in production:
 *
 *   1. "List recent agents" (the agents page default). The base query
 *      filters by `last_seen >= now() - INTERVAL N DAY`; without an index
 *      on `last_seen`, ClickHouse must scan every part. A
 *      `minmax` index lets it skip whole granules that fall outside the
 *      window.
 *
 *   2. "Count instrumented vs discovered" (configuration tab badge).
 *      Driven by `instrumentation_status` filter — a `set(3)` index gives
 *      us granule-level skipping for that low-cardinality column.
 *
 * Why NOT change `ORDER BY`: the table uses `ReplacingMergeTree(updated_at)`
 * with `ORDER BY (agent_key)`. Dedup happens on the ORDER BY tuple, so
 * moving `last_seen` into the leading position would mean two snapshots of
 * the same agent on different days would no longer be merged into a single
 * row. The skip-index approach gives us the query-time win without the
 * dedup regression.
 *
 * Both indexes are added with `IF NOT EXISTS` so the migration is safe to
 * run repeatedly; that matters because controller migrations historically
 * rely on idempotency.
 */
export default async function AddAgentsSummarySkipIndexesMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${AGENTS_SUMMARY_TABLE}
			ADD INDEX IF NOT EXISTS idx_last_seen last_seen TYPE minmax GRANULARITY 1`,
		`ALTER TABLE ${AGENTS_SUMMARY_TABLE}
			ADD INDEX IF NOT EXISTS idx_instrumentation_status instrumentation_status TYPE set(3) GRANULARITY 1`,
		// Materialise the indexes on existing parts so the first wave of
		// queries after deploy benefits from the skip indexes. Without this,
		// ClickHouse only applies the index to parts written after the ADD.
		`ALTER TABLE ${AGENTS_SUMMARY_TABLE} MATERIALIZE INDEX idx_last_seen`,
		`ALTER TABLE ${AGENTS_SUMMARY_TABLE} MATERIALIZE INDEX idx_instrumentation_status`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
