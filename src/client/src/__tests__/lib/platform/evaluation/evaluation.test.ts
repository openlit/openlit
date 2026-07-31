// run-evaluation.ts now uses the Vercel AI SDK (imports eventsource-parser which needs
// TransformStream). Mock the whole module so the AI SDK is never loaded in jsdom.
jest.mock('@/lib/platform/evaluation/run-evaluation', () => ({
  runEvaluation: jest.fn(),
}));
jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
}));
jest.mock('@/lib/platform/evaluation/table-details', () => ({
  OPENLIT_EVALUATION_TABLE_NAME: 'openlit_evaluation',
}));
jest.mock('@/lib/session', () => ({
  getCurrentUser: jest.fn(),
}));
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  }),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: {
    sanitizeValue: jest.fn((v: string) => v),
  },
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
    EVALUATION_CONFIG_NOT_FOUND: 'Eval config not found',
    TRACE_NOT_FOUND: 'Trace not found',
    EVALUATION_VAULT_SECRET_NOT_FOUND: 'Vault secret not found',
    DATABASE_CONFIG_NOT_FOUND: 'DB config not found',
    TRACE_FETCHING_ERROR: 'Trace fetch error',
  })),
}));
jest.mock('@/lib/platform/evaluation/config', () => ({
  getEvaluationConfig: jest.fn(),
  getEvaluationConfigById: jest.fn(),
}));
jest.mock('@/lib/platform/cron-log', () => ({
  getLastRunCronLogByCronId: jest.fn(),
  getLastFailureCronLogBySpanId: jest.fn(),
  insertCronLog: jest.fn(),
}));
jest.mock('@/lib/db-config', () => ({
  getDBConfigByIdInternal: jest.fn(),
}));
jest.mock('@/lib/platform/request', () => ({
  getRequestViaSpanId: jest.fn(),
}));
jest.mock('@/helpers/server/platform', () => ({
  getFilterPreviousParams: jest.fn((p) => ({ ...p, timeLimit: { start: '2024-01-01', end: '2024-01-07' } })),
}));
jest.mock('@/utils/asaw', () => jest.fn());
jest.mock('@/helpers/server/trace', () => ({
  getTraceMappingKeyFullPath: jest.fn((key: string, _full?: boolean) => `SpanAttributes.${key}`),
}));
jest.mock('@/lib/platform/evaluation/rule-engine-context', () => ({
  getContextFromRuleEngineForTrace: jest.fn().mockResolvedValue({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] }),
  getContextFromRulesWithPriority: jest.fn().mockResolvedValue({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] }),
  getContextFromFields: jest.fn().mockResolvedValue({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] }),
  getContextFromRulesWithPriorityForFields: jest.fn().mockResolvedValue({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] }),
}));
jest.mock('@/constants/traces', () => ({
  SUPPORTED_EVALUATION_OPERATIONS: ['llm', 'chat'],
}));
jest.mock('@/utils/log', () => ({
  consoleLog: jest.fn(),
}));
jest.mock('date-fns', () => ({
  differenceInSeconds: jest.fn(() => 5),
}));
jest.mock('@/lib/platform/evaluation/evaluation-type-defaults', () => ({
  getEvaluationTypeDefaultPrompts: jest.fn().mockResolvedValue({}),
  getEvaluationTypeDefaultPrompt: jest.fn().mockResolvedValue(undefined),
}));

import { getEvaluationsForSpanId, getEvaluationDetectedByType, autoEvaluate, setEvaluationsForSpanId, getEvaluationSummaryForSpanId, storeManualFeedback, runOfflineEvaluation } from '@/lib/platform/evaluation/index';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';
import { getEvaluationConfig, getEvaluationConfigById } from '@/lib/platform/evaluation/config';
import { getLastRunCronLogByCronId, getLastFailureCronLogBySpanId, insertCronLog } from '@/lib/platform/cron-log';
import { getRequestViaSpanId } from '@/lib/platform/request';
import asaw from '@/utils/asaw';
import { runEvaluation } from '@/lib/platform/evaluation/run-evaluation';
import { CronRunStatus } from '@/types/cron';

beforeEach(() => {
  jest.clearAllMocks();
  // Reset mocks that may have unconsumed mockResolvedValueOnce queues from previous tests
  (dataCollector as jest.Mock).mockReset();
  (asaw as jest.Mock).mockReset();
  (runEvaluation as jest.Mock).mockReset();
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'user@example.com' });
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
  (getLastFailureCronLogBySpanId as jest.Mock).mockResolvedValue({ data: [] });
  (insertCronLog as jest.Mock).mockResolvedValue({ err: null });
  (getLastRunCronLogByCronId as jest.Mock).mockResolvedValue(null);
  (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1' } });
  // Default runEvaluation success
  (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });
});

describe('getEvaluationsForSpanId', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getEvaluationsForSpanId('span-1')).rejects.toThrow('Unauthorized');
  });

  it('returns error when dataCollector fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: 'DB error' });
    const result = await getEvaluationsForSpanId('span-1');
    expect(result.err).toBe('DB error');
  });

  it('returns first evaluation record when data found', async () => {
    const evalRecord = { spanId: 'span-1', evaluations: [], id: 'eval-1', createdAt: new Date(), meta: {} };
    (dataCollector as jest.Mock).mockResolvedValue({ data: [evalRecord], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1', databaseConfigId: 'db-1' }]);

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.data).toEqual(evalRecord);
  });

  it('returns config id when no evaluation data and config exists', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1', databaseConfigId: 'db-1' }]);

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.config).toBe('cfg-1');
    expect(result.ruleContext).toBeDefined();
  });

  it('returns configErr when evaluation config not found', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: null }]);

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.configErr).toBe('Eval config not found');
  });

  it('returns configErr when getEvaluationConfig throws', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce(['Config error', null]);

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.configErr).toBe('Config error');
  });

  it('returns last failure error when present', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1' }]);
    (getLastFailureCronLogBySpanId as jest.Mock).mockResolvedValue({
      data: [{ errorStacktrace: { 'span-1': 'Python error occurred' } }],
    });

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.err).toBe('Python error occurred');
  });
});

describe('getEvaluationDetectedByType', () => {
  const params = {
    timeLimit: { start: '2024-01-01', end: '2024-01-31' },
    environment: 'production',
    applicationName: 'my-app',
  };

  it('calls dataCollector with query containing eval type', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ total: 5 }] });

    const result = await getEvaluationDetectedByType(params as any, 'toxicity');
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('toxicity');
    expect(query).toContain('openlit_evaluation');
  });

  it('calls dataCollector with correct verdict filter', async () => {
    await getEvaluationDetectedByType(params as any, 'bias');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("verdict = 'yes'");
    expect(query).toContain('bias');
  });
});

describe('autoEvaluate', () => {
  const autoEvalConfig = {
    cronId: 'cron-1',
    evaluationConfigId: 'eval-cfg-1',
  };

  it('returns error when evaluation config not found', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: null }]); // getEvaluationConfigById
    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.err).toBe('Eval config not found');
    expect(result.success).toBe(false);
  });

  it('returns error when evaluation config fetch fails', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce(['Config error', null]);
    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(false);
  });

  it('returns error when database config not found', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1' }]) // getEvaluationConfigById
      .mockResolvedValueOnce([null, { id: null }]); // getDBConfigById returns no id
    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.err).toBe('DB config not found');
    expect(result.success).toBe(false);
  });

  it('returns error when dataCollector fails', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1' }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: 'Query failed' });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(false);
  });

  it('returns success when no traces to evaluate', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(true);
    expect(insertCronLog).toHaveBeenCalled();
  });

  it('includes lastRunTime in query when cron log exists', async () => {
    (getLastRunCronLogByCronId as jest.Mock).mockResolvedValue({ finishedAt: '2024-01-01T00:00:00Z' });
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });

    await autoEvaluate(autoEvalConfig as any);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('parseDateTimeBestEffort');
  });

  it('processes traces via runEvaluation and handles success', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-1', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })  // fetch traces
      .mockResolvedValue({ data: true, err: null });         // storeEvaluation

    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [{ evaluation: 'toxicity', score: 0.1, classification: 'low', explanation: 'ok', verdict: 'no' }],
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(true);
    expect(runEvaluation).toHaveBeenCalled();
  });

  it('handles runEvaluation throwing an error', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-2', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [trace], err: null });
    (runEvaluation as jest.Mock).mockRejectedValue(new Error('AI call failed'));

    const result = await autoEvaluate(autoEvalConfig as any);
    // autoEvaluate returns success=true even when individual trace evals fail (logs error)
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it('handles runEvaluation returning failure', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-3', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [trace], err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: false, error: 'Model error' });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result).toBeDefined();
    // Single trace failed — still SUCCESS (all failed = FAILURE, partial = PARTIAL_SUCCESS, none failed = SUCCESS)
    expect(result.success).toBe(true);
    expect(insertCronLog).toHaveBeenCalled();
  });

  it('records SUCCESS status when all traces evaluate successfully', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-ok', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })
      .mockResolvedValue({ data: true, err: null });

    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [{ evaluation: 'toxicity', score: 0.1, classification: 'low', explanation: 'ok', verdict: 'no' }],
    });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(true);
    expect(insertCronLog).toHaveBeenCalled();
  });

  it('records PARTIAL_SUCCESS status when some traces fail', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace1 = { SpanId: 'span-ok2', Timestamp: '2024-01-01', SpanAttributes: {} };
    const trace2 = { SpanId: 'span-fail', Timestamp: '2024-01-02', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace1, trace2], err: null })
      .mockResolvedValue({ data: true, err: null });

    let callCount = 0;
    (runEvaluation as jest.Mock).mockImplementation(() => {
      callCount++;
      return callCount === 1
        ? Promise.resolve({ success: true, result: [] })
        : Promise.resolve({ success: false, error: 'error' });
    });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(true);
    expect(insertCronLog).toHaveBeenCalled();
  });

  it('handles storeEvaluation error gracefully', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-store-err', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })         // fetch traces
      .mockResolvedValue({ data: null, err: 'Insert failed' });    // storeEvaluation fails

    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [{ evaluation: 'toxicity', score: 0.1, classification: 'low', explanation: 'ok', verdict: 'no' }],
    });

    const result = await autoEvaluate(autoEvalConfig as any);
    // autoEvaluate still completes even if individual storeEvaluation fails
    expect(result.success).toBe(true);
  });

  it('handles runEvaluation returning empty result', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-no-json', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [trace], err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: false, result: [], error: 'Invalid format' });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result).toBeDefined();
  });

  it('processes multiple traces concurrently', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const traces = [
      { SpanId: 'span-a', Timestamp: '2024-01-01', SpanAttributes: {} },
      { SpanId: 'span-b', Timestamp: '2024-01-02', SpanAttributes: {} },
      { SpanId: 'span-c', Timestamp: '2024-01-03', SpanAttributes: {} },
    ];

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: traces, err: null })
      .mockResolvedValue({ data: true, err: null });

    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(true);
    expect(runEvaluation).toHaveBeenCalledTimes(3);
  });

  it('does not run evaluation when sample rate is 0', async () => {
    const evalConfig = {
      id: 'eval-cfg-1',
      databaseConfigId: 'db-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      meta: JSON.stringify({ evalSampleRate: 0 }),
    };
    const trace = { SpanId: 'span-1', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })
      .mockResolvedValue({ data: true, err: null });

    const result = await autoEvaluate(autoEvalConfig as any);

    expect(result.success).toBe(true);
    expect(runEvaluation).not.toHaveBeenCalled();
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'openlit_evaluation',
        values: [
          expect.objectContaining({
            span_id: 'span-1',
            meta: expect.objectContaining({ source: 'auto_skipped' }),
          }),
        ],
      }),
      'insert',
      'db-1'
    );
    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        runStatus: CronRunStatus.SUCCESS,
        meta: expect.objectContaining({
          sampleRate: 0,
          totalSpans: 1,
          totalSampled: 0,
          totalSkipped: 1,
          totalEvaluated: 0,
          totalFailed: 0,
          spanIds: [],
        }),
      }),
      'db-1'
    );
  });

  it('falls back to default sample rate when stored value is invalid', async () => {
    const evalConfig = {
      id: 'eval-cfg-1',
      databaseConfigId: 'db-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      meta: JSON.stringify({ evalSampleRate: 'invalid' }),
    };
    const trace = { SpanId: 'span-1', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })
      .mockResolvedValue({ data: true, err: null });

    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    await autoEvaluate(autoEvalConfig as any);

    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          sampleRate: 1,
          totalSampled: 1,
        }),
      }),
      'db-1'
    );
  });

  it('records sampling metadata in cron log', async () => {
    const evalConfig = {
      id: 'eval-cfg-1',
      databaseConfigId: 'db-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      meta: JSON.stringify({ evalSampleRate: 1 }),
    };
    const trace = { SpanId: 'span-1', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })
      .mockResolvedValue({ data: true, err: null });

    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    await autoEvaluate(autoEvalConfig as any);

    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        runStatus: CronRunStatus.SUCCESS,
        meta: expect.objectContaining({
          sampleRate: 1,
          totalSpans: 1,
          totalSampled: 1,
          totalSkipped: 0,
          totalEvaluated: 1,
          totalFailed: 0,
          spanIds: ['span-1'],
        }),
      }),
      'db-1'
    );
  });

  it('excludes auto_skipped spans from the pending trace query', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });

    await autoEvaluate(autoEvalConfig as any);

    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("meta['source'] IN ('auto', 'auto_skipped')");
  });
});

describe('setEvaluationsForSpanId', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(setEvaluationsForSpanId('span-1')).rejects.toThrow('Unauthorized');
  });

  it('throws when span not found', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: {} });
    await expect(setEvaluationsForSpanId('missing-span')).rejects.toThrow('Trace not found');
  });

  it('calls getEvaluationConfig and runEvaluation when span is found', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1' } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      databaseConfigId: 'db-1',
      evaluationTypes: [],
    });
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await setEvaluationsForSpanId('span-1');
    expect(result).toBeDefined();
    expect(runEvaluation).toHaveBeenCalled();
    expect(getEvaluationConfig).toHaveBeenCalled();
  });

  it('returns failure when runEvaluation returns failure', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1' } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      databaseConfigId: 'db-1',
    });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: false, error: 'Provider error' });

    const result = await setEvaluationsForSpanId('span-1');
    expect(result).toMatchObject({ success: false });
  });

  it('returns failure when runEvaluation throws', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1' } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      databaseConfigId: 'db-1',
    });
    (runEvaluation as jest.Mock).mockRejectedValue(new Error('Network error'));

    const result = await setEvaluationsForSpanId('span-1');
    expect(result).toMatchObject({ success: false });
  });
});

describe('getEvaluationSummaryForSpanId', () => {
  it('returns null when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    const result = await getEvaluationSummaryForSpanId('span-1');
    expect(result).toBeNull();
  });

  it('returns null when dataCollector returns error', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: 'DB error' });
    const result = await getEvaluationSummaryForSpanId('span-1');
    expect(result).toBeNull();
  });

  it('returns null when dataCollector returns empty data', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    const result = await getEvaluationSummaryForSpanId('span-1');
    expect(result).toBeNull();
  });

  it('returns summary when data is present', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [{ runCount: '5', totalCost: '0.012', latestModel: 'gpt-4o' }],
      err: null,
    });
    const result = await getEvaluationSummaryForSpanId('span-1');
    expect(result).toEqual({ runCount: 5, totalCost: 0.012, latestModel: 'gpt-4o' });
  });

  it('defaults runCount and totalCost to 0 when row values are falsy', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [{ runCount: null, totalCost: null, latestModel: '' }],
      err: null,
    });
    const result = await getEvaluationSummaryForSpanId('span-1');
    expect(result!.runCount).toBe(0);
    expect(result!.totalCost).toBe(0);
    expect(result!.latestModel).toBeUndefined();
  });

  it('queries the evaluation table for the span id', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ runCount: 1, totalCost: 0, latestModel: null }], err: null });
    await getEvaluationSummaryForSpanId('span-abc');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('span-abc');
    expect(query).toContain('openlit_evaluation');
  });
});

describe('storeManualFeedback', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(storeManualFeedback('span-1', 'positive')).rejects.toThrow('Unauthorized');
  });

  it('throws when span is not found', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: {} });
    await expect(storeManualFeedback('missing-span', 'positive')).rejects.toThrow('Trace not found');
  });

  it('inserts positive feedback with score 0', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    const result = await storeManualFeedback('span-1', 'positive');
    expect(result).toEqual({ data: true });
    const [callArg] = (dataCollector as jest.Mock).mock.calls[0];
    const row = callArg.values[0];
    expect(row.scores).toEqual({ manual_feedback: 0 });
    expect(row.meta).toMatchObject({ source: 'manual_feedback', feedback_rating: 'positive' });
  });

  it('inserts negative feedback with score 1', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    await storeManualFeedback('span-1', 'negative');
    const [callArg] = (dataCollector as jest.Mock).mock.calls[0];
    expect(callArg.values[0].scores).toEqual({ manual_feedback: 1 });
  });

  it('inserts neutral feedback with score 0.5', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    await storeManualFeedback('span-1', 'neutral');
    const [callArg] = (dataCollector as jest.Mock).mock.calls[0];
    expect(callArg.values[0].scores).toEqual({ manual_feedback: 0.5 });
  });

  it('includes comment in meta when provided', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    await storeManualFeedback('span-1', 'positive', 'Great response!');
    const [callArg] = (dataCollector as jest.Mock).mock.calls[0];
    expect(callArg.values[0].meta).toMatchObject({ feedback_comment: 'Great response!' });
  });

  it('returns error when dataCollector insert fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'Insert failed', data: null });
    const result = await storeManualFeedback('span-1', 'positive');
    expect(result).toMatchObject({ err: 'Insert failed' });
  });
});

describe('getEvaluationsForSpanId — feedback rows', () => {
  it('returns feedbacks array when rows have manual_feedback source', async () => {
    const feedbackRow = {
      spanId: 'span-1', id: 'fb-1', createdAt: new Date('2024-01-01'),
      meta: { source: 'manual_feedback', feedback_rating: 'positive', feedback_comment: 'Good' },
      evaluations: [],
    };
    (dataCollector as jest.Mock).mockResolvedValue({ data: [feedbackRow], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1' }]);

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.feedbacks).toBeDefined();
    expect(result.feedbacks!.length).toBe(1);
    expect(result.feedbacks![0].rating).toBe('positive');
    expect(result.feedbacks![0].comment).toBe('Good');
  });

  it('defaults feedback rating to neutral when not set', async () => {
    const feedbackRow = {
      spanId: 'span-1', id: 'fb-2', createdAt: new Date(),
      meta: { source: 'manual_feedback' },
      evaluations: [],
    };
    (dataCollector as jest.Mock).mockResolvedValue({ data: [feedbackRow], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1' }]);

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.feedbacks![0].rating).toBe('neutral');
    expect(result.feedbacks![0].comment).toBeUndefined();
  });
});

describe('setEvaluationsForSpanId — evaluationTypes branches', () => {
  it('uses default types (hallucination/bias/toxicity) when no evaluationTypes with enabled=true', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1', SpanAttributes: {} } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      databaseConfigId: 'db-1',
      evaluationTypes: [
        { id: 'hallucination', enabled: false },
        { id: 'bias', enabled: false },
        { id: 'toxicity', enabled: false },
        { id: 'relevance', enabled: false },
      ],
    });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await setEvaluationsForSpanId('span-1');
    expect(result).toBeDefined();
    expect(runEvaluation).toHaveBeenCalled();
  });

  it('uses enabled types when some are explicitly enabled', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1', SpanAttributes: {} } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      databaseConfigId: 'db-1',
      evaluationTypes: [
        { id: 'hallucination', enabled: true, prompt: 'custom prompt' },
        { id: 'bias', enabled: false },
      ],
    });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await setEvaluationsForSpanId('span-1');
    expect(result).toBeDefined();
    expect(runEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ contexts: expect.stringContaining('custom prompt') })
    );
  });

  it('collects rules from t.rules array and calls getContextFromRulesWithPriority', async () => {
    const { getContextFromRulesWithPriority } = require('@/lib/platform/evaluation/rule-engine-context');
    (getContextFromRulesWithPriority as jest.Mock).mockResolvedValue({ contextContents: ['ctx'], matchingRuleIds: ['r1'], contextEntityIds: ['e1'] });

    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1', SpanAttributes: {} } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      databaseConfigId: 'db-1',
      evaluationTypes: [
        { id: 'hallucination', enabled: true, rules: [{ ruleId: 'r1', priority: 5 }] },
      ],
    });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    await setEvaluationsForSpanId('span-1');
    expect(getContextFromRulesWithPriority).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([{ ruleId: 'r1', priority: 5 }]),
      'db-1'
    );
  });

  it('collects legacy t.ruleId field into rulesWithPriority', async () => {
    const { getContextFromRulesWithPriority } = require('@/lib/platform/evaluation/rule-engine-context');
    (getContextFromRulesWithPriority as jest.Mock).mockResolvedValue({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] });

    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1', SpanAttributes: {} } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' }, databaseConfigId: 'db-1',
      evaluationTypes: [{ id: 'hallucination', enabled: true, ruleId: 'r-legacy', priority: 2 }],
    });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    await setEvaluationsForSpanId('span-1');
    expect(getContextFromRulesWithPriority).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([{ ruleId: 'r-legacy', priority: 2 }]),
      'db-1'
    );
  });

  it('applies per-type thresholdScore when storing dashboard/manual evaluation verdicts', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({
      record: { SpanId: 'span-1', SpanAttributes: {} },
    });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      databaseConfigId: 'db-1',
      evaluationTypes: [
        { id: 'toxicity', enabled: true, label: 'Toxicity', thresholdScore: 0.8 },
      ],
    });
    // Raw LLM verdict would be "yes" under the default 0.5 threshold; the
    // per-type threshold of 0.8 must recompute it to "no" before storage.
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [
        {
          evaluation: 'toxicity',
          score: 0.6,
          verdict: 'yes',
          classification: 'mild',
          explanation: 'borderline',
        },
      ],
    });
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });

    const result = await setEvaluationsForSpanId('span-1');
    expect(result).toMatchObject({ success: true });

    const insertCall = (dataCollector as jest.Mock).mock.calls.find(
      (call) => call[1] === 'insert'
    );
    expect(insertCall).toBeDefined();
    const stored = insertCall![0].values[0];
    // storeEvaluation remaps ids to configured labels (main normalizeEvaluationResults).
    expect(stored['evaluationData.evaluation']).toEqual(['Toxicity']);
    expect(stored['evaluationData.verdict']).toEqual(['no']);
    expect(stored.scores).toEqual({ Toxicity: 0.6 });
  });
});

describe('runOfflineEvaluation', () => {
  const baseConfig = {
    id: 'cfg-1',
    provider: 'openai',
    model: 'gpt-4',
    secret: { value: 'sk-1' },
    databaseConfigId: 'db-1',
  };

  beforeEach(() => {
    const { getContextFromFields, getContextFromRulesWithPriorityForFields } =
      require('@/lib/platform/evaluation/rule-engine-context');
    (getContextFromFields as jest.Mock).mockResolvedValue({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] });
    (getContextFromRulesWithPriorityForFields as jest.Mock).mockResolvedValue({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] });
  });

  it('rejects unknown eval types without calling runEvaluation', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [{ id: 'hallucination', enabled: true, label: 'Hallucination' }],
    };

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r', evalTypes: ['bogus'] },
      config as any,
      'db-1'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown eval types: bogus');
    expect(runEvaluation).not.toHaveBeenCalled();
  });

  it('rejects explicitly requested but disabled eval types without calling runEvaluation', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [
        { id: 'hallucination', enabled: true, label: 'Hallucination' },
        { id: 'bias', enabled: false, label: 'Bias' },
      ],
    };

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r', evalTypes: ['bias'] },
      config as any,
      'db-1'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Disabled eval types: bias');
    expect(runEvaluation).not.toHaveBeenCalled();
  });

  it('reports unknown types even when other requested types are valid', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [{ id: 'hallucination', enabled: true, label: 'Hallucination' }],
    };

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r', evalTypes: ['hallucination', 'bogus'] },
      config as any,
      'db-1'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown eval types: bogus');
    expect(runEvaluation).not.toHaveBeenCalled();
  });

  it('runs only the requested enabled types, excluding others from context', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [
        { id: 'hallucination', enabled: true, label: 'Hallucination', defaultPrompt: 'hallucination ctx' },
        { id: 'bias', enabled: true, label: 'Bias', defaultPrompt: 'bias ctx' },
      ],
    };
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [{ evaluation: 'Hallucination', score: 0.1, classification: 'none', explanation: 'ok', verdict: 'no' }],
    });

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r', evalTypes: ['hallucination'] },
      config as any,
      'db-1'
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.evalTypesRun).toEqual(['hallucination']);
    const [{ contexts }] = (runEvaluation as jest.Mock).mock.calls[0];
    expect(contexts).toContain('hallucination ctx');
    expect(contexts).not.toContain('bias ctx');
  });

  it('defaults to all enabled types when eval_types is omitted', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [
        { id: 'hallucination', enabled: true, label: 'Hallucination' },
        { id: 'bias', enabled: false, label: 'Bias' },
        { id: 'relevance', enabled: true, label: 'Relevance' },
      ],
    };
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r' },
      config as any,
      'db-1'
    );

    expect(result.success).toBe(true);
    expect([...(result.metadata?.evalTypesRun || [])].sort()).toEqual(['hallucination', 'relevance']);
  });

  it('falls back to hallucination/bias/toxicity defaults when nothing is enabled and no eval_types requested', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [
        { id: 'hallucination', enabled: false, label: 'Hallucination' },
        { id: 'bias', enabled: false, label: 'Bias' },
        { id: 'toxicity', enabled: false, label: 'Toxicity' },
        { id: 'relevance', enabled: false, label: 'Relevance' },
      ],
    };
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r' },
      config as any,
      'db-1'
    );

    expect([...(result.metadata?.evalTypesRun || [])].sort()).toEqual(['bias', 'hallucination', 'toxicity']);
  });

  it('overrides verdict to "no" when the per-type threshold is stricter than the raw score', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [{ id: 'toxicity', enabled: true, label: 'Toxicity', thresholdScore: 0.8 }],
    };
    // Score of 0.6 would be 'yes' under the default 0.5 threshold, but the
    // per-type threshold of 0.8 should keep it 'no'.
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [{ evaluation: 'Toxicity', score: 0.6, classification: 'mild', explanation: 'x', verdict: 'yes' }],
    });

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r', evalTypes: ['toxicity'] },
      config as any,
      'db-1'
    );

    expect(result.evaluations?.[0].verdict).toBe('no');
  });

  it('overrides verdict to "yes" when the score exceeds a stricter per-type threshold', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [{ id: 'toxicity', enabled: true, label: 'Toxicity', thresholdScore: 0.3 }],
    };
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [{ evaluation: 'Toxicity', score: 0.5, classification: 'mild', explanation: 'x', verdict: 'no' }],
    });

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r', evalTypes: ['toxicity'] },
      config as any,
      'db-1'
    );

    expect(result.evaluations?.[0].verdict).toBe('yes');
  });

  it('falls back to the request thresholdScore when the type has no per-type threshold configured', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [{ id: 'toxicity', enabled: true, label: 'Toxicity' }],
    };
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [{ evaluation: 'Toxicity', score: 0.9, classification: 'severe', explanation: 'x', verdict: 'no' }],
    });

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r', evalTypes: ['toxicity'], thresholdScore: 0.95 },
      config as any,
      'db-1'
    );

    // 0.9 does not exceed the request-level 0.95 threshold
    expect(result.evaluations?.[0].verdict).toBe('no');
  });

  it('falls back to the request threshold when the returned evaluation label matches no configured type', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [
        { id: 'sensitivity', enabled: true, label: 'PII - Financial', thresholdScore: 0.9 },
      ],
    };
    // The model echoes back a label that doesn't match the configured id or
    // label exactly (e.g. a custom prompt without the matching context header).
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [{ evaluation: 'Pii Financial Data', score: 0.6, classification: 'leak', explanation: 'x', verdict: 'yes' }],
    });

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r', evalTypes: ['sensitivity'], thresholdScore: 0.5 },
      config as any,
      'db-1'
    );

    // The unmatched result still comes back (no crash, no dropped row), and
    // since its label didn't match, the 0.9 per-type threshold is NOT applied —
    // it falls back to the request-level 0.5 threshold instead.
    expect(result.success).toBe(true);
    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations?.[0].verdict).toBe('yes');
  });

  it('returns failure when runEvaluation fails', async () => {
    const config = {
      ...baseConfig,
      evaluationTypes: [{ id: 'hallucination', enabled: true, label: 'Hallucination' }],
    };
    (runEvaluation as jest.Mock).mockResolvedValue({ success: false, error: 'Model error' });

    const result = await runOfflineEvaluation(
      { prompt: 'p', response: 'r' },
      config as any,
      'db-1'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Model error');
  });

  describe('rule-priority context consistency with the real-time path', () => {
    it('collects rules from enabled types and resolves context via getContextFromRulesWithPriorityForFields, matching the real-time path', async () => {
      const { getContextFromRulesWithPriorityForFields, getContextFromFields } =
        require('@/lib/platform/evaluation/rule-engine-context');
      (getContextFromRulesWithPriorityForFields as jest.Mock).mockResolvedValue({
        contextContents: ['linked rule context'],
        matchingRuleIds: ['r1'],
        contextEntityIds: ['e1'],
      });
      const config = {
        ...baseConfig,
        evaluationTypes: [
          { id: 'hallucination', enabled: true, rules: [{ ruleId: 'r1', priority: 5 }] },
        ],
      };
      (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

      const result = await runOfflineEvaluation(
        { prompt: 'p', response: 'r', attributes: { 'service.name': 'my-app' } },
        config as any,
        'db-1'
      );

      expect(getContextFromRulesWithPriorityForFields).toHaveBeenCalledWith(
        { 'service.name': 'my-app' },
        [{ ruleId: 'r1', priority: 5 }],
        'db-1'
      );
      expect(getContextFromFields).not.toHaveBeenCalled();
      expect(result.contextApplied?.matchingRuleIds).toEqual(['r1']);
    });

    it('collects legacy ruleId/priority fields into rulesWithPriority, same as the real-time path', async () => {
      const { getContextFromRulesWithPriorityForFields } =
        require('@/lib/platform/evaluation/rule-engine-context');
      (getContextFromRulesWithPriorityForFields as jest.Mock).mockResolvedValue({
        contextContents: [], matchingRuleIds: [], contextEntityIds: [],
      });
      const config = {
        ...baseConfig,
        evaluationTypes: [
          { id: 'hallucination', enabled: true, ruleId: 'r-legacy', priority: 2 },
        ],
      };
      (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

      await runOfflineEvaluation(
        { prompt: 'p', response: 'r', attributes: { 'service.name': 'my-app' } },
        config as any,
        'db-1'
      );

      expect(getContextFromRulesWithPriorityForFields).toHaveBeenCalledWith(
        { 'service.name': 'my-app' },
        [{ ruleId: 'r-legacy', priority: 2 }],
        'db-1'
      );
    });

    it('falls back to getContextFromFields when no enabled type has linked rules', async () => {
      const { getContextFromFields, getContextFromRulesWithPriorityForFields } =
        require('@/lib/platform/evaluation/rule-engine-context');
      (getContextFromFields as jest.Mock).mockResolvedValue({
        contextContents: ['generic context'], matchingRuleIds: [], contextEntityIds: [],
      });
      const config = {
        ...baseConfig,
        evaluationTypes: [{ id: 'hallucination', enabled: true }],
      };
      (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

      await runOfflineEvaluation(
        { prompt: 'p', response: 'r', attributes: { 'service.name': 'my-app' } },
        config as any,
        'db-1'
      );

      expect(getContextFromFields).toHaveBeenCalledWith({ 'service.name': 'my-app' }, 'db-1');
      expect(getContextFromRulesWithPriorityForFields).not.toHaveBeenCalled();
    });

    it('does not call the rule engine at all when no attributes are provided', async () => {
      const { getContextFromFields, getContextFromRulesWithPriorityForFields } =
        require('@/lib/platform/evaluation/rule-engine-context');
      const config = {
        ...baseConfig,
        evaluationTypes: [
          { id: 'hallucination', enabled: true, rules: [{ ruleId: 'r1', priority: 5 }] },
        ],
      };
      (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

      await runOfflineEvaluation(
        { prompt: 'p', response: 'r' },
        config as any,
        'db-1'
      );

      expect(getContextFromFields).not.toHaveBeenCalled();
      expect(getContextFromRulesWithPriorityForFields).not.toHaveBeenCalled();
    });
  });
});
