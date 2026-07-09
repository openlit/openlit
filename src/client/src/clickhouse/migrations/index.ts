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
import AddControllerClusterIdMigration from "./add-controller-cluster-id-migration";
import UpdateControllerActionsTTLMigration from "./update-controller-actions-ttl-migration";
import GeneralizeControllerDesiredStatesMigration from "./generalize-controller-desired-states-migration";
import CreateChatMigration from "./create-chat-migration";
import AddChatConversationTypeMigration from "./add-chat-conversation-type-migration";
import AddChatMessageModelAttributionMigration from "./add-chat-message-model-attribution-migration";
import CreateProvidersMigration from "./create-providers-migration";
import CreateProviderMetadataMigration from "./create-provider-metadata-migration";
import DropLegacyOpengroundTablesMigration from "./drop-legacy-openground-tables-migration";
import EncryptVaultValuesMigration from "./encrypt-vault-values-migration";
import AddControllerSkippingIndexesMigration from "./add-controller-skipping-indexes-migration";
import CreateTraceAnalysisMigration from "./create-trace-analysis-migration";
import CreateOtterRunsMigration from "./create-otter-runs-migration";
import CreateAgentsSummaryMigration from "./create-agents-summary-migration";
import CreateAgentVersionsMigration from "./create-agent-versions-migration";
import AddAgentsSummarySkipIndexesMigration from "./add-agents-summary-skip-indexes-migration";
import OptimizeAgentTablesStorageMigration from "./optimize-agent-tables-storage-migration";
import AddCodingAgentSummaryFieldsMigration from "./add-coding-agent-summary-fields-migration";
import AddCodingAgentLOCSummaryFieldsMigration from "./add-coding-agent-loc-summary-fields-migration";
import CreateCodingAgentsAuditMigration from "./create-coding-agents-audit-migration";
import DropVcsMigration from "./drop-vcs-migration";

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
		CreateAgentsSummaryMigration(databaseConfigId),
		CreateAgentVersionsMigration(databaseConfigId),
	]);

	// Group 2: Controller schema modifications (must be sequential --
	// each ALTER/CREATE depends on the previous step completing)
	await AlterControllerModeMigration(databaseConfigId);
	await AddControllerResourceAttrsMigration(databaseConfigId);
	await AddControllerWorkloadKeyMigration(databaseConfigId);
	await AddControllerSDKActionsMigration(databaseConfigId);
	await AddControllerTTLMigration(databaseConfigId);
	await AddControllerClusterIdMigration(databaseConfigId);
	await UpdateControllerActionsTTLMigration(databaseConfigId);
	await GeneralizeControllerDesiredStatesMigration(databaseConfigId);
	await AddControllerSkippingIndexesMigration(databaseConfigId);

	// Group 3: Provider migrations (sequential -- metadata depends on providers)
	await CreateProvidersMigration(databaseConfigId);
	await Promise.all([
		CreateProviderMetadataMigration(databaseConfigId),
		DropLegacyOpengroundTablesMigration(databaseConfigId),
	]);

	await EncryptVaultValuesMigration(databaseConfigId);
	await AddChatConversationTypeMigration(databaseConfigId);
	await AddChatMessageModelAttributionMigration(databaseConfigId);
	await CreateTraceAnalysisMigration(databaseConfigId);
	await CreateOtterRunsMigration(databaseConfigId);

	// Group 4: Agent table optimisations (sequential -- must run after the
	// agents-summary + agent-versions CREATEs).
	await AddAgentsSummarySkipIndexesMigration(databaseConfigId);
	await OptimizeAgentTablesStorageMigration(databaseConfigId);

	// Group 5: Coding-agent extensions (sequential — must run after
	// agents_summary exists; safe to parallel within itself).
	await Promise.all([
		AddCodingAgentSummaryFieldsMigration(databaseConfigId),
		CreateCodingAgentsAuditMigration(databaseConfigId),
	]);

	// Group 6: LOC / commit / PR rollup columns. Must run after the
	// initial coding-agent summary fields migration because both ALTER
	// the same `openlit_agents_summary` table; ClickHouse serialises
	// ALTERs on a single table anyway, but ordering the awaits keeps
	// the dependency explicit.
	await AddCodingAgentLOCSummaryFieldsMigration(databaseConfigId);

	// Group 7: Drop the never-populated v2 GitHub App VCS tables that
	// earlier deployments created via the now-removed
	// `create-vcs-migration`. Runs last so stale deployments still get
	// the cleanup, and uses IF EXISTS so fresh installs are no-ops.
	await DropVcsMigration(databaseConfigId);

	// Built-in dashboard seeding (LLM / Vector DB / GPU / Coding
	// Agents / future) lives inside `create-custom-dashboards-migration`
	// and runs on every boot via per-title idempotent upsert -- no
	// per-board one-off migration is needed when a new built-in board
	// is added to `SEEDED_DASHBOARDS` (see seed/dashboards.ts).
}
