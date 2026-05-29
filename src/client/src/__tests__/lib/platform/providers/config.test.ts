jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: { sanitizeValue: jest.fn((v: string) => v) },
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    OPERATION_FAILED: 'Operation failed',
  })),
}));

import {
  getOpenGroundConfigs,
  getOpenGroundConfigWithSecret,
  upsertOpenGroundConfig,
  deleteOpenGroundConfig,
  toggleOpenGroundConfigStatus,
  getActiveProviders,
} from '@/lib/platform/providers/config';
import { dataCollector } from '@/lib/platform/common';
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

  it('returns error on DB failure', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'fail' });

    const result = await getActiveProviders('user-1', 'db-1');

    expect(result.err).toBe('Operation failed');
  });
});
