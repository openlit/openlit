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
import AddProviderModelsCachePricesMigration from "./add-provider-models-cache-prices-migration";
import CreateTelemetryRollupsMigration from "./create-telemetry-rollups-migration";
import AlterTelemetryRollupsDimensionsMigration from "./alter-telemetry-rollups-dimensions-migration";

type MigrationResult = {
	migrationExist?: boolean;
	queriesRun?: boolean;
	err?: unknown;
	data?: unknown;
};

function migrationSucceeded(result: unknown): result is MigrationResult {
	if (!result || typeof result !== "object") return false;

	const migrationResult = result as MigrationResult;
	if (migrationResult.err) return false;
	if (migrationResult.migrationExist === true) return true;
	if ("queriesRun" in migrationResult) {
		return migrationResult.queriesRun === true;
	}

	// A few legacy migrations return `{ data: ... }` instead of the
	// migrationHelper result shape. Keep accepting that successful contract,
	// while rejecting missing or unrecognised results.
	return "data" in migrationResult;
}

async function runMigration(name: string, migration: () => Promise<unknown>): Promise<MigrationResult> {
	const result = await migration();
	if (migrationSucceeded(result)) return result;

	const details = result && typeof result === "object" && "err" in result ? String((result as MigrationResult).err) : "the migration did not report successful completion";
	throw new Error(`ClickHouse migration "${name}" failed: ${details}`);
}

export default async function migrations(databaseConfigId?: string) {
	// Group 1: Independent table creations (safe to parallel)
	await Promise.all([
		runMigration("create-prompt", () => CreatePromptMigration(databaseConfigId)),
		runMigration("create-vault", () => CreateVaultMigration(databaseConfigId)),
		runMigration("create-evaluation", () => CreateEvaluationMigration(databaseConfigId)),
		runMigration("create-evaluation-type-defaults", () => CreateEvaluationTypeDefaultsMigration(databaseConfigId)),
		runMigration("create-cron-log", () => CreateCronLogMigration(databaseConfigId)),
		runMigration("create-custom-dashboards", () => CreateCustomDashboardsMigration(databaseConfigId)),
		runMigration("create-openground", () => CreateOpengroundMigration(databaseConfigId)),
		runMigration("create-rule-engine", () => CreateRuleEngineMigration(databaseConfigId)),
		runMigration("create-controller", () => CreateControllerMigration(databaseConfigId)),
		runMigration("create-chat", () => CreateChatMigration(databaseConfigId)),
		runMigration("create-agents-summary", () => CreateAgentsSummaryMigration(databaseConfigId)),
		runMigration("create-agent-versions", () => CreateAgentVersionsMigration(databaseConfigId)),
	]);

	// Group 2: Controller schema modifications (must be sequential --
	// each ALTER/CREATE depends on the previous step completing)
	await runMigration("alter-controller-mode", () => AlterControllerModeMigration(databaseConfigId));
	await runMigration("add-controller-resource-attrs", () => AddControllerResourceAttrsMigration(databaseConfigId));
	await runMigration("add-controller-workload-key", () => AddControllerWorkloadKeyMigration(databaseConfigId));
	await runMigration("add-controller-sdk-actions", () => AddControllerSDKActionsMigration(databaseConfigId));
	await runMigration("add-controller-ttl", () => AddControllerTTLMigration(databaseConfigId));
	await runMigration("add-controller-cluster-id", () => AddControllerClusterIdMigration(databaseConfigId));
	await runMigration("update-controller-actions-ttl", () => UpdateControllerActionsTTLMigration(databaseConfigId));
	await runMigration("generalize-controller-desired-states", () => GeneralizeControllerDesiredStatesMigration(databaseConfigId));
	await runMigration("add-controller-skipping-indexes", () => AddControllerSkippingIndexesMigration(databaseConfigId));

	// Group 3: Provider migrations (sequential -- metadata depends on providers)
	await runMigration("create-providers", () => CreateProvidersMigration(databaseConfigId));
	await runMigration("add-provider-models-cache-prices", () => AddProviderModelsCachePricesMigration(databaseConfigId));
	await Promise.all([
		runMigration("create-provider-metadata", () => CreateProviderMetadataMigration(databaseConfigId)),
		runMigration("drop-legacy-openground-tables", () => DropLegacyOpengroundTablesMigration(databaseConfigId)),
	]);

	await runMigration("encrypt-vault-values", () => EncryptVaultValuesMigration(databaseConfigId));
	await runMigration("add-chat-conversation-type", () => AddChatConversationTypeMigration(databaseConfigId));
	await runMigration("add-chat-message-model-attribution", () => AddChatMessageModelAttributionMigration(databaseConfigId));
	await runMigration("create-trace-analysis", () => CreateTraceAnalysisMigration(databaseConfigId));
	await runMigration("create-otter-runs", () => CreateOtterRunsMigration(databaseConfigId));

	// Group 4: Agent table optimisations (sequential -- must run after the
	// agents-summary + agent-versions CREATEs).
	await runMigration("add-agents-summary-skip-indexes", () => AddAgentsSummarySkipIndexesMigration(databaseConfigId));
	await runMigration("optimize-agent-tables-storage", () => OptimizeAgentTablesStorageMigration(databaseConfigId));

	// Group 5: Coding-agent extensions (sequential — must run after
	// agents_summary exists; safe to parallel within itself).
	await Promise.all([
		runMigration("add-coding-agent-summary-fields", () => AddCodingAgentSummaryFieldsMigration(databaseConfigId)),
		runMigration("create-coding-agents-audit", () => CreateCodingAgentsAuditMigration(databaseConfigId)),
	]);

	// Group 6: LOC / commit / PR rollup columns. Must run after the
	// initial coding-agent summary fields migration because both ALTER
	// the same `openlit_agents_summary` table; ClickHouse serialises
	// ALTERs on a single table anyway, but ordering the awaits keeps
	// the dependency explicit.
	await runMigration("add-coding-agent-loc-summary-fields", () => AddCodingAgentLOCSummaryFieldsMigration(databaseConfigId));

	await runMigration("create-telemetry-rollups", () => CreateTelemetryRollupsMigration(databaseConfigId));
	await runMigration("alter-telemetry-rollups-dimensions", () => AlterTelemetryRollupsDimensionsMigration(databaseConfigId));

	// Group 7: Drop the never-populated v2 GitHub App VCS tables that
	// earlier deployments created via the now-removed
	// `create-vcs-migration`. Runs last so stale deployments still get
	// the cleanup, and uses IF EXISTS so fresh installs are no-ops.
	await runMigration("drop-vcs", () => DropVcsMigration(databaseConfigId));

	// Built-in dashboard seeding (LLM / Vector DB / GPU / Coding
	// Agents / future) lives inside `create-custom-dashboards-migration`
	// and runs on every boot via per-title idempotent upsert -- no
	// per-board one-off migration is needed when a new built-in board
	// is added to `SEEDED_DASHBOARDS` (see seed/dashboards.ts).
}
