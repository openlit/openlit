import { AGENTS_SUMMARY_TABLE } from "@/lib/platform/agents/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-agents-summary-table";

export default async function CreateAgentsSummaryMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${AGENTS_SUMMARY_TABLE} (
			agent_key String,
			service_name String,
			environment String DEFAULT 'default',
			cluster_id String DEFAULT 'default',
			workload_key String DEFAULT '',
			source Enum8('controller' = 0, 'sdk' = 1, 'both' = 2) DEFAULT 'sdk',
			controller_service_id String DEFAULT '',
			controller_instance_id String DEFAULT '',
			primary_model String DEFAULT '',
			models Array(String),
			providers Array(String),
			tool_names Array(String),
			tool_count UInt32 DEFAULT 0,
			request_count_24h UInt64 DEFAULT 0,
			current_version_hash String DEFAULT '',
			current_version_number UInt32 DEFAULT 0,
			sdk_version String DEFAULT '',
			sdk_language String DEFAULT '',
			instrumentation_status Enum8('discovered' = 0, 'instrumented' = 1) DEFAULT 'discovered',
			last_materialized_at DateTime DEFAULT now(),
			first_seen DateTime DEFAULT now(),
			last_seen DateTime DEFAULT now(),
			updated_at DateTime DEFAULT now(),
			INDEX idx_service_name service_name TYPE bloom_filter GRANULARITY 1,
			INDEX idx_source source TYPE set(3) GRANULARITY 1,
			INDEX idx_environment environment TYPE bloom_filter GRANULARITY 1
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (agent_key)
		TTL last_seen + INTERVAL 90 DAY DELETE
		SETTINGS index_granularity = 8192;
		`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
