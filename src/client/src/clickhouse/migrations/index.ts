import createPromptMigration from "./create-prompt-migration";

export default async function migrations(databaseConfigId?: string) {
	await createPromptMigration(databaseConfigId);
}
