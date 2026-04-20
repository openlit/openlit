jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: { sanitizeValue: jest.fn((v: string) => v) },
}));

import { ProviderRegistry } from '@/lib/platform/providers/provider-registry';
import { dataCollector } from '@/lib/platform/common';

const Sanitizer = require('@/utils/sanitizer').default;

const mockProviderRows = [
  {
    provider_id: 'openai',
    display_name: 'OpenAI',
    description: 'GPT models',
    requires_vault: true,
    config_schema: JSON.stringify({ temperature: { min: 0, max: 2, step: 0.1, default: 1 } }),
    is_default: true,
  },
  {
    provider_id: 'anthropic',
    display_name: 'Anthropic',
    description: 'Claude models',
    requires_vault: true,
    config_schema: '{}',
    is_default: true,
  },
];

const mockModelRows = [
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
];

beforeEach(() => {
  jest.resetAllMocks();
  Sanitizer.sanitizeValue.mockImplementation((v: string) => v);
});

// Helper: mock dataCollector for 2 parallel calls (providers metadata + models)
function mockGetAvailableProviders(providerRows: any[] = mockProviderRows, modelRows: any[] = mockModelRows) {
  (dataCollector as jest.Mock)
    .mockResolvedValueOnce({ data: providerRows }) // provider metadata query
    .mockResolvedValueOnce({ data: modelRows }); // models query
}

describe('ProviderRegistry', () => {
  describe('getAvailableProviders', () => {
    it('returns providers with models merged from DB', async () => {
      mockGetAvailableProviders();

      const providers = await ProviderRegistry.getAvailableProviders('db-1');

      // Should call dataCollector twice (provider metadata + models)
      expect(dataCollector).toHaveBeenCalledTimes(2);

      const openai = providers.find((p) => p.providerId === 'openai');
      expect(openai).toBeDefined();
      expect(openai!.displayName).toBe('OpenAI');
      expect(openai!.supportedModels).toHaveLength(1);
      expect(openai!.supportedModels[0].id).toBe('gpt-4o');

      const anthropic = providers.find((p) => p.providerId === 'anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic!.supportedModels).toEqual([]);
    });

    it('parses configSchema from JSON string', async () => {
      mockGetAvailableProviders();

      const providers = await ProviderRegistry.getAvailableProviders('db-1');
      const openai = providers.find((p) => p.providerId === 'openai');
      expect(openai!.configSchema.temperature).toEqual(
        expect.objectContaining({ min: 0, max: 2 })
      );
    });

    it('returns empty array when no providers in DB', async () => {
      mockGetAvailableProviders([], []);

      const providers = await ProviderRegistry.getAvailableProviders('db-1');
      expect(providers).toEqual([]);
    });

    it('propagates DB errors to the caller', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ err: 'connection refused' });

      await expect(
        ProviderRegistry.getAvailableProviders('db-1')
      ).rejects.toThrow('Failed to load provider metadata');
    });
  });

  describe('getProviderById', () => {
    it('returns provider with models', async () => {
      (dataCollector as jest.Mock)
        .mockResolvedValueOnce({ data: [mockProviderRows[0]] }) // single provider
        .mockResolvedValueOnce({ data: mockModelRows }); // models

      const provider = await ProviderRegistry.getProviderById('openai', 'db-1');
      expect(provider).not.toBeNull();
      expect(provider!.providerId).toBe('openai');
      expect(provider!.supportedModels).toHaveLength(1);
    });

    it('returns null when provider not found in DB', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ data: [] });

      const provider = await ProviderRegistry.getProviderById('nonexistent', 'db-1');
      expect(provider).toBeNull();
    });

    it('propagates DB errors', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ err: 'query failed' });

      await expect(
        ProviderRegistry.getProviderById('openai', 'db-1')
      ).rejects.toThrow('Failed to load provider openai');
    });
  });

  describe('getModel', () => {
    it('returns a specific model', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ data: mockModelRows });

      const model = await ProviderRegistry.getModel('openai', 'gpt-4o', 'db-1');
      expect(model).not.toBeNull();
      expect(model!.id).toBe('gpt-4o');
    });

    it('returns null when model not found', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ data: [] });

      const model = await ProviderRegistry.getModel('openai', 'gpt-99', 'db-1');
      expect(model).toBeNull();
    });
  });

  describe('searchProviders', () => {
    it('filters providers by display name', async () => {
      mockGetAvailableProviders();

      const results = await ProviderRegistry.searchProviders('anthropic', 'db-1');
      expect(results).toHaveLength(1);
      expect(results[0].providerId).toBe('anthropic');
    });

    it('is case-insensitive', async () => {
      mockGetAvailableProviders();

      const results = await ProviderRegistry.searchProviders('OPENAI', 'db-1');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty for no match', async () => {
      mockGetAvailableProviders();

      const results = await ProviderRegistry.searchProviders('zzzzz', 'db-1');
      expect(results).toEqual([]);
    });
  });

  describe('getProviderModels', () => {
    it('returns models for a provider', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ data: mockModelRows });

      const models = await ProviderRegistry.getProviderModels('openai', 'db-1');
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('gpt-4o');
    });
  });
});
