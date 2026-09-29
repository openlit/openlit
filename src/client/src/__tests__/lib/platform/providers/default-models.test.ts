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
      'deepseek', 'xai', 'huggingface', 'replicate', 'minimax', 'orcarouter',
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
    const minimaxProvider = DEFAULT_PROVIDERS.find((p) => p.providerId === 'minimax');
    expect(minimaxProvider).toEqual(
      expect.objectContaining({
        displayName: 'MiniMax',
        requiresVault: true,
      })
    );
    expect(minimaxProvider?.configSchema.temperature).toEqual(
      expect.objectContaining({ min: 0, max: 2, default: 1 })
    );
    expect(minimaxProvider?.configSchema.topP).toEqual(
      expect.objectContaining({ min: 0, max: 1, default: 0.95 })
    );

    const minimaxModels = DEFAULT_MODELS_BY_PROVIDER.minimax;
    expect(minimaxModels).toHaveLength(2);

    const m3 = minimaxModels.find((m) => m.id === 'MiniMax-M3');
    expect(m3).toMatchObject({
      contextWindow: 1000000,
      inputPricePerMToken: 0.3,
      outputPricePerMToken: 1.2,
      cacheReadPricePerMToken: 0.06,
    });
    expect(m3?.cacheCreationPricePerMToken).toBeUndefined();
    expect(m3?.capabilities).toEqual(
      expect.arrayContaining(['function-calling', 'vision', 'streaming', 'thinking'])
    );

    const m27 = minimaxModels.find((m) => m.id === 'MiniMax-M2.7');
    expect(m27).toMatchObject({
      contextWindow: 204800,
      inputPricePerMToken: 0.3,
      outputPricePerMToken: 1.2,
      cacheReadPricePerMToken: 0.06,
      cacheCreationPricePerMToken: 0.375,
    });
    expect(m27?.capabilities).toEqual(
      expect.arrayContaining(['function-calling', 'streaming', 'thinking'])
    );
    expect(m27?.capabilities).not.toContain('vision');
  });

  it('seeds OrcaRouter with documented provider-prefixed models', () => {
    const orcaProvider = DEFAULT_PROVIDERS.find((p) => p.providerId === 'orcarouter');
    expect(orcaProvider).toEqual(
      expect.objectContaining({
        displayName: 'OrcaRouter',
        requiresVault: true,
      })
    );

    const orcaModels = DEFAULT_MODELS_BY_PROVIDER.orcarouter;
    expect(orcaModels.map((m) => m.id)).toEqual([
      'orcarouter/auto',
      'openai/gpt-5.5',
      'anthropic/claude-opus-4.7',
      'google/gemini-2.5-flash',
    ]);

    expect(orcaModels.find((m) => m.id === 'openai/gpt-5.5')).toMatchObject({
      contextWindow: 400000,
      inputPricePerMToken: 5.0,
      outputPricePerMToken: 30.0,
      cacheReadPricePerMToken: 0.5,
    });
    expect(orcaModels.find((m) => m.id === 'anthropic/claude-opus-4.7')).toMatchObject({
      contextWindow: 1000000,
      inputPricePerMToken: 5.0,
      outputPricePerMToken: 25.0,
      cacheReadPricePerMToken: 0.5,
      cacheCreationPricePerMToken: 6.25,
    });
    expect(orcaModels.find((m) => m.id === 'google/gemini-2.5-flash')).toMatchObject({
      contextWindow: 1000000,
      inputPricePerMToken: 0.3,
      outputPricePerMToken: 2.5,
    });
  });
});
