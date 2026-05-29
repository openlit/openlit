import { DEFAULT_MODELS_BY_PROVIDER } from '@/lib/platform/providers/default-models';

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
      'deepseek', 'xai', 'huggingface', 'replicate',
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
});
