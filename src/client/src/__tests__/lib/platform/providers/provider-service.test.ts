jest.mock('@/lib/platform/providers/provider-registry', () => ({
  ProviderRegistry: {
    getAvailableProviders: jest.fn(),
    getProviderById: jest.fn(),
    searchProviders: jest.fn(),
  },
}));

import {
  getAllProvidersWithCustomModels,
  getProviderByIdWithCustomModels,
  searchProvidersWithCustomModels,
} from '@/lib/platform/providers/provider-service';
import { ProviderRegistry } from '@/lib/platform/providers/provider-registry';

const mockProviders = [
  {
    providerId: 'openai',
    displayName: 'OpenAI',
    description: 'GPT models',
    requiresVault: true,
    configSchema: {},
    supportedModels: [{ id: 'gpt-4o', displayName: 'GPT-4o' }],
  },
];

beforeEach(() => {
  jest.resetAllMocks();
});

describe('getAllProvidersWithCustomModels', () => {
  it('returns providers from registry', async () => {
    (ProviderRegistry.getAvailableProviders as jest.Mock).mockResolvedValue(
      mockProviders
    );

    const result = await getAllProvidersWithCustomModels('user-1', 'db-1');

    expect(result.data).toEqual(mockProviders);
    expect(ProviderRegistry.getAvailableProviders).toHaveBeenCalledWith('db-1');
  });

  it('returns error on registry failure', async () => {
    (ProviderRegistry.getAvailableProviders as jest.Mock).mockRejectedValue(
      new Error('boom')
    );

    const result = await getAllProvidersWithCustomModels('user-1', 'db-1');

    expect(result.err).toBe('Failed to load providers');
  });
});

describe('getProviderByIdWithCustomModels', () => {
  it('returns the provider when found', async () => {
    (ProviderRegistry.getProviderById as jest.Mock).mockResolvedValue(
      mockProviders[0]
    );

    const result = await getProviderByIdWithCustomModels('openai', 'user-1', 'db-1');

    expect(result.data).toEqual(mockProviders[0]);
    expect(ProviderRegistry.getProviderById).toHaveBeenCalledWith('openai', 'db-1');
  });

  it('returns error when provider not found', async () => {
    (ProviderRegistry.getProviderById as jest.Mock).mockResolvedValue(null);

    const result = await getProviderByIdWithCustomModels('unknown', 'user-1', 'db-1');

    expect(result.err).toBe('Provider not found');
  });

  it('returns error on registry failure', async () => {
    (ProviderRegistry.getProviderById as jest.Mock).mockRejectedValue(
      new Error('boom')
    );

    const result = await getProviderByIdWithCustomModels('openai', 'user-1', 'db-1');

    expect(result.err).toBe('Failed to load provider');
  });
});

describe('searchProvidersWithCustomModels', () => {
  it('delegates to registry searchProviders', async () => {
    (ProviderRegistry.searchProviders as jest.Mock).mockResolvedValue(mockProviders);

    const result = await searchProvidersWithCustomModels('openai', 'user-1', 'db-1');

    expect(result.data).toEqual(mockProviders);
    expect(ProviderRegistry.searchProviders).toHaveBeenCalledWith('openai', 'db-1');
  });

  it('returns error on registry failure', async () => {
    (ProviderRegistry.searchProviders as jest.Mock).mockRejectedValue(
      new Error('boom')
    );

    const result = await searchProvidersWithCustomModels('q', 'user-1', 'db-1');

    expect(result.err).toBe('Failed to search providers');
  });
});
