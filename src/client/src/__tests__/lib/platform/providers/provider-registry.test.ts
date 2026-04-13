jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: { sanitizeValue: jest.fn((v: string) => v) },
}));

import { ProviderRegistry } from '@/lib/platform/providers/provider-registry';
import { dataCollector } from '@/lib/platform/common';

const mockModels = [
  {
    provider: 'openai',
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    modelType: 'chat',
    contextWindow: 128000,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 10.0,
    capabilities: ['streaming'],
  },
  {
    provider: 'anthropic',
    id: 'claude-3-5-sonnet-20240620',
    displayName: 'Claude 3.5 Sonnet',
    modelType: 'chat',
    contextWindow: 200000,
    inputPricePerMToken: 3.0,
    outputPricePerMToken: 15.0,
    capabilities: ['streaming', 'vision'],
  },
];

beforeEach(() => {
  jest.resetAllMocks();
});

describe('ProviderRegistry', () => {
  describe('getProviderMetadata', () => {
    it('returns static metadata for a known provider', () => {
      const meta = ProviderRegistry.getProviderMetadata('openai');
      expect(meta).not.toBeNull();
      expect(meta!.providerId).toBe('openai');
      expect(meta!.displayName).toBe('OpenAI');
      expect(meta).toHaveProperty('configSchema');
      expect(meta).toHaveProperty('requiresVault');
    });

    it('returns null for an unknown provider', () => {
      expect(ProviderRegistry.getProviderMetadata('nonexistent')).toBeNull();
    });
  });

  describe('getAllProviderMetadata', () => {
    it('returns all static providers', () => {
      const all = ProviderRegistry.getAllProviderMetadata();
      expect(all.length).toBeGreaterThan(10);
      const ids = all.map((p) => p.providerId);
      expect(ids).toContain('openai');
      expect(ids).toContain('anthropic');
      expect(ids).toContain('google');
    });
  });

  describe('getAvailableProviders', () => {
    it('returns providers with models from DB', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ data: mockModels });

      const providers = await ProviderRegistry.getAvailableProviders('db-1');

      expect(dataCollector).toHaveBeenCalledWith(
        expect.objectContaining({ query: expect.stringContaining('openlit_provider_models') }),
        'query',
        'db-1'
      );

      const openai = providers.find((p) => p.providerId === 'openai');
      expect(openai).toBeDefined();
      expect(openai!.supportedModels.length).toBeGreaterThanOrEqual(1);
      expect(openai!.supportedModels[0].id).toBe('gpt-4o');
    });

    it('returns providers with empty models when DB returns no data', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ data: [] });

      const providers = await ProviderRegistry.getAvailableProviders('db-1');
      const openai = providers.find((p) => p.providerId === 'openai');
      expect(openai).toBeDefined();
      expect(openai!.supportedModels).toEqual([]);
    });

    it('returns providers with empty models on DB error', async () => {
      (dataCollector as jest.Mock).mockRejectedValue(new Error('DB down'));

      const providers = await ProviderRegistry.getAvailableProviders('db-1');
      expect(providers.length).toBeGreaterThan(0);
      providers.forEach((p) => expect(p.supportedModels).toEqual([]));
    });
  });

  describe('getProviderById', () => {
    it('returns the provider with models when found', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({
        data: [mockModels[0]],
      });

      const provider = await ProviderRegistry.getProviderById('openai', 'db-1');
      expect(provider).not.toBeNull();
      expect(provider!.providerId).toBe('openai');
      expect(provider!.supportedModels).toHaveLength(1);
    });

    it('returns null for an unknown provider', async () => {
      const provider = await ProviderRegistry.getProviderById('nonexistent', 'db-1');
      expect(provider).toBeNull();
      expect(dataCollector).not.toHaveBeenCalled();
    });
  });

  describe('getModel', () => {
    it('returns a specific model', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({
        data: [mockModels[0]],
      });

      const model = await ProviderRegistry.getModel('openai', 'gpt-4o', 'db-1');
      expect(model).not.toBeNull();
      expect(model!.id).toBe('gpt-4o');
      expect(model!.inputPricePerMToken).toBe(2.5);
    });

    it('returns null when model not found', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ data: [] });

      const model = await ProviderRegistry.getModel('openai', 'gpt-99', 'db-1');
      expect(model).toBeNull();
    });
  });

  describe('searchProviders', () => {
    it('filters providers by name', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ data: mockModels });

      const results = await ProviderRegistry.searchProviders('groq', 'db-1');
      expect(results.length).toBe(1);
      expect(results[0].providerId).toBe('groq');
    });

    it('returns empty array when nothing matches', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ data: [] });

      const results = await ProviderRegistry.searchProviders('zzzzz', 'db-1');
      expect(results).toEqual([]);
    });
  });
});
