import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-chat-conversation-type";

const CHAT_CONVERSATION_TABLE = "openlit_chat_conversation";

export default async function AddChatConversationTypeMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CHAT_CONVERSATION_TABLE} ADD COLUMN IF NOT EXISTS conversation_type String DEFAULT 'chat' AFTER title`,
		`ALTER TABLE ${CHAT_CONVERSATION_TABLE} ADD COLUMN IF NOT EXISTS meta String DEFAULT '{}' AFTER conversation_type`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
