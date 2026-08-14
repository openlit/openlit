import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-trace-analysis-table";
const TRACE_ANALYSIS_TABLE = "openlit_trace_analysis";

export default async function CreateTraceAnalysisMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${TRACE_ANALYSIS_TABLE} (
			id UUID DEFAULT generateUUIDv4(),
			root_span_id String,
			selected_span_id String DEFAULT '',
			service_name String DEFAULT '',
			analysis_type String DEFAULT 'trace_analysis',
			run_number UInt32 DEFAULT 1,
			analysis_json String DEFAULT '{}',
			summary String DEFAULT '',
			overall_score Float64 DEFAULT 0,
			overall_grade String DEFAULT '',
			app_type String DEFAULT '',
			worst_severity String DEFAULT '',
			model_provider String DEFAULT '',
			model_name String DEFAULT '',
			prompt_tokens UInt64 DEFAULT 0,
			completion_tokens UInt64 DEFAULT 0,
			cost Float64 DEFAULT 0,
			created_at DateTime DEFAULT now(),
			INDEX root_span_id_index (root_span_id) TYPE bloom_filter GRANULARITY 1,
			INDEX analysis_type_index (analysis_type) TYPE bloom_filter GRANULARITY 1,
			INDEX created_at_index (created_at) TYPE minmax GRANULARITY 1
		) ENGINE = MergeTree()
		ORDER BY (root_span_id, run_number, created_at)
		`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
