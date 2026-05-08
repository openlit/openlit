import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-trace-analysis-worst-severity";
const TRACE_ANALYSIS_TABLE = "openlit_trace_analysis";

export default async function AddTraceAnalysisWorstSeverityMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${TRACE_ANALYSIS_TABLE} ADD COLUMN IF NOT EXISTS worst_severity String DEFAULT ''`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
