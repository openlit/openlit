// Module-level cache (CACHE + cacheLoaded) means we must isolate modules per test.
// jest.isolateModulesAsync gives each test a fresh module registry.

jest.mock('@/lib/platform/common', () => ({ dataCollector: jest.fn() }));
jest.mock('@/lib/platform/evaluation/table-details', () => ({
  OPENLIT_EVALUATION_TYPE_DEFAULTS_TABLE_NAME: 'openlit_evaluation_type_defaults',
}));

async function isolate<T>(
  setup: (dc: jest.Mock) => void,
  run: (mod: typeof import('@/lib/platform/evaluation/evaluation-type-defaults')) => Promise<T>
): Promise<T> {
  let result!: T;
  await jest.isolateModulesAsync(async () => {
    const { dataCollector } = require('@/lib/platform/common') as { dataCollector: jest.Mock };
    jest.clearAllMocks();
    setup(dataCollector);
    const mod = await import('@/lib/platform/evaluation/evaluation-type-defaults');
    result = await run(mod);
  });
  return result;
}

describe('getEvaluationTypeDefaultPrompts', () => {
  it('calls dataCollector and returns a record keyed by id', async () => {
    const result = await isolate(
      (dc) => dc.mockResolvedValue({
        data: [
          { id: 'hallucination', default_prompt: 'Check for hallucinations' },
          { id: 'bias', default_prompt: 'Check for bias' },
        ],
        err: null,
      }),
      (mod) => mod.getEvaluationTypeDefaultPrompts()
    );
    expect(result).toEqual({
      hallucination: 'Check for hallucinations',
      bias: 'Check for bias',
    });
  });

  it('returns empty object when dataCollector returns error', async () => {
    const result = await isolate(
      (dc) => dc.mockResolvedValue({ data: null, err: 'DB error' }),
      (mod) => mod.getEvaluationTypeDefaultPrompts()
    );
    expect(result).toEqual({});
  });

  it('returns empty object when dataCollector returns non-array data', async () => {
    const result = await isolate(
      (dc) => dc.mockResolvedValue({ data: null, err: null }),
      (mod) => mod.getEvaluationTypeDefaultPrompts()
    );
    expect(result).toEqual({});
  });

  it('uses empty string for missing default_prompt', async () => {
    const result = await isolate(
      (dc) => dc.mockResolvedValue({ data: [{ id: 'toxicity', default_prompt: null }], err: null }),
      (mod) => mod.getEvaluationTypeDefaultPrompts()
    );
    expect(result['toxicity']).toBe('');
  });

  it('skips rows without an id', async () => {
    const result = await isolate(
      (dc) => dc.mockResolvedValue({
        data: [
          { id: null, default_prompt: 'orphan' },
          { id: 'bias', default_prompt: 'bias prompt' },
        ],
        err: null,
      }),
      (mod) => mod.getEvaluationTypeDefaultPrompts()
    );
    expect(Object.keys(result)).toEqual(['bias']);
  });

  it('caches results on second call (dataCollector called once)', async () => {
    await jest.isolateModulesAsync(async () => {
      const { dataCollector } = require('@/lib/platform/common') as { dataCollector: jest.Mock };
      jest.clearAllMocks();
      dataCollector.mockResolvedValue({
        data: [{ id: 'hallucination', default_prompt: 'prompt' }],
        err: null,
      });
      const mod = await import('@/lib/platform/evaluation/evaluation-type-defaults');
      await mod.getEvaluationTypeDefaultPrompts();
      await mod.getEvaluationTypeDefaultPrompts();
      expect(dataCollector).toHaveBeenCalledTimes(1);
    });
  });
});

describe('getEvaluationTypeDefaultPrompt', () => {
  it('returns the prompt for a known typeId', async () => {
    const result = await isolate(
      (dc) => dc.mockResolvedValue({
        data: [{ id: 'hallucination', default_prompt: 'hallucination prompt' }],
        err: null,
      }),
      (mod) => mod.getEvaluationTypeDefaultPrompt('hallucination')
    );
    expect(result).toBe('hallucination prompt');
  });

  it('returns undefined for an unknown typeId', async () => {
    const result = await isolate(
      (dc) => dc.mockResolvedValue({
        data: [{ id: 'hallucination', default_prompt: 'hallucination prompt' }],
        err: null,
      }),
      (mod) => mod.getEvaluationTypeDefaultPrompt('unknown-type')
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when dataCollector errors', async () => {
    const result = await isolate(
      (dc) => dc.mockResolvedValue({ data: null, err: 'error' }),
      (mod) => mod.getEvaluationTypeDefaultPrompt('hallucination')
    );
    expect(result).toBeUndefined();
  });
});
