jest.mock('@/lib/platform/common', () => {
  const collector = jest.fn();
  return { dataCollector: collector, intelligenceDataCollector: collector };
});
jest.mock('@/lib/session', () => ({ getCurrentUser: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { evaluationConfigs: { updateMany: jest.fn() } },
}));
jest.mock('@/lib/platform/alerts/signals', () => ({ emitManagementAlertSignalSafe: jest.fn() }));
jest.mock('@/lib/platform/connectors/datasource/http/secret', () => ({
  invalidateSourceSecretCache: jest.fn(),
}));
jest.mock('@/lib/platform/providers/provider-registry', () => ({ ProviderRegistry: {} }));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: { sanitizeValue: jest.fn((v: string) => v) },
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    OPERATION_FAILED: 'Operation failed',
    PROVIDER_EVALUATION_ONLY_ERROR: 'This provider is evaluation-only and cannot be used here',
  })),
}));

import {
  getOpenGroundConfigs,
  getOpenGroundConfigWithSecret,
  upsertOpenGroundConfig,
  deleteOpenGroundConfig,
  toggleOpenGroundConfigStatus,
  getActiveProviders,
  clearOpenAICompatibleKeys,
} from '@/lib/platform/providers/config';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';
import prisma from '@/lib/prisma';
import getMessage from '@/constants/messages';

const Sanitizer = require('@/utils/sanitizer').default;

const mockConfig = {
  id: 'cfg-1',
  userId: 'user-1',
  provider: 'openai',
  vaultId: 'vault-1',
  modelId: 'gpt-4o',
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const mockVaultRecord = { key: 'OPENAI_API_KEY', value: 'sk-xxx' };

beforeEach(() => {
  jest.resetAllMocks();
  Sanitizer.sanitizeValue.mockImplementation((v: string) => v);
  (getMessage as jest.Mock).mockReturnValue({
    OPERATION_FAILED: 'Operation failed',
  });
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'owner@example.com' });
});

describe('getOpenGroundConfigs', () => {
  it('returns configs for the user', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [mockConfig] });

    const result = await getOpenGroundConfigs('user-1', 'db-1');

    expect(result.data).toEqual([mockConfig]);
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("user_id = 'user-1'"),
      }),
      'query',
      'db-1'
    );
  });

  it('returns error on DB failure', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB error' });

    const result = await getOpenGroundConfigs('user-1', 'db-1');

    expect(result.err).toBe('Operation failed');
  });

  it('catches thrown exceptions', async () => {
    (dataCollector as jest.Mock).mockRejectedValue(new Error('boom'));

    const result = await getOpenGroundConfigs('user-1', 'db-1');

    expect(result.err).toBe('Operation failed');
  });
});

describe('getOpenGroundConfigWithSecret', () => {
  it('returns config + apiKey from vault', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [mockConfig] }) // config query
      .mockResolvedValueOnce({ data: [mockVaultRecord] }); // vault query

    const result = await getOpenGroundConfigWithSecret('openai', 'user-1', 'db-1');

    expect(result.data).toBeDefined();
    expect(result.data!.apiKey).toBe('sk-xxx');
    expect(result.data!.vaultKey).toBe('OPENAI_API_KEY');
  });

  it('returns error when no active config found', async () => {
    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [] });

    const result = await getOpenGroundConfigWithSecret('openai', 'user-1', 'db-1');

    expect(result.err).toContain('No active configuration');
  });

  it('returns error when vault lookup fails', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [mockConfig] })
      .mockResolvedValueOnce({ data: [] });

    const result = await getOpenGroundConfigWithSecret('openai', 'user-1', 'db-1');

    expect(result.err).toContain('API key not found');
  });

  it('catches thrown exceptions', async () => {
    (dataCollector as jest.Mock).mockRejectedValue(new Error('boom'));

    const result = await getOpenGroundConfigWithSecret('openai', 'user-1', 'db-1');

    expect(result.err).toBe('Operation failed');
  });
});

describe('upsertOpenGroundConfig', () => {
  it('rejects evaluation-only providers such as typesafe without querying', async () => {
    (getMessage as jest.Mock).mockReturnValue({
      PROVIDER_EVALUATION_ONLY_ERROR: 'This provider is evaluation-only and cannot be used here',
    });
    const result = await upsertOpenGroundConfig({
      provider: 'typesafe',
      vaultId: 'vault-1',
      modelId: 'jev-latest',
      userId: 'user-1',
      databaseConfigId: 'db-1',
    });
    expect(result.data).toBeUndefined();
    expect(result.err).toContain('evaluation-only');
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('inserts new config when none exists', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [] }) // exists check — none
      .mockResolvedValueOnce({ err: null }) // insert
      .mockResolvedValueOnce({ data: [mockConfig] }); // re-fetch

    const result = await upsertOpenGroundConfig({
      provider: 'openai',
      vaultId: 'vault-1',
      modelId: 'gpt-4o',
      userId: 'user-1',
      databaseConfigId: 'db-1',
    });

    expect(result.data).toEqual(mockConfig);
    // Second call should be the INSERT
    expect(dataCollector).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        table: 'openlit_providers',
        values: [
          expect.objectContaining({
            user_id: 'user-1',
            provider: 'openai',
          }),
        ],
      }),
      'insert',
      'db-1'
    );
  });

  it('updates existing config', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ id: 'cfg-1' }] }) // exists check
      .mockResolvedValueOnce({ err: null }) // update
      .mockResolvedValueOnce({ data: [mockConfig] }); // getOpenGroundConfigById

    const result = await upsertOpenGroundConfig({
      provider: 'openai',
      vaultId: 'vault-2',
      userId: 'user-1',
      databaseConfigId: 'db-1',
    });

    expect(result.data).toBeDefined();
    expect(dataCollector).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        query: expect.stringContaining('ALTER TABLE'),
      }),
      'exec',
      'db-1'
    );
  });

  it('sets model_id to NULL in the UPDATE when modelId is provided during an update', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ id: 'cfg-1' }] })
      .mockResolvedValueOnce({ err: null })
      .mockResolvedValueOnce({ data: [mockConfig] });

    await upsertOpenGroundConfig({
      provider: 'openai',
      vaultId: 'vault-2',
      modelId: 'gpt-4o-mini',
      userId: 'user-1',
      databaseConfigId: 'db-1',
    });

    const [{ query }] = (dataCollector as jest.Mock).mock.calls[1];
    expect(query).toContain("model_id = 'gpt-4o-mini'");
  });

  it('catches thrown exceptions during upsert', async () => {
    (dataCollector as jest.Mock).mockRejectedValue(new Error('boom'));

    const result = await upsertOpenGroundConfig({
      provider: 'openai',
      vaultId: 'v',
      userId: 'user-1',
      databaseConfigId: 'db-1',
    });

    expect(result.err).toBe('Operation failed');
  });

  it('returns "Config not found" when the post-update re-fetch (getOpenGroundConfigById) finds nothing', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ id: 'cfg-1' }] }) // exists check
      .mockResolvedValueOnce({ err: null }) // update
      .mockResolvedValueOnce({ data: [] }); // getOpenGroundConfigById re-fetch finds nothing

    const result = await upsertOpenGroundConfig({
      provider: 'openai',
      vaultId: 'vault-2',
      userId: 'user-1',
      databaseConfigId: 'db-1',
    });

    expect(result.err).toBe('Config not found');
  });

  it('returns error when insert fails', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ err: 'insert failed' });

    const result = await upsertOpenGroundConfig({
      provider: 'openai',
      vaultId: 'v',
      userId: 'user-1',
      databaseConfigId: 'db-1',
    });

    expect(result.err).toBe('Operation failed');
  });

  it('returns error when update fails', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ id: 'cfg-1' }] })
      .mockResolvedValueOnce({ err: 'update failed' });

    const result = await upsertOpenGroundConfig({
      provider: 'openai',
      vaultId: 'v',
      userId: 'user-1',
      databaseConfigId: 'db-1',
    });

    expect(result.err).toBe('Operation failed');
  });
});

describe('deleteOpenGroundConfig', () => {
  it('deletes a config', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    const result = await deleteOpenGroundConfig('cfg-1', 'user-1', 'db-1');

    expect(result.data).toContain('deleted');
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('DELETE WHERE'),
      }),
      'exec',
      'db-1'
    );
  });

  it('returns error on DB failure', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB error' });

    const result = await deleteOpenGroundConfig('cfg-1', 'user-1', 'db-1');

    expect(result.err).toBe('Operation failed');
  });

  it('catches thrown exceptions', async () => {
    (dataCollector as jest.Mock).mockRejectedValue(new Error('boom'));

    const result = await deleteOpenGroundConfig('cfg-1', 'user-1', 'db-1');

    expect(result.err).toBe('Operation failed');
  });
});

describe('toggleOpenGroundConfigStatus', () => {
  it('toggles status and returns updated config', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: null }) // ALTER UPDATE
      .mockResolvedValueOnce({ data: [mockConfig] }); // re-fetch

    const result = await toggleOpenGroundConfigStatus('cfg-1', 'user-1', 'db-1', false);

    expect(result.data).toBeDefined();
  });

  it('returns error on toggle failure', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'fail' });

    const result = await toggleOpenGroundConfigStatus('cfg-1', 'user-1', 'db-1', true);

    expect(result.err).toBe('Operation failed');
  });

  it('catches thrown exceptions', async () => {
    (dataCollector as jest.Mock).mockRejectedValue(new Error('boom'));

    const result = await toggleOpenGroundConfigStatus('cfg-1', 'user-1', 'db-1', true);

    expect(result.err).toBe('Operation failed');
  });
});

describe('getActiveProviders', () => {
  it('returns distinct active provider names', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [{ provider: 'openai' }, { provider: 'anthropic' }],
    });

    const result = await getActiveProviders('user-1', 'db-1');

    expect(result.data).toEqual(['openai', 'anthropic']);
  });

  it('returns empty array when no providers', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [] });

    const result = await getActiveProviders('user-1', 'db-1');

    expect(result.data).toEqual([]);
  });

  it('returns empty array when data is undefined (no rows, no error)', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: undefined, err: null });

    const result = await getActiveProviders('user-1', 'db-1');

    expect(result.data).toEqual([]);
  });

  it('returns error on DB failure', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'fail' });

    const result = await getActiveProviders('user-1', 'db-1');

    expect(result.err).toBe('Operation failed');
  });

  it('catches thrown exceptions', async () => {
    (dataCollector as jest.Mock).mockRejectedValue(new Error('boom'));

    const result = await getActiveProviders('user-1', 'db-1');

    expect(result.err).toBe('Operation failed');
  });
});

describe('getOpenGroundConfigWithSecret vault ownership', () => {
  // A vault that only returns the row when the query filters on its owner, or
  // does not filter at all, as ClickHouse would.
  function vaultOwnedBy(owner: string) {
    (dataCollector as jest.Mock).mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes('openlit_providers')) {
        return { data: [{ ...mockConfig, provider: 'openai-compatible', vaultId: 'victim-secret' }] };
      }
      const filter = query.match(/created_by = '([^']+)'/)?.[1];
      return { data: !filter || filter === owner ? [{ id: 'victim-secret', ...mockVaultRecord }] : [] };
    });
  }

  it("refuses another user's secret saved on the caller's config", async () => {
    vaultOwnedBy('victim@example.com');
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'attacker@example.com' });

    const { data, err } = await getOpenGroundConfigWithSecret('openai-compatible', 'user-1', 'db-1');

    expect(data).toBeUndefined();
    expect(err).toContain('API key not found');
  });

  it("returns the caller's own secret", async () => {
    vaultOwnedBy('owner@example.com');

    const { data } = await getOpenGroundConfigWithSecret('openai-compatible', 'user-1', 'db-1');

    expect(data?.apiKey).toBe('sk-xxx');
  });
});

describe('clearOpenAICompatibleKeys', () => {
  beforeEach(() => {
    (dataCollector as jest.Mock).mockResolvedValue({});
    (prisma.evaluationConfigs.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  it('clears the selected key from OpenGround, Chat and Evaluations', async () => {
    const { err } = await clearOpenAICompatibleKeys('db-1');

    expect(err).toBeUndefined();
    const queries = (dataCollector as jest.Mock).mock.calls.map(([params]) => params.query);
    for (const table of ['openlit_providers', 'openlit_chat_config']) {
      const query = queries.find((q: string) => q.includes(table));
      expect(query).toContain("UPDATE vault_id = ''");
      expect(query).toContain("provider = 'openai-compatible'");
      expect(query).toContain('mutations_sync');
    }
    expect(prisma.evaluationConfigs.updateMany).toHaveBeenCalledWith({
      where: { databaseConfigId: 'db-1', provider: 'openai-compatible' },
      data: { vaultId: '' },
    });
  });

  it('stops and reports a failure', async () => {
    (dataCollector as jest.Mock).mockResolvedValueOnce({ err: 'boom' });

    expect(await clearOpenAICompatibleKeys('db-1')).toEqual({ err: 'boom' });
    expect(prisma.evaluationConfigs.updateMany).not.toHaveBeenCalled();
  });

  it('reports a failed evaluation update', async () => {
    (prisma.evaluationConfigs.updateMany as jest.Mock).mockRejectedValue(new Error('db down'));

    const { err } = await clearOpenAICompatibleKeys('db-1');

    expect(err).toBeTruthy();
  });
});

describe('getOpenGroundConfigWithSecret key handling', () => {
  it('needs no vault record for the OpenAI-compatible provider', async () => {
    (dataCollector as jest.Mock).mockResolvedValueOnce({
      data: [{ ...mockConfig, provider: 'openai-compatible', vaultId: '' }],
    });
    const { data, err } = await getOpenGroundConfigWithSecret('openai-compatible', 'user-1', 'db-1');
    expect(err).toBeUndefined();
    expect(data?.apiKey).toBe('');
    expect(dataCollector).toHaveBeenCalledTimes(1);
  });

  it('still fails for another provider with no vault record', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ ...mockConfig, vaultId: '' }] })
      .mockResolvedValueOnce({ data: [] });
    const { err } = await getOpenGroundConfigWithSecret('openai', 'user-1', 'db-1');
    expect(err).toContain('API key not found');
  });
});
