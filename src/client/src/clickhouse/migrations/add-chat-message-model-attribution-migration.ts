import migrationHelper from "./migration-helper";

const MIGRATION_ID = "add-chat-message-model-attribution";

const CHAT_MESSAGE_TABLE = "openlit_chat_message";

export default async function AddChatMessageModelAttributionMigration(
	databaseConfigId?: string
) {
	const queries = [
		`ALTER TABLE ${CHAT_MESSAGE_TABLE} ADD COLUMN IF NOT EXISTS provider String DEFAULT '' AFTER cost`,
		`ALTER TABLE ${CHAT_MESSAGE_TABLE} ADD COLUMN IF NOT EXISTS model String DEFAULT '' AFTER provider`,
	];

	const { migrationExist, queriesRun } = await migrationHelper({
		clickhouseMigrationId: MIGRATION_ID,
		databaseConfigId,
		queries,
	});

	return { migrationExist, queriesRun };
}
