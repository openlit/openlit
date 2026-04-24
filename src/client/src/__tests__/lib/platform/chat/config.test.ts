jest.mock('@/lib/platform/common', () => ({ dataCollector: jest.fn() }));
jest.mock('@/lib/platform/chat/table-details', () => ({
  OPENLIT_CHAT_CONFIG_TABLE: 'openlit_chat_config',
}));
jest.mock('@/lib/platform/vault', () => ({
  getSecrets: jest.fn(),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: {
    sanitizeValue: jest.fn((v: string) => v),
  },
}));

import { getChatConfig, upsertChatConfig, getChatConfigWithApiKey } from '@/lib/platform/chat/config';
import { dataCollector } from '@/lib/platform/common';
import { getSecrets } from '@/lib/platform/vault';

beforeEach(() => {
  jest.clearAllMocks();
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
});

describe('getChatConfig', () => {
  it('returns undefined when no config exists', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [] });
    const { data } = await getChatConfig();
    expect(data).toBeUndefined();
  });

  it('returns config when it exists', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [{ provider: 'openai', model: 'gpt-4o', vaultId: 'v1' }],
    });
    const { data } = await getChatConfig();
    expect(data?.provider).toBe('openai');
    expect(data?.model).toBe('gpt-4o');
  });

  it('passes databaseConfigId to dataCollector', async () => {
    await getChatConfig('db-123');
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining('openlit_chat_config') }),
      'query',
      'db-123'
    );
  });

  it('returns error when dataCollector fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'connection error' });
    const { err } = await getChatConfig();
    expect(err).toBe('connection error');
  });
});

describe('upsertChatConfig', () => {
  it('inserts config via dataCollector insert', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    const { data } = await upsertChatConfig({
      provider: 'anthropic',
      model: 'claude-3',
      vaultId: 'v2',
    });
    expect(data).toBe('Chat configuration saved successfully');
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'openlit_chat_config' }),
      'insert',
      undefined
    );
  });

  it('returns error on failure', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'insert failed' });
    const { err } = await upsertChatConfig({
      provider: 'openai',
      model: 'gpt-4o',
      vaultId: 'v1',
    });
    expect(err).toBe('insert failed');
  });
});

describe('getChatConfigWithApiKey', () => {
  it('returns error when no config exists', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [] });
    const { err } = await getChatConfigWithApiKey();
    expect(err).toContain('not found');
  });

  it('returns error when vault secret not found', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [{ provider: 'openai', model: 'gpt-4o', vaultId: 'v1' }],
    });
    (getSecrets as jest.Mock).mockResolvedValue({ data: [] });
    const { err } = await getChatConfigWithApiKey();
    expect(err).toContain('not found');
  });

  it('returns config with apiKey when vault secret exists', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [{ provider: 'openai', model: 'gpt-4o', vaultId: 'v1' }],
    });
    (getSecrets as jest.Mock).mockResolvedValue({
      data: [{ id: 'v1', value: 'sk-test-key' }],
    });
    const { data } = await getChatConfigWithApiKey();
    expect(data?.apiKey).toBe('sk-test-key');
    expect(data?.provider).toBe('openai');
  });
});
