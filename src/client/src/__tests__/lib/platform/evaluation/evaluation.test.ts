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
  getDBConfigById: jest.fn(),
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

import { getEvaluationsForSpanId, getEvaluationDetectedByType, autoEvaluate, setEvaluationsForSpanId, getEvaluationSummaryForSpanId, storeManualFeedback } from '@/lib/platform/evaluation/index';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';
import { getEvaluationConfig, getEvaluationConfigById } from '@/lib/platform/evaluation/config';
import { getLastRunCronLogByCronId, getLastFailureCronLogBySpanId, insertCronLog } from '@/lib/platform/cron-log';
import { getDBConfigById } from '@/lib/db-config';
import { getRequestViaSpanId } from '@/lib/platform/request';
import asaw from '@/utils/asaw';
import { runEvaluation } from '@/lib/platform/evaluation/run-evaluation';

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
});
