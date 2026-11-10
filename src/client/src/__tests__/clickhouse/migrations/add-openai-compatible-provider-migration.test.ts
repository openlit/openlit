jest.mock('@/clickhouse/migrations/migration-helper', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ migrationExist: false, queriesRun: true }),
}));

import migrationHelper from '@/clickhouse/migrations/migration-helper';
import AddOpenAICompatibleProviderMigration from '@/clickhouse/migrations/add-openai-compatible-provider-migration';

describe('AddOpenAICompatibleProviderMigration', () => {
  it('adds a nullable base_url to the provider metadata table, then seeds a keyless provider', async () => {
    const result = await AddOpenAICompatibleProviderMigration('db-1');

    const { queries, databaseConfigId } = (migrationHelper as jest.Mock).mock.calls[0][0];
    expect(databaseConfigId).toBe('db-1');
    expect(queries[0]).toContain('ALTER TABLE openlit_provider_metadata');
    expect(queries[0]).toContain('ADD COLUMN IF NOT EXISTS base_url Nullable(String)');
    expect(queries[1].table).toBe('openlit_provider_metadata');
    expect(queries[1].values[0]).toMatchObject({
      provider_id: 'openai-compatible',
      requires_vault: false,
      is_default: true,
    });
    expect(result).toEqual({ migrationExist: false, queriesRun: true });
  });
});
