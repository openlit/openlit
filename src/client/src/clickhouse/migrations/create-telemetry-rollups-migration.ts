import migrationHelper from "./migration-helper";
import {
	LLM_ROLLUPS_TABLE,
	SIGNAL_BUCKETS_TABLE,
	SPAN_HOT_CACHE_TABLE,
} from "@/lib/platform/telemetry/rollups";

const MIGRATION_ID = "create-telemetry-rollups-tables";

export default async function CreateTelemetryRollupsMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${SIGNAL_BUCKETS_TABLE} (
			source_id String,
			service LowCardinality(String) DEFAULT '',
			environment LowCardinality(String) DEFAULT '',
			bucket_start DateTime,
			request_count UInt64 DEFAULT 0,
			avg_duration_seconds Float64 DEFAULT 0,
			total_cost Float64 DEFAULT 0,
			total_tokens Float64 DEFAULT 0,
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (source_id, service, environment, bucket_start)
		TTL bucket_start + INTERVAL 90 DAY DELETE
		SETTINGS index_granularity = 8192;
		`,
		`
		CREATE TABLE IF NOT EXISTS ${LLM_ROLLUPS_TABLE} (
			source_id String,
			dimension LowCardinality(String),
			group_value String,
			service LowCardinality(String) DEFAULT '',
			environment LowCardinality(String) DEFAULT '',
			model LowCardinality(String) DEFAULT '',
			provider LowCardinality(String) DEFAULT '',
			window_start DateTime,
			window_end DateTime,
			request_count UInt64 DEFAULT 0,
			total_cost Float64 DEFAULT 0,
			total_tokens Float64 DEFAULT 0,
			avg_duration_seconds Float64 DEFAULT 0,
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (source_id, dimension, service, environment, group_value, window_start, window_end)
		TTL window_end + INTERVAL 90 DAY DELETE
		SETTINGS index_granularity = 8192;
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
		SETTINGS index_granularity = 8192;
		`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
