import { providersConfig } from '@/constants/openground';

describe('providersConfig', () => {
  it('is an object with provider entries', () => {
    expect(typeof providersConfig).toBe('object');
    expect(Object.keys(providersConfig).length).toBeGreaterThan(0);
  });

  it('includes openai, anthropic, cohere, mistral, google providers', () => {
    const keys = Object.keys(providersConfig);
    expect(keys).toContain('openai');
    expect(keys).toContain('anthropic');
    expect(keys).toContain('cohere');
    expect(keys).toContain('mistral');
    expect(keys).toContain('google');
  });

  it('each provider has required fields', () => {
    Object.values(providersConfig).forEach((provider) => {
      expect(provider).toHaveProperty('key');
      expect(provider).toHaveProperty('title');
      expect(provider).toHaveProperty('config');
      expect(typeof provider.key).toBe('string');
      expect(typeof provider.title).toBe('string');
      expect(Array.isArray(provider.config)).toBe(true);
    });
  });

  it('each provider config item has a key and type', () => {
    Object.values(providersConfig).forEach((provider) => {
      provider.config.forEach((item: any) => {
        expect(item).toHaveProperty('key');
        expect(item).toHaveProperty('type');
        expect(typeof item.key).toBe('string');
        expect(typeof item.type).toBe('string');
      });
    });
  });

  it('openai provider has api_key and model config items', () => {
    const configKeys = providersConfig.openai.config.map((c: any) => c.key);
    expect(configKeys).toContain('api_key');
    expect(configKeys).toContain('model');
  });

  it('openai model config has options array', () => {
    const modelConfig = providersConfig.openai.config.find((c: any) => c.key === 'model');
    expect(Array.isArray((modelConfig as any)?.options)).toBe(true);
    expect((modelConfig as any)?.options.length).toBeGreaterThan(0);
  });

  it('anthropic default model is claude-3-opus', () => {
    const modelConfig = providersConfig.anthropic.config.find((c: any) => c.key === 'model');
    expect((modelConfig as any)?.defaultValue).toContain('claude-3-opus');
  });

  it('slider configs have limits', () => {
    Object.values(providersConfig).forEach((provider) => {
      provider.config
        .filter((c: any) => c.type === 'slider')
        .forEach((slider: any) => {
          expect(slider).toHaveProperty('limits');
          expect(slider.limits).toHaveProperty('min');
          expect(slider.limits).toHaveProperty('max');
          expect(slider.limits).toHaveProperty('step');
        });
    });
  });
});
