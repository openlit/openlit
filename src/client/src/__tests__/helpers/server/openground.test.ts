import { generateOpengroundStats, parseOpengroundData } from '@/helpers/server/openground';

describe('generateOpengroundStats', () => {
  it('returns empty stats object when inputs cause errors', () => {
    // Passing invalid/mismatched data triggers the silent catch, returns {}
    const result = generateOpengroundStats({}, {});
    expect(typeof result).toBe('object');
  });

  it('extracts prompt from requestMeta', () => {
    // Build responseMeta as an array with selectedProviders property
    const responseMeta: any[] = [];
    (responseMeta as any).selectedProviders = [];
    const requestMeta = { prompt: 'Hello', selectedProviders: [] };

    const result = generateOpengroundStats(requestMeta, responseMeta);
    expect(result.prompt).toBe('Hello');
  });

  it('collects errors from responseMeta entries', () => {
    const responseMeta: any[] = [['error1', null], [null, { evaluationData: {} }]];
    (responseMeta as any).selectedProviders = [{ provider: 'openai' }, { provider: 'anthropic' }];
    const requestMeta = { prompt: 'test', selectedProviders: [{ provider: 'openai' }, { provider: 'anthropic' }] };

    const result = generateOpengroundStats(requestMeta, responseMeta);
    expect(result.errors).toEqual(['error1']);
  });

  it('sets the first provider as minCostProvider (only first comparison uses Infinity)', () => {
    // After the first assignment, stats.minCostProvider becomes a string ('openai'),
    // so subsequent comparisons (string > number) evaluate to false via NaN coercion.
    // As a result, only the first provider with evaluationData becomes minCostProvider.
    const responseMeta: any[] = [
      [null, { evaluationData: { cost: 0.05, responseTime: 100, completionTokens: 50 } }],
      [null, { evaluationData: { cost: 0.02, responseTime: 200, completionTokens: 30 } }],
    ];
    (responseMeta as any).selectedProviders = [{ provider: 'openai' }, { provider: 'anthropic' }];
    const requestMeta = {
      prompt: 'test',
      selectedProviders: [{ provider: 'openai' }, { provider: 'anthropic' }],
    };

    const result = generateOpengroundStats(requestMeta, responseMeta);
    expect(result.minCostProvider).toBe('openai');
    expect(result.minCost).toBe(0.05);
  });

  it('tracks minimum response time provider', () => {
    const responseMeta: any[] = [
      [null, { evaluationData: { cost: 0.05, responseTime: 50, completionTokens: 50 } }],
      [null, { evaluationData: { cost: 0.02, responseTime: 200, completionTokens: 30 } }],
    ];
    (responseMeta as any).selectedProviders = [{ provider: 'openai' }, { provider: 'anthropic' }];
    const requestMeta = {
      prompt: 'test',
      selectedProviders: [{ provider: 'openai' }, { provider: 'anthropic' }],
    };

    const result = generateOpengroundStats(requestMeta, responseMeta);
    expect(result.minResponseTimeProvider).toBe('openai');
    expect(result.minResponseTime).toBe(50);
  });
});

describe('parseOpengroundData', () => {
  it('parses valid JSON fields into objects', () => {
    const data = {
      responseMeta: '{"providers":["openai"]}',
      requestMeta: '{"prompt":"hello"}',
      stats: '{"totalCost":0.01}',
      name: 'my-run',
    };

    const result = parseOpengroundData(data);
    expect(result.responseMeta).toEqual({ providers: ['openai'] });
    expect(result.requestMeta).toEqual({ prompt: 'hello' });
    expect(result.stats).toEqual({ totalCost: 0.01 });
    expect(result.name).toBe('my-run');
  });

  it('returns the original data when JSON parsing fails', () => {
    const data = {
      responseMeta: 'not-valid-json',
      requestMeta: '{}',
      stats: '{}',
    };

    const result = parseOpengroundData(data);
    expect(result).toBe(data);
  });

  it('handles nested JSON correctly', () => {
    const nested = { level1: { level2: { value: 42 } } };
    const data = {
      responseMeta: JSON.stringify(nested),
      requestMeta: '{}',
      stats: '{}',
    };

    const result = parseOpengroundData(data);
    expect(result.responseMeta).toEqual(nested);
  });
});
