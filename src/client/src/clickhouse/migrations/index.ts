import CreateEvaluationMigration from "./create-evaluation-migration";
import CreateEvaluationTypeDefaultsMigration from "./create-evaluation-type-defaults-migration";
import CreateCronLogMigration from "./create-cron-log-migration";
import CreatePromptMigration from "./create-prompt-migration";
import CreateVaultMigration from "./create-vault-migration";
import CreateCustomDashboardsMigration from "./create-custom-dashboards-migration";
import CreateOpengroundMigration from "./create-openground-migration";
import CreateRuleEngineMigration from "./create-rule-engine-migration";
import CreateControllerMigration from "./create-controller-migration";
import AlterControllerModeMigration from "./alter-controller-mode-migration";
import AddControllerResourceAttrsMigration from "./add-controller-resource-attrs-migration";
import AddControllerWorkloadKeyMigration from "./add-controller-workload-key-migration";
import AddControllerSDKActionsMigration from "./add-controller-sdk-actions-migration";
import AddControllerTTLMigration from "./add-controller-ttl-migration";
import AddControllerDesiredStateMigration from "./add-controller-desired-state-migration";
import AddControllerClusterIdMigration from "./add-controller-cluster-id-migration";
import UpdateControllerActionsTTLMigration from "./update-controller-actions-ttl-migration";
import CreateControllerDesiredStatesTableMigration from "./create-controller-desired-states-migration";
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
		CreateControllerMigration(databaseConfigId),
		AlterControllerModeMigration(databaseConfigId),
		AddControllerResourceAttrsMigration(databaseConfigId),
		AddControllerWorkloadKeyMigration(databaseConfigId),
		AddControllerSDKActionsMigration(databaseConfigId),
		AddControllerTTLMigration(databaseConfigId),
		AddControllerDesiredStateMigration(databaseConfigId),
		AddControllerClusterIdMigration(databaseConfigId),
		UpdateControllerActionsTTLMigration(databaseConfigId),
		CreateControllerDesiredStatesTableMigration(databaseConfigId),
		CreateChatMigration(databaseConfigId),
		// Create new provider/model tables, copy any legacy data, seed defaults
		await CreateProvidersMigration(databaseConfigId),
		// Create provider metadata table + seed default providers, then drop legacy tables
		CreateProviderMetadataMigration(databaseConfigId),
		DropLegacyOpengroundTablesMigration(databaseConfigId),
	]);
}
