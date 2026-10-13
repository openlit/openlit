// The prompt cache is module-level, so each test needs a fresh module registry.
// jest.isolateModulesAsync gives each test a fresh module registry.

jest.mock('@/lib/platform/common', () => ({ dataCollector: jest.fn() }));
jest.mock('@/utils/log', () => ({ consoleLog: jest.fn() }));
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

  it('passes databaseConfigId through to dataCollector', async () => {
    await jest.isolateModulesAsync(async () => {
      const { dataCollector } = require('@/lib/platform/common') as { dataCollector: jest.Mock };
      jest.clearAllMocks();
      dataCollector.mockResolvedValue({
        data: [{ id: 'hallucination', default_prompt: 'prompt' }],
        err: null,
      });
      const mod = await import('@/lib/platform/evaluation/evaluation-type-defaults');
      await mod.getEvaluationTypeDefaultPrompts('db-1');
      expect(dataCollector).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('openlit_evaluation_type_defaults'),
        }),
        'query',
        'db-1'
      );
    });
  });

  it('keeps a separate cache entry per databaseConfigId', async () => {
    await jest.isolateModulesAsync(async () => {
      const { dataCollector } = require('@/lib/platform/common') as { dataCollector: jest.Mock };
      jest.clearAllMocks();
      dataCollector.mockResolvedValue({
        data: [{ id: 'hallucination', default_prompt: 'prompt' }],
        err: null,
      });
      const mod = await import('@/lib/platform/evaluation/evaluation-type-defaults');
      await mod.getEvaluationTypeDefaultPrompts('db-1');
      await mod.getEvaluationTypeDefaultPrompts('db-1');
      await mod.getEvaluationTypeDefaultPrompts('db-2');
      expect(dataCollector).toHaveBeenCalledTimes(2);
      expect(dataCollector).toHaveBeenNthCalledWith(
        1,
        expect.any(Object),
        'query',
        'db-1'
      );
      expect(dataCollector).toHaveBeenNthCalledWith(
        2,
        expect.any(Object),
        'query',
        'db-2'
      );
    });
  });

  it('does not cache a failed load', async () => {
    await jest.isolateModulesAsync(async () => {
      const { dataCollector } = require('@/lib/platform/common') as { dataCollector: jest.Mock };
      const { consoleLog } = require('@/utils/log') as { consoleLog: jest.Mock };
      jest.clearAllMocks();
      dataCollector
        .mockResolvedValueOnce({ data: [], err: 'DB error' })
        .mockResolvedValueOnce({
          data: [{ id: 'hallucination', default_prompt: 'prompt' }],
          err: null,
        });
      const mod = await import('@/lib/platform/evaluation/evaluation-type-defaults');
      await expect(mod.getEvaluationTypeDefaultPrompts('db-1')).resolves.toEqual({});
      await expect(mod.getEvaluationTypeDefaultPrompts('db-1')).resolves.toEqual({
        hallucination: 'prompt',
      });
      expect(dataCollector).toHaveBeenCalledTimes(2);
      expect(consoleLog).toHaveBeenCalledWith(
        'Failed to load evaluation type default prompts',
        'db-1',
        'DB error'
      );
    });
  });

  it('does not cache a successful read that returns no prompts', async () => {
    await jest.isolateModulesAsync(async () => {
      const { dataCollector } = require('@/lib/platform/common') as { dataCollector: jest.Mock };
      jest.clearAllMocks();
      dataCollector
        .mockResolvedValueOnce({ data: [], err: null })
        .mockResolvedValueOnce({
          data: [{ id: 'bias', default_prompt: 'bias prompt' }],
          err: null,
        });
      const mod = await import('@/lib/platform/evaluation/evaluation-type-defaults');
      await expect(mod.getEvaluationTypeDefaultPrompts('db-1')).resolves.toEqual({});
      await expect(mod.getEvaluationTypeDefaultPrompts('db-1')).resolves.toEqual({
        bias: 'bias prompt',
      });
      expect(dataCollector).toHaveBeenCalledTimes(2);
    });
  });

  it('does not share the no-id cache with an explicit databaseConfigId', async () => {
    await jest.isolateModulesAsync(async () => {
      const { dataCollector } = require('@/lib/platform/common') as { dataCollector: jest.Mock };
      jest.clearAllMocks();
      dataCollector.mockResolvedValue({
        data: [{ id: 'hallucination', default_prompt: 'prompt' }],
        err: null,
      });
      const mod = await import('@/lib/platform/evaluation/evaluation-type-defaults');
      await mod.getEvaluationTypeDefaultPrompts();
      await mod.getEvaluationTypeDefaultPrompts('db-1');
      expect(dataCollector).toHaveBeenCalledTimes(2);
      expect(dataCollector).toHaveBeenNthCalledWith(
        1,
        expect.any(Object),
        'query',
        undefined
      );
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

  it('forwards databaseConfigId when loading one prompt', async () => {
    await jest.isolateModulesAsync(async () => {
      const { dataCollector } = require('@/lib/platform/common') as { dataCollector: jest.Mock };
      jest.clearAllMocks();
      dataCollector.mockResolvedValue({
        data: [{ id: 'hallucination', default_prompt: 'hallucination prompt' }],
        err: null,
      });
      const mod = await import('@/lib/platform/evaluation/evaluation-type-defaults');
      await expect(
        mod.getEvaluationTypeDefaultPrompt('hallucination', 'db-9')
      ).resolves.toBe('hallucination prompt');
      expect(dataCollector).toHaveBeenCalledWith(
        expect.any(Object),
        'query',
        'db-9'
      );
    });
  });
});
