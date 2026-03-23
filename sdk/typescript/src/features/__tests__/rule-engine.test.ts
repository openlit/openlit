import RuleEngine from '../rule-engine';

// Mock OpenlitConfig
jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    applicationName: 'test-app',
    environment: 'test',
  },
}));

// Mock constant
jest.mock('../../constant', () => ({
  OPENLIT_URL: 'http://127.0.0.1:3000',
}));

// Save original env
const originalEnv = process.env;

beforeEach(() => {
  jest.restoreAllMocks();
  process.env = { ...originalEnv };
  delete process.env.OPENLIT_URL;
  delete process.env.OPENLIT_API_KEY;
});

afterAll(() => {
  process.env = originalEnv;
});

describe('RuleEngine.evaluate', () => {
  it('sends correct request to rule-engine evaluate endpoint', async () => {
    const mockResponse = {
      matchingRuleIds: ['rule-1'],
      entities: [{ rule_id: 'rule-1', entity_type: 'context', entity_id: 'ctx-1' }],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await RuleEngine.evaluate({
      url: 'http://localhost:3000',
      apiKey: 'test-key',
      entityType: 'context',
      fields: { 'gen_ai.system': 'openai' },
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/rule-engine/evaluate');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-key');

    const body = JSON.parse(options.body);
    expect(body.entity_type).toBe('context');
    expect(body.fields).toEqual({ 'gen_ai.system': 'openai' });
    expect(body.source).toBe('ts-sdk');

    expect(result).toEqual(mockResponse);
  });

  it('returns error object on HTTP error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const result = await RuleEngine.evaluate({
      url: 'http://localhost:3000',
      apiKey: 'bad-key',
      entityType: 'context',
      fields: {},
    });

    expect(result).toHaveProperty('err');
    expect((result as any).err).toContain('401');
  });

  it('returns error object on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const result = await RuleEngine.evaluate({
      url: 'http://localhost:3000',
      apiKey: 'test-key',
      entityType: 'context',
      fields: {},
    });

    expect(result).toHaveProperty('err');
    expect((result as any).err).toContain('Network error');
  });

  it('uses OPENLIT_URL env var as fallback', async () => {
    process.env.OPENLIT_URL = 'http://env-host:4000';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ matchingRuleIds: [] }),
    });

    await RuleEngine.evaluate({
      apiKey: 'key',
      entityType: 'context',
      fields: {},
    });

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://env-host:4000/api/rule-engine/evaluate');
  });

  it('uses OPENLIT_API_KEY env var as fallback', async () => {
    process.env.OPENLIT_API_KEY = 'env-api-key';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ matchingRuleIds: [] }),
    });

    await RuleEngine.evaluate({
      url: 'http://localhost:3000',
      entityType: 'context',
      fields: {},
    });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer env-api-key');
  });

  it('passes includeEntityData and entityInputs', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ matchingRuleIds: [], entity_data: {} }),
    });

    await RuleEngine.evaluate({
      url: 'http://localhost:3000',
      apiKey: 'key',
      entityType: 'prompt',
      fields: { key: 'val' },
      includeEntityData: true,
      entityInputs: { variables: { name: 'test' } },
    });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.include_entity_data).toBe(true);
    expect(body.entity_inputs).toEqual({ variables: { name: 'test' } });
    expect(body.entity_type).toBe('prompt');
  });

  it('includes metaProperties from OpenlitConfig', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ matchingRuleIds: [] }),
    });

    await RuleEngine.evaluate({
      url: 'http://localhost:3000',
      apiKey: 'key',
      entityType: 'context',
      fields: {},
    });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.metaProperties).toEqual({
      applicationName: 'test-app',
      environment: 'test',
    });
  });
});