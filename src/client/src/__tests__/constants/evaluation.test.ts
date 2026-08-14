import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS } from '@/constants/evaluation';

describe('SUPPORTED_PROVIDERS', () => {
  it('is an array', () => {
    expect(Array.isArray(SUPPORTED_PROVIDERS)).toBe(true);
  });

  it('has at least one provider', () => {
    expect(SUPPORTED_PROVIDERS.length).toBeGreaterThan(0);
  });

  it('includes "openai"', () => {
    expect(SUPPORTED_PROVIDERS).toContain('openai');
  });

  it('includes "anthropic"', () => {
    expect(SUPPORTED_PROVIDERS).toContain('anthropic');
  });

  it('includes "mistral"', () => {
    expect(SUPPORTED_PROVIDERS).toContain('mistral');
  });

  it('all values are non-empty strings', () => {
    SUPPORTED_PROVIDERS.forEach((p) => {
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
    });
  });
});

describe('SUPPORTED_MODELS', () => {
  it('is an object', () => {
    expect(typeof SUPPORTED_MODELS).toBe('object');
    expect(SUPPORTED_MODELS).not.toBeNull();
  });

  it('has a models array for each supported provider', () => {
    SUPPORTED_PROVIDERS.forEach((provider) => {
      const models = (SUPPORTED_MODELS as Record<string, string[]>)[provider];
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });
  });

  it('openai models include gpt-4o', () => {
    expect(SUPPORTED_MODELS.openai).toContain('gpt-4o');
  });

  it('anthropic models include claude-3-5-sonnet', () => {
    expect(SUPPORTED_MODELS.anthropic).toContain('claude-3-5-sonnet');
  });

  it('all model values are non-empty strings', () => {
    Object.values(SUPPORTED_MODELS).forEach((models) => {
      models.forEach((model) => {
        expect(typeof model).toBe('string');
        expect(model.length).toBeGreaterThan(0);
      });
    });
  });
});
