import migrationHelper from "./migration-helper";
import {
	LLM_ROLLUPS_TABLE,
	SIGNAL_BUCKETS_TABLE,
	SPAN_HOT_CACHE_TABLE,
} from "@/lib/platform/telemetry/rollups";

const MIGRATION_ID = "alter-telemetry-rollups-dimensions-and-hot-cache";

/**
 * Adds service/environment (and model/provider on LLM rollups) so scoped
 * agent/dashboard reads can use L2, plus a bounded recent-span hot cache.
 */
export default async function AlterTelemetryRollupsDimensionsMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		ALTER TABLE ${SIGNAL_BUCKETS_TABLE}
			ADD COLUMN IF NOT EXISTS service LowCardinality(String) DEFAULT '',
			ADD COLUMN IF NOT EXISTS environment LowCardinality(String) DEFAULT ''
		`,
		`
		ALTER TABLE ${LLM_ROLLUPS_TABLE}
			ADD COLUMN IF NOT EXISTS service LowCardinality(String) DEFAULT '',
			ADD COLUMN IF NOT EXISTS environment LowCardinality(String) DEFAULT '',
			ADD COLUMN IF NOT EXISTS model LowCardinality(String) DEFAULT '',
			ADD COLUMN IF NOT EXISTS provider LowCardinality(String) DEFAULT ''
		`,
		`
		CREATE TABLE IF NOT EXISTS ${SPAN_HOT_CACHE_TABLE} (
			source_id String,
			trace_id String,
			span_id String,
			parent_span_id String DEFAULT '',
			name String DEFAULT '',
			service_name LowCardinality(String) DEFAULT '',
			environment LowCardinality(String) DEFAULT '',
			timestamp DateTime64(3),
			duration_ns UInt64 DEFAULT 0,
			status_code LowCardinality(String) DEFAULT '',
			status_message String DEFAULT '',
			span_kind LowCardinality(String) DEFAULT '',
			span_attributes String DEFAULT '{}',
			resource_attributes String DEFAULT '{}',
			cost Float64 DEFAULT 0,
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (source_id, service_name, timestamp, trace_id, span_id)
		TTL toDateTime(timestamp) + INTERVAL 2 HOUR DELETE
		SETTINGS index_granularity = 8192
		`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
