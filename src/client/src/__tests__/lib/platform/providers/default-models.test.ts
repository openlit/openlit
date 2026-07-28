import { DEFAULT_MODELS_BY_PROVIDER, DEFAULT_PROVIDERS } from '@/lib/platform/providers/default-models';

describe('default-models', () => {
  it('exports a non-empty record of providers', () => {
    expect(typeof DEFAULT_MODELS_BY_PROVIDER).toBe('object');
    const providers = Object.keys(DEFAULT_MODELS_BY_PROVIDER);
    expect(providers.length).toBeGreaterThan(0);
  });

  it('includes the expected core providers', () => {
    const expectedProviders = [
      'openai', 'anthropic', 'google', 'mistral', 'groq',
      'perplexity', 'azure', 'cohere', 'together', 'fireworks',
      'deepseek', 'xai', 'huggingface', 'replicate', 'minimax',
    ];
    for (const provider of expectedProviders) {
      expect(DEFAULT_MODELS_BY_PROVIDER).toHaveProperty(provider);
    }
  });

  it('each provider has at least one model', () => {
    for (const [provider, models] of Object.entries(DEFAULT_MODELS_BY_PROVIDER)) {
      expect(models.length).toBeGreaterThan(0);
    }
  });

  it('each model has the required fields', () => {
    for (const [provider, models] of Object.entries(DEFAULT_MODELS_BY_PROVIDER)) {
      for (const model of models) {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('displayName');
        expect(model).toHaveProperty('contextWindow');
        expect(typeof model.contextWindow).toBe('number');
        expect(model).toHaveProperty('inputPricePerMToken');
        expect(typeof model.inputPricePerMToken).toBe('number');
        expect(model).toHaveProperty('outputPricePerMToken');
        expect(typeof model.outputPricePerMToken).toBe('number');
      }
    }
  });

  it('model IDs are non-empty strings', () => {
    for (const models of Object.values(DEFAULT_MODELS_BY_PROVIDER)) {
      for (const model of models) {
        expect(typeof model.id).toBe('string');
        expect(model.id.length).toBeGreaterThan(0);
      }
    }
  });

  it('seeds the MiniMax provider with its current models', () => {
    expect(DEFAULT_PROVIDERS.some((p) => p.providerId === 'minimax')).toBe(true);
    const minimaxModels = DEFAULT_MODELS_BY_PROVIDER.minimax;
    expect(minimaxModels).toBeDefined();
    expect(minimaxModels.length).toBeGreaterThanOrEqual(2);
    const m3 = minimaxModels.find((m) => m.id === 'MiniMax-M3');
    expect(m3).toBeDefined();
    expect(m3!.contextWindow).toBe(1000000);
    expect(m3!.inputPricePerMToken).toBe(0.6);
    expect(m3!.outputPricePerMToken).toBe(2.4);
    expect(m3!.cacheReadPricePerMToken).toBe(0.12);
    expect(m3!.capabilities).toEqual(
      expect.arrayContaining(['vision', 'thinking'])
    );
    const m27 = minimaxModels.find((m) => m.id === 'MiniMax-M2.7');
    expect(m27).toBeDefined();
    expect(m27!.contextWindow).toBe(204800);
    expect(m27!.inputPricePerMToken).toBe(0.3);
    expect(m27!.outputPricePerMToken).toBe(1.2);
    expect(m27!.cacheReadPricePerMToken).toBe(0.06);
    expect(m27!.cacheCreationPricePerMToken).toBe(0.375);
    expect(m27!.capabilities).toEqual(
      expect.arrayContaining(['thinking'])
    );
  });
});
