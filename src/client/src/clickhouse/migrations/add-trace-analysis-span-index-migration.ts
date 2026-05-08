import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-trace-analysis-span-index";
const CHAT_CONVERSATION_TABLE = "openlit_chat_conversation";

export default async function AddTraceAnalysisSpanIndexMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CHAT_CONVERSATION_TABLE} ADD COLUMN IF NOT EXISTS root_span_id String DEFAULT ''`,
		`ALTER TABLE ${CHAT_CONVERSATION_TABLE} ADD COLUMN IF NOT EXISTS selected_span_id String DEFAULT ''`,
		`ALTER TABLE ${CHAT_CONVERSATION_TABLE} ADD INDEX IF NOT EXISTS root_span_id_index (root_span_id) TYPE bloom_filter GRANULARITY 1`,
		`ALTER TABLE ${CHAT_CONVERSATION_TABLE} MATERIALIZE INDEX root_span_id_index`,
		`ALTER TABLE ${CHAT_CONVERSATION_TABLE} ADD INDEX IF NOT EXISTS selected_span_id_index (selected_span_id) TYPE bloom_filter GRANULARITY 1`,
		`ALTER TABLE ${CHAT_CONVERSATION_TABLE} MATERIALIZE INDEX selected_span_id_index`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
