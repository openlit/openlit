import CreateEvaluationMigration from "./create-evaluation-migration";
import CreateEvaluationTypeDefaultsMigration from "./create-evaluation-type-defaults-migration";
import CreateCronLogMigration from "./create-cron-log-migration";
import CreatePromptMigration from "./create-prompt-migration";
import CreateVaultMigration from "./create-vault-migration";
import CreateCustomDashboardsMigration from "./create-custom-dashboards-migration";
import CreateOpengroundMigration from "./create-openground-migration";
import CreateRuleEngineMigration from "./create-rule-engine-migration";
import CreateChatMigration from "./create-chat-migration";
import CreateProvidersMigration from "./create-providers-migration";
import CreateProviderMetadataMigration from "./create-provider-metadata-migration";
import DropLegacyOpengroundTablesMigration from "./drop-legacy-openground-tables-migration";

export default async function migrations(databaseConfigId?: string) {
	// Run base migrations in parallel
	await Promise.all([
		CreatePromptMigration(databaseConfigId),
		CreateVaultMigration(databaseConfigId),
		CreateEvaluationMigration(databaseConfigId),
		CreateEvaluationTypeDefaultsMigration(databaseConfigId),
		CreateCronLogMigration(databaseConfigId),
		CreateCustomDashboardsMigration(databaseConfigId),
		CreateOpengroundMigration(databaseConfigId),
		CreateRuleEngineMigration(databaseConfigId),
		CreateChatMigration(databaseConfigId),
	]);

	// Create new provider/model tables, copy any legacy data, seed defaults
	await CreateProvidersMigration(databaseConfigId);

	// Create provider metadata table + seed default providers, then drop legacy tables
	await Promise.all([
		CreateProviderMetadataMigration(databaseConfigId),
		DropLegacyOpengroundTablesMigration(databaseConfigId),
	]);
}
