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
import GeneralizeControllerDesiredStatesMigration from "./generalize-controller-desired-states-migration";
import CreateChatMigration from "./create-chat-migration";
import CreateProvidersMigration from "./create-providers-migration";
import CreateProviderMetadataMigration from "./create-provider-metadata-migration";
import DropLegacyOpengroundTablesMigration from "./drop-legacy-openground-tables-migration";
import EncryptVaultValuesMigration from "./encrypt-vault-values-migration";
import AddControllerSkippingIndexesMigration from "./add-controller-skipping-indexes-migration";

export default async function migrations(databaseConfigId?: string) {
	// Group 1: Independent table creations (safe to parallel)
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
		CreateChatMigration(databaseConfigId),
	]);

	// Group 2: Controller schema modifications (must be sequential --
	// each ALTER/CREATE depends on the previous step completing)
	await AlterControllerModeMigration(databaseConfigId);
	await AddControllerResourceAttrsMigration(databaseConfigId);
	await AddControllerWorkloadKeyMigration(databaseConfigId);
	await AddControllerSDKActionsMigration(databaseConfigId);
	await AddControllerTTLMigration(databaseConfigId);
	await AddControllerDesiredStateMigration(databaseConfigId);
	await AddControllerClusterIdMigration(databaseConfigId);
	await UpdateControllerActionsTTLMigration(databaseConfigId);
	await CreateControllerDesiredStatesTableMigration(databaseConfigId);
	await GeneralizeControllerDesiredStatesMigration(databaseConfigId);
	await AddControllerSkippingIndexesMigration(databaseConfigId);

	// Group 3: Provider migrations (sequential -- metadata depends on providers)
	await CreateProvidersMigration(databaseConfigId);
	await Promise.all([
		CreateProviderMetadataMigration(databaseConfigId),
		DropLegacyOpengroundTablesMigration(databaseConfigId),
	]);

	await EncryptVaultValuesMigration(databaseConfigId);
}
