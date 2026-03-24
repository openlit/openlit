import CreateEvaluationMigration from "./create-evaluation-migration";
import CreateEvaluationTypeDefaultsMigration from "./create-evaluation-type-defaults-migration";
import CreateCronLogMigration from "./create-cron-log-migration";
import CreatePromptMigration from "./create-prompt-migration";
import CreateVaultMigration from "./create-vault-migration";
import CreateCustomDashboardsMigration from "./create-custom-dashboards-migration";
import CreateOpengroundMigration from "./create-openground-migration";
import CreateOpengroundCustomModelsMigration from "./create-openground-custom-models-migration";
import CreateRuleEngineMigration from "./create-rule-engine-migration";
import EncryptVaultValuesMigration from "./encrypt-vault-values-migration";

export default async function migrations(databaseConfigId?: string) {
	// Run table creation migrations first
	await Promise.all([
		CreatePromptMigration(databaseConfigId),
		CreateVaultMigration(databaseConfigId),
		CreateEvaluationMigration(databaseConfigId),
		CreateEvaluationTypeDefaultsMigration(databaseConfigId),
		CreateCronLogMigration(databaseConfigId),
		CreateCustomDashboardsMigration(databaseConfigId),
		CreateOpengroundMigration(databaseConfigId),
		CreateOpengroundCustomModelsMigration(databaseConfigId),
		CreateRuleEngineMigration(databaseConfigId),
	]);

	// Run data migrations after table creation
	await Promise.all([
		EncryptVaultValuesMigration(databaseConfigId),
	]);
}
