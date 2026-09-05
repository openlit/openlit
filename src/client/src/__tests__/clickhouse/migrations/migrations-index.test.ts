const mockMigration = jest.fn();

const MIGRATION_MODULES = [
  "@/clickhouse/migrations/create-prompt-migration",
  "@/clickhouse/migrations/create-vault-migration",
  "@/clickhouse/migrations/create-evaluation-migration",
  "@/clickhouse/migrations/create-evaluation-type-defaults-migration",
  "@/clickhouse/migrations/create-cron-log-migration",
  "@/clickhouse/migrations/create-custom-dashboards-migration",
  "@/clickhouse/migrations/create-openground-migration",
  "@/clickhouse/migrations/create-rule-engine-migration",
  "@/clickhouse/migrations/create-controller-migration",
  "@/clickhouse/migrations/create-chat-migration",
  "@/clickhouse/migrations/create-agents-summary-migration",
  "@/clickhouse/migrations/create-agent-versions-migration",
  "@/clickhouse/migrations/alter-controller-mode-migration",
  "@/clickhouse/migrations/add-controller-resource-attrs-migration",
  "@/clickhouse/migrations/add-controller-workload-key-migration",
  "@/clickhouse/migrations/add-controller-sdk-actions-migration",
  "@/clickhouse/migrations/add-controller-ttl-migration",
  "@/clickhouse/migrations/add-controller-cluster-id-migration",
  "@/clickhouse/migrations/update-controller-actions-ttl-migration",
  "@/clickhouse/migrations/generalize-controller-desired-states-migration",
  "@/clickhouse/migrations/add-controller-skipping-indexes-migration",
  "@/clickhouse/migrations/create-providers-migration",
  "@/clickhouse/migrations/add-provider-models-cache-prices-migration",
  "@/clickhouse/migrations/create-provider-metadata-migration",
  "@/clickhouse/migrations/drop-legacy-openground-tables-migration",
  "@/clickhouse/migrations/encrypt-vault-values-migration",
  "@/clickhouse/migrations/add-chat-conversation-type-migration",
  "@/clickhouse/migrations/add-chat-message-model-attribution-migration",
  "@/clickhouse/migrations/create-trace-analysis-migration",
  "@/clickhouse/migrations/create-otter-runs-migration",
  "@/clickhouse/migrations/add-agents-summary-skip-indexes-migration",
  "@/clickhouse/migrations/optimize-agent-tables-storage-migration",
  "@/clickhouse/migrations/add-coding-agent-summary-fields-migration",
  "@/clickhouse/migrations/create-coding-agents-audit-migration",
  "@/clickhouse/migrations/add-coding-agent-loc-summary-fields-migration",
  "@/clickhouse/migrations/create-telemetry-rollups-migration",
  "@/clickhouse/migrations/alter-telemetry-rollups-dimensions-migration",
  "@/clickhouse/migrations/drop-vcs-migration",
];

describe("ClickHouse migration orchestration", () => {
  beforeEach(() => {
    jest.resetModules();
    mockMigration.mockReset();
    for (const moduleName of MIGRATION_MODULES) {
      jest.doMock(moduleName, () => ({
        __esModule: true,
        default: mockMigration,
      }));
    }
  });

  it("rejects when a migration reports partially failed queries", async () => {
    mockMigration.mockResolvedValue({ migrationExist: true });
    mockMigration.mockResolvedValueOnce({
      migrationExist: false,
      queriesRun: false,
    });

    const { default: migrations } = await import("@/clickhouse/migrations");

    await expect(migrations("db-1")).rejects.toThrow(
      'ClickHouse migration "create-prompt" failed',
    );
    // All independent creates may already be in flight, but dependent
    // groups must not start after the failed group completes.
    expect(mockMigration).toHaveBeenCalledTimes(12);
  });
});
