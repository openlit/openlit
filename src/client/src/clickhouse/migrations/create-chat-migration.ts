import migrationHelper from "./migration-helper";

const MIGRATION_ID = "create-chat-tables-v2";

const CHAT_CONFIG_TABLE = "openlit_chat_config";
const CHAT_CONVERSATION_TABLE = "openlit_chat_conversation";
const CHAT_MESSAGE_TABLE = "openlit_chat_message";

export default async function CreateChatMigration(
	databaseConfigId?: string
) {
	const queries = [
		`
		CREATE TABLE IF NOT EXISTS ${CHAT_CONFIG_TABLE} (
			id UUID DEFAULT generateUUIDv4(),
			provider String,
			model String,
			vault_id String,
			meta String DEFAULT '{}',
			created_at DateTime DEFAULT now(),
			updated_at DateTime DEFAULT now(),

			INDEX id_index (id) TYPE bloom_filter GRANULARITY 1,
			INDEX created_at_index (created_at) TYPE minmax GRANULARITY 1,
			INDEX updated_at_index (updated_at) TYPE minmax GRANULARITY 1,

			PRIMARY KEY id
		) ENGINE = ReplacingMergeTree(updated_at)
		ORDER BY (id)
		`,
		`
		CREATE TABLE IF NOT EXISTS ${CHAT_CONVERSATION_TABLE} (
			id UUID DEFAULT generateUUIDv4(),
			title String DEFAULT '',
			total_prompt_tokens UInt64 DEFAULT 0,
			total_completion_tokens UInt64 DEFAULT 0,
			total_cost Float64 DEFAULT 0,
			total_messages UInt32 DEFAULT 0,
			provider String DEFAULT '',
			model String DEFAULT '',
			created_at DateTime DEFAULT now(),
			updated_at DateTime DEFAULT now(),

			INDEX title_index (title) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1,
			INDEX created_at_index (created_at) TYPE minmax GRANULARITY 1,
			INDEX updated_at_index (updated_at) TYPE minmax GRANULARITY 1,

			PRIMARY KEY id
		) ENGINE = MergeTree()
		ORDER BY (id, created_at)
		`,
		`
		CREATE TABLE IF NOT EXISTS ${CHAT_MESSAGE_TABLE} (
			id UUID DEFAULT generateUUIDv4(),
			conversation_id UUID,
			role String,
			content String,
			sql_query String DEFAULT '',
			query_result String DEFAULT '',
			widget_type String DEFAULT '',
			prompt_tokens UInt64 DEFAULT 0,
			completion_tokens UInt64 DEFAULT 0,
			cost Float64 DEFAULT 0,
			query_rows_read UInt64 DEFAULT 0,
			query_execution_time_ms UInt64 DEFAULT 0,
			query_bytes_read UInt64 DEFAULT 0,
			created_at DateTime DEFAULT now(),

			INDEX conversation_id_index (conversation_id) TYPE bloom_filter GRANULARITY 1,
			INDEX role_index (role) TYPE bloom_filter GRANULARITY 1,
			INDEX created_at_index (created_at) TYPE minmax GRANULARITY 1,

			PRIMARY KEY id
		) ENGINE = MergeTree()
		ORDER BY (id, conversation_id, created_at)
		`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
