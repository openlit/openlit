import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-otter-runs-table";
const OTTER_RUNS_TABLE = "openlit_otter_runs";

export default async function CreateOtterRunsMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${OTTER_RUNS_TABLE} (
			id UUID DEFAULT generateUUIDv4(),
			run_type String,
			target_type String DEFAULT '',
			target_id String DEFAULT '',
			input_snapshot String DEFAULT '',
			result_json String DEFAULT '{}',
			summary String DEFAULT '',
			model_provider String DEFAULT '',
			model_name String DEFAULT '',
			prompt_tokens UInt64 DEFAULT 0,
			completion_tokens UInt64 DEFAULT 0,
			cost Float64 DEFAULT 0,
			meta String DEFAULT '{}',
			created_at DateTime DEFAULT now(),
			INDEX run_type_index (run_type) TYPE bloom_filter GRANULARITY 1,
			INDEX target_type_index (target_type) TYPE bloom_filter GRANULARITY 1,
			INDEX target_id_index (target_id) TYPE bloom_filter GRANULARITY 1,
			INDEX created_at_index (created_at) TYPE minmax GRANULARITY 1
		) ENGINE = MergeTree()
		ORDER BY (run_type, target_type, target_id, created_at)
		`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
