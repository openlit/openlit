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
    expect(queries[1]).toContain('INSERT INTO openlit_provider_metadata');
    expect(queries[1]).toContain("'openai-compatible'");
    expect(queries[1]).toMatch(/SELECT[\s\S]*'OpenAI-compatible',[\s\S]*false,[\s\S]*true\s+WHERE/);
    expect(result).toEqual({ migrationExist: false, queriesRun: true });
  });

  it("only seeds when no provider has the ID, so a user's own provider is kept", async () => {
    await AddOpenAICompatibleProviderMigration('db-1');
    const { queries } = (migrationHelper as jest.Mock).mock.calls[0][0];
    expect(queries[1]).toMatch(
      /WHERE \(\s*SELECT count\(\)\s*FROM openlit_provider_metadata\s*WHERE provider_id = 'openai-compatible'\s*\) = 0/
    );
  });

  it('escapes the seeded config schema as a SQL string', async () => {
    await AddOpenAICompatibleProviderMigration('db-1');
    const { queries } = (migrationHelper as jest.Mock).mock.calls[0][0];
    const schema = queries[1].match(/'(\{.*\})'/)?.[1];
    expect(() => JSON.parse(String(schema).replace(/\\'/g, "'"))).not.toThrow();
  });
});
