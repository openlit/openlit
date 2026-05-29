import {
	AGENTS_SUMMARY_TABLE,
	AGENT_VERSIONS_TABLE,
} from "@/lib/platform/agents/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "optimize-agent-tables-storage-2026-05-12";

/**
 * Storage-efficiency tweaks to the two agent ReplacingMergeTree tables.
 *
 *   1. `openlit_agent_versions`: `system_prompt`, `tools`, and
 *      `runtime_config` are JSON blobs that compress *extremely* well with
 *      ZSTD because they share repeated keys/values across versions. The
 *      default LZ4 codec works, but ZSTD(3) routinely gives ~3x better
 *      compression on prompt and schema payloads at a small CPU cost. The
 *      reads from these columns are slow-path (Definition tab, version
 *      drawer) so the trade-off is right.
 *
 *   2. `openlit_agents_summary`: `environment`, `cluster_id`, and
 *      `sdk_language` are de-facto enums. A typical tenant has 1–3 distinct
 *      values across thousands of agent rows. Converting them to
 *      `LowCardinality(String)` saves disk and dramatically speeds up
 *      filter predicates on those columns.
 *
 * `MODIFY COLUMN` is idempotent in the sense that re-running it on an
 * already-converted column is a metadata-only no-op. The migration runner
 * also records the `MIGRATION_ID` and short-circuits on subsequent boots,
 * so the rewrite cost is paid exactly once per deployment.
 */
export default async function OptimizeAgentTablesStorageMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${AGENT_VERSIONS_TABLE}
			MODIFY COLUMN system_prompt String DEFAULT '' CODEC(ZSTD(3))`,
		`ALTER TABLE ${AGENT_VERSIONS_TABLE}
			MODIFY COLUMN tools String DEFAULT '[]' CODEC(ZSTD(3))`,
		`ALTER TABLE ${AGENT_VERSIONS_TABLE}
			MODIFY COLUMN runtime_config String DEFAULT '{}' CODEC(ZSTD(3))`,
		// `environment` is part of the existing bloom_filter skip index
		// `idx_environment`. ClickHouse refuses to MODIFY a column that's
		// referenced by an index, so we drop the index first, rewrite the
		// column as LowCardinality(String), then re-create + materialise the
		// index against the new column type. The drop is `IF EXISTS` so the
		// migration is safe on fresh clusters (where the original CREATE
		// already used LowCardinality).
		`ALTER TABLE ${AGENTS_SUMMARY_TABLE} DROP INDEX IF EXISTS idx_environment`,
		`ALTER TABLE ${AGENTS_SUMMARY_TABLE}
			MODIFY COLUMN environment LowCardinality(String) DEFAULT 'default'`,
		`ALTER TABLE ${AGENTS_SUMMARY_TABLE}
			ADD INDEX IF NOT EXISTS idx_environment environment TYPE bloom_filter GRANULARITY 1`,
		`ALTER TABLE ${AGENTS_SUMMARY_TABLE} MATERIALIZE INDEX idx_environment`,
		`ALTER TABLE ${AGENTS_SUMMARY_TABLE}
			MODIFY COLUMN cluster_id LowCardinality(String) DEFAULT 'default'`,
		`ALTER TABLE ${AGENTS_SUMMARY_TABLE}
			MODIFY COLUMN sdk_language LowCardinality(String) DEFAULT ''`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
