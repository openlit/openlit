import { AGENT_VERSIONS_TABLE } from "@/lib/platform/agents/table-details";
import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-agent-versions-table";

export default async function CreateAgentVersionsMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${AGENT_VERSIONS_TABLE} (
			agent_key String,
			version_hash String,
			version_number UInt32,
			system_prompt String DEFAULT '',
			tools String DEFAULT '[]',
			primary_model String DEFAULT '',
			models Array(String),
			providers Array(String),
			runtime_config String DEFAULT '{}',
			first_seen DateTime DEFAULT now(),
			last_seen DateTime DEFAULT now(),
			request_count UInt64 DEFAULT 0,
			updated_at DateTime DEFAULT now()
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (agent_key, version_hash)
		TTL last_seen + INTERVAL 365 DAY DELETE
		SETTINGS index_granularity = 8192;
		`,
	];

	return migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});
}
