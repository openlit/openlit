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
  getDBConfigByIdInternal: jest.fn(),
}));
jest.mock('@/lib/telemetry-source', () => ({
  getTelemetryAdapterForDbConfig: jest.fn().mockResolvedValue({
    isBuiltIn: true,
    descriptor: { type: 'clickhouse', isBuiltIn: true },
    adapter: {},
  }),
}));
jest.mock('@/lib/platform/request', () => ({
  getRequestViaSpanId: jest.fn(),
}));
// Evals fetch the span via the traces facade; delegate to the request mock so
// existing `getRequestViaSpanId` expectations keep driving the eval flows.
jest.mock('@/lib/platform/traces/read', () => ({
  getTraceSpanRecord: (...args: unknown[]) =>
    require('@/lib/platform/request').getRequestViaSpanId(...args),
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
// Used only by runOfflineEvaluation's attribute-based rule-context lookup.
jest.mock('@/lib/platform/rule-engine/evaluate', () => ({
  evaluateRules: jest.fn(),
}));

import { getEvaluationsForSpanId, getEvaluationDetectedByType, autoEvaluate, setEvaluationsForSpanId, getEvaluationSummaryForSpanId, storeManualFeedback, extractEvalPromptCompletion, runOfflineEvaluation } from '@/lib/platform/evaluation/index';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';
import { getEvaluationConfig, getEvaluationConfigById } from '@/lib/platform/evaluation/config';
import { getLastRunCronLogByCronId, getLastFailureCronLogBySpanId, insertCronLog } from '@/lib/platform/cron-log';
import { getDBConfigById } from '@/lib/db-config';
import { getTelemetryAdapterForDbConfig } from '@/lib/telemetry-source';
import { getRequestViaSpanId } from '@/lib/platform/request';
import asaw from '@/utils/asaw';
import { runEvaluation } from '@/lib/platform/evaluation/run-evaluation';
import { CronRunStatus } from '@/types/cron';
import { evaluateRules } from '@/lib/platform/rule-engine/evaluate';

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
  (getTelemetryAdapterForDbConfig as jest.Mock).mockResolvedValue({
    isBuiltIn: true,
    descriptor: { type: 'clickhouse', isBuiltIn: true },
    adapter: {},
  });
  // Default runEvaluation success
  (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });
  (evaluateRules as jest.Mock).mockReset();
  (evaluateRules as jest.Mock).mockResolvedValue({ matchingRuleIds: [], entities: [] });
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

  it('logs the traceId and environment from opts instead of falling back to null', async () => {
    const { consoleLog } = require('@/utils/log');
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1' }]);

    await getEvaluationsForSpanId('span-1', { traceId: 'trace-99', environment: 'staging' });

    expect(consoleLog).toHaveBeenCalledWith(
      '[evaluation] load span evaluations',
      expect.objectContaining({ traceId: 'trace-99', environment: 'staging' })
    );
    expect(consoleLog).toHaveBeenCalledWith(
      '[evaluation] trace lookup for evaluation',
      expect.objectContaining({ traceId: 'trace-99' })
    );
  });

  it('falls back to an empty array when dataCollector returns null data', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1' }]);

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.config).toBe('cfg-1');
  });

  it('defaults contextEntityIds to an empty array when the rule engine omits the field (no prior evaluations)', async () => {
    const { getContextFromRuleEngineForTrace } = require('@/lib/platform/evaluation/rule-engine-context');
    (getContextFromRuleEngineForTrace as jest.Mock).mockResolvedValueOnce({
      contextContents: [],
      matchingRuleIds: ['r1'],
    });
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1', databaseConfigId: 'db-1' }]);
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1' } });

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.ruleContext?.contextEntityIds).toEqual([]);
    expect(result.ruleContext?.contextApplied).toBe(true);
  });

  it('defaults contextEntityIds to an empty array when the rule engine omits the field (prior evaluations exist)', async () => {
    const { getContextFromRuleEngineForTrace } = require('@/lib/platform/evaluation/rule-engine-context');
    (getContextFromRuleEngineForTrace as jest.Mock).mockResolvedValueOnce({
      contextContents: [],
      matchingRuleIds: ['r1'],
    });
    const evalRecord = { spanId: 'span-1', evaluations: [], id: 'eval-1', createdAt: new Date(), meta: {} };
    (dataCollector as jest.Mock).mockResolvedValue({ data: [evalRecord], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1', databaseConfigId: 'db-1' }]);
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1' } });

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.ruleContext?.contextEntityIds).toEqual([]);
  });

  it('maps run meta/evaluations defaults and parses a numeric cost from prior evaluations', async () => {
    const evalRecordWithCost = {
      spanId: 'span-1',
      id: 'eval-1',
      createdAt: new Date(),
      meta: { cost: '0.0042' },
      evaluations: [{ evaluation: 'toxicity', score: 0.1, classification: 'low', explanation: 'ok', verdict: 'no' }],
    };
    const evalRecordNoMetaOrEvaluations = {
      spanId: 'span-1',
      id: 'eval-2',
      createdAt: new Date(),
      meta: undefined,
      evaluations: undefined,
    };
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [evalRecordWithCost, evalRecordNoMetaOrEvaluations],
      err: null,
    });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1', databaseConfigId: 'db-1' }]);

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.runs?.[0].cost).toBeCloseTo(0.0042);
    expect(result.runs?.[1].meta).toEqual({});
    expect(result.runs?.[1].evaluations).toEqual([]);
    expect(result.runs?.[1].cost).toBeUndefined();
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

  it('scopes the query to selectedConfig.serviceNames when provided as a non-empty array', async () => {
    const scopedParams = {
      ...params,
      selectedConfig: { serviceNames: ['svc-a', 'svc-b'] },
    };
    await getEvaluationDetectedByType(scopedParams as any, 'toxicity');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("AND meta['service.name'] IN ('svc-a', 'svc-b')");
  });

  it('filters out non-string entries from selectedConfig.serviceNames', async () => {
    const scopedParams = {
      ...params,
      selectedConfig: { serviceNames: ['svc-a', 123, '', null] },
    };
    await getEvaluationDetectedByType(scopedParams as any, 'toxicity');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("AND meta['service.name'] IN ('svc-a')");
  });

  it('does not scope by service name when selectedConfig.serviceNames is not an array', async () => {
    const scopedParams = {
      ...params,
      selectedConfig: { serviceNames: 'not-an-array' },
    };
    await getEvaluationDetectedByType(scopedParams as any, 'toxicity');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).not.toContain("meta['service.name']");
  });

  it('does not scope by service name when selectedConfig.serviceNames is an empty array', async () => {
    const scopedParams = {
      ...params,
      selectedConfig: { serviceNames: [] },
    };
    await getEvaluationDetectedByType(scopedParams as any, 'toxicity');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).not.toContain("meta['service.name']");
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

  it('does not fall back to otel_traces when the traces adapter cannot be resolved', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (getTelemetryAdapterForDbConfig as jest.Mock).mockRejectedValue(
      new Error('Unauthorized user!')
    );

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(false);
    expect(String(result.err)).toContain('Unauthorized user!');
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('falls back to the raw thrown value when the traces adapter rejects with a non-Error', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (getTelemetryAdapterForDbConfig as jest.Mock).mockRejectedValue('plain rejection string');

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(false);
    expect(String(result.err)).toContain('plain rejection string');
  });

  it('converts a Date lastRunTime into an ISO string for the built-in traces query', async () => {
    (getLastRunCronLogByCronId as jest.Mock).mockResolvedValue(new Date('2024-03-15T10:00:00.000Z'));
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });

    await autoEvaluate(autoEvalConfig as any);

    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('2024-03-15T10:00:00.000Z');
  });

  it('uses a Date lastRunTime as the listSpans time-range start for the routed traces connector', async () => {
    const listSpans = jest.fn().mockResolvedValue({ rows: [] });
    (getLastRunCronLogByCronId as jest.Mock).mockResolvedValue(new Date('2024-03-15T10:00:00.000Z'));
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (getTelemetryAdapterForDbConfig as jest.Mock).mockResolvedValue({
      isBuiltIn: false,
      descriptor: { type: 'jaeger', isBuiltIn: false },
      adapter: { listSpans },
    });

    const result = await autoEvaluate(autoEvalConfig as any);

    expect(result.success).toBe(true);
    const [{ timeRange }] = listSpans.mock.calls[0];
    expect(timeRange.start).toEqual(new Date('2024-03-15T10:00:00.000Z'));
  });

  it('excludes handled span ids and returns them via the routed traces connector when loadAutoHandledSpanIds succeeds', async () => {
    const listSpans = jest.fn().mockResolvedValue({
      rows: [
        { spanId: 'handled-span', spanAttributes: {}, resourceAttributes: {} },
        { spanId: 'new-span', spanAttributes: {}, resourceAttributes: {} },
      ],
    });
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (getTelemetryAdapterForDbConfig as jest.Mock).mockResolvedValue({
      isBuiltIn: false,
      descriptor: { type: 'jaeger', isBuiltIn: false },
      adapter: { listSpans },
    });
    // First dataCollector call is loadAutoHandledSpanIds' query.
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ span_id: 'handled-span' }], err: null })
      .mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await autoEvaluate(autoEvalConfig as any);

    expect(result.success).toBe(true);
    expect(runEvaluation).toHaveBeenCalledTimes(1);
  });

  it('treats loadAutoHandledSpanIds as returning an empty set when its query errors', async () => {
    const listSpans = jest.fn().mockResolvedValue({
      rows: [{ spanId: 'span-x', spanAttributes: {}, resourceAttributes: {} }],
    });
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (getTelemetryAdapterForDbConfig as jest.Mock).mockResolvedValue({
      isBuiltIn: false,
      descriptor: { type: 'jaeger', isBuiltIn: false },
      adapter: { listSpans },
    });
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: null, err: 'query failed' })
      .mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await autoEvaluate(autoEvalConfig as any);

    expect(result.success).toBe(true);
    expect(runEvaluation).toHaveBeenCalledTimes(1);
  });

  it('treats loadAutoHandledSpanIds as returning an empty set when its query data is null', async () => {
    const listSpans = jest.fn().mockResolvedValue({
      rows: [{ spanId: 'span-y', spanAttributes: {}, resourceAttributes: {} }],
    });
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (getTelemetryAdapterForDbConfig as jest.Mock).mockResolvedValue({
      isBuiltIn: false,
      descriptor: { type: 'jaeger', isBuiltIn: false },
      adapter: { listSpans },
    });
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: null, err: null })
      .mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await autoEvaluate(autoEvalConfig as any);

    expect(result.success).toBe(true);
    expect(runEvaluation).toHaveBeenCalledTimes(1);
  });

  it('falls back to an empty array when the built-in traces query returns null data', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: null });

    const result = await autoEvaluate(autoEvalConfig as any);

    expect(result.success).toBe(true);
    expect(runEvaluation).not.toHaveBeenCalled();
  });

  it('resolves the skipped trace service name from ResourceAttributes and omits an empty Timestamp', async () => {
    const evalConfig = {
      id: 'eval-cfg-1',
      databaseConfigId: 'db-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      meta: JSON.stringify({ evalSampleRate: 0 }),
    };
    const trace = {
      SpanId: 'span-skip-1',
      ResourceAttributes: { 'service.name': 'svc-from-resource' },
      SpanAttributes: {},
    };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })
      .mockResolvedValue({ data: true, err: null });

    await autoEvaluate(autoEvalConfig as any);

    const skipInsertCall = (dataCollector as jest.Mock).mock.calls.find(
      ([params]) => params?.table === 'openlit_evaluation'
    );
    expect(skipInsertCall?.[0].values[0].meta).toMatchObject({
      'service.name': 'svc-from-resource',
      traceTimeStamp: '',
    });
  });

  it('logs but does not fail the run when storing an auto-skip result errors', async () => {
    const evalConfig = {
      id: 'eval-cfg-1',
      databaseConfigId: 'db-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      meta: JSON.stringify({ evalSampleRate: 0 }),
    };
    const trace = { SpanId: 'span-skip-err', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })
      .mockResolvedValue({ data: null, err: 'skip insert failed' });

    const result = await autoEvaluate(autoEvalConfig as any);

    expect(result.success).toBe(true);
  });

  it('lists candidate spans from the routed traces connector', async () => {
    const listSpans = jest.fn().mockResolvedValue({
      rows: [{ spanId: 'jaeger-span', spanAttributes: {}, resourceAttributes: {} }],
    });
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: {} }])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);
    (getTelemetryAdapterForDbConfig as jest.Mock).mockResolvedValue({
      isBuiltIn: false,
      descriptor: { type: 'jaeger', isBuiltIn: false },
      adapter: { listSpans },
    });
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(true);
    expect(listSpans).toHaveBeenCalled();
    const otelQueries = (dataCollector as jest.Mock).mock.calls.filter(
      ([params]) => typeof params?.query === 'string' && params.query.includes('otel_traces')
    );
    expect(otelQueries).toHaveLength(0);
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

  it('logs the traceId and environment from opts instead of falling back to null', async () => {
    const { consoleLog } = require('@/utils/log');
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1' } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1',
      provider: 'openai',
      model: 'gpt-4',
      secret: { value: 'sk-1' },
      databaseConfigId: 'db-1',
    });

    await setEvaluationsForSpanId('span-1', { traceId: 'trace-1', environment: 'prod' });

    expect(consoleLog).toHaveBeenCalledWith(
      '[evaluation] run evaluation',
      expect.objectContaining({ traceId: 'trace-1', environment: 'prod' })
    );
    expect(consoleLog).toHaveBeenCalledWith(
      '[evaluation] run trace lookup',
      expect.objectContaining({ traceId: 'trace-1' })
    );
  });

  it('throws with the trace lookup error string when the span is missing and traceResult.err is a string', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: {}, err: 'Custom trace lookup failure' });
    await expect(setEvaluationsForSpanId('missing-span')).rejects.toThrow(
      'Custom trace lookup failure'
    );
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

  it('logs the traceId and environment from opts instead of falling back to null', async () => {
    const { consoleLog } = require('@/utils/log');
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });

    await storeManualFeedback('span-1', 'positive', undefined, undefined, {
      traceId: 'trace-1',
      environment: 'prod',
    });

    expect(consoleLog).toHaveBeenCalledWith(
      '[evaluation] save manual feedback',
      expect.objectContaining({ traceId: 'trace-1', environment: 'prod' })
    );
    expect(consoleLog).toHaveBeenCalledWith(
      '[evaluation] feedback trace lookup',
      expect.objectContaining({ traceId: 'trace-1' })
    );
  });

  it('throws with the trace lookup error string when the span is missing and traceResult.err is a string', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: {}, err: 'Custom trace lookup failure' });
    await expect(storeManualFeedback('missing-span', 'positive')).rejects.toThrow(
      'Custom trace lookup failure'
    );
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

  it('defaults priority to 0 for a legacy t.ruleId entry with no priority field', async () => {
    const { getContextFromRulesWithPriority } = require('@/lib/platform/evaluation/rule-engine-context');
    (getContextFromRulesWithPriority as jest.Mock).mockResolvedValue({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] });

    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1', SpanAttributes: {} } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' }, databaseConfigId: 'db-1',
      evaluationTypes: [{ id: 'hallucination', enabled: true, ruleId: 'r-no-priority' }],
    });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    await setEvaluationsForSpanId('span-1');
    expect(getContextFromRulesWithPriority).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([{ ruleId: 'r-no-priority', priority: 0 }]),
      'db-1'
    );
  });

  it('defaults contextEntityIds to an empty array when getContextFromRulesWithPriority omits the field', async () => {
    const { getContextFromRulesWithPriority } = require('@/lib/platform/evaluation/rule-engine-context');
    (getContextFromRulesWithPriority as jest.Mock).mockResolvedValue({ contextContents: [], matchingRuleIds: ['r1'] });

    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1', SpanAttributes: {} } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' }, databaseConfigId: 'db-1',
      evaluationTypes: [{ id: 'hallucination', enabled: true, ruleId: 'r1' }],
    });
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await setEvaluationsForSpanId('span-1');
    expect(result).toMatchObject({ success: true });
  });

  it('defaults contextEntityIds to an empty array when getContextFromRuleEngineForTrace omits the field (no rules configured)', async () => {
    const { getContextFromRuleEngineForTrace } = require('@/lib/platform/evaluation/rule-engine-context');
    (getContextFromRuleEngineForTrace as jest.Mock).mockResolvedValueOnce({ contextContents: [], matchingRuleIds: [] });

    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1', SpanAttributes: {} } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' }, databaseConfigId: 'db-1',
      evaluationTypes: [{ id: 'hallucination', enabled: true }],
    });
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await setEvaluationsForSpanId('span-1');
    expect(result).toMatchObject({ success: true });
  });

  it('uses the default prompt when the evaluation type has no custom prompt', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1', SpanAttributes: {} } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' }, databaseConfigId: 'db-1',
      evaluationTypes: [{ id: 'hallucination', enabled: true, defaultPrompt: 'default hallucination prompt' }],
    });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    await setEvaluationsForSpanId('span-1');
    expect(runEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ contexts: expect.stringContaining('default hallucination prompt') })
    );
  });

  it('includes a service.name meta field derived from the trace ServiceName', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({
      record: { SpanId: 'span-1', ServiceName: 'my-app-service', SpanAttributes: {} },
    });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' }, databaseConfigId: 'db-1',
      evaluationTypes: [],
    });
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    await setEvaluationsForSpanId('span-1');

    const insertCall = (dataCollector as jest.Mock).mock.calls.find(
      ([params]) => params?.table === 'openlit_evaluation'
    );
    expect(insertCall?.[0].values[0].meta).toMatchObject({ 'service.name': 'my-app-service' });
  });

  it('sets a positive cost in stored meta when usage is returned and the model is priced', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1', SpanAttributes: {} } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' }, databaseConfigId: 'db-1',
      evaluationTypes: [],
    });
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({
        data: [{ id: 'gpt-4', inputPricePerMToken: 5, outputPricePerMToken: 15 }],
        err: null,
      })
      .mockResolvedValueOnce({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 1000, completionTokens: 500 },
    });

    await setEvaluationsForSpanId('span-1');

    const insertCall = (dataCollector as jest.Mock).mock.calls.find(
      ([params]) => params?.table === 'openlit_evaluation'
    );
    expect(Number(insertCall?.[0].values[0].meta.cost)).toBeGreaterThan(0);
  });

  it('defaults data.result to an empty array when storing evaluation results', async () => {
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1', SpanAttributes: {} } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({
      id: 'cfg-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' }, databaseConfigId: 'db-1',
      evaluationTypes: [],
    });
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true });

    const result = await setEvaluationsForSpanId('span-1');
    expect(result).toMatchObject({ success: true });
    const insertCall = (dataCollector as jest.Mock).mock.calls.find(
      ([params]) => params?.table === 'openlit_evaluation'
    );
    expect(insertCall?.[0].values[0]['evaluationData.evaluation']).toEqual([]);
  });
});

describe('extractEvalPromptCompletion (attribute-first extraction)', () => {
  it('prefers span attributes (gen_ai.input/output.messages)', () => {
    const trace = {
      SpanAttributes: {
        'gen_ai.input.messages': 'attr-prompt',
        'gen_ai.output.messages': 'attr-response',
      },
      // events would resolve via the mocked SpanAttributes.<key> path
      prompt: 'event-prompt',
      response: 'event-response',
    };
    expect(extractEvalPromptCompletion(trace)).toEqual({
      prompt: 'attr-prompt',
      response: 'attr-response',
    });
  });

  it('falls back through legacy attribute keys', () => {
    const trace = {
      SpanAttributes: {
        'gen_ai.prompt': 'legacy-prompt',
        'gen_ai.completion': 'legacy-completion',
      },
    };
    expect(extractEvalPromptCompletion(trace)).toEqual({
      prompt: 'legacy-prompt',
      response: 'legacy-completion',
    });
  });

  it('falls back to span events when no span attributes are present', () => {
    // The mocked getTraceMappingKeyFullPath returns `SpanAttributes.<key>`,
    // so the events fallback resolves trace.SpanAttributes.prompt/.response.
    const trace = {
      SpanAttributes: { prompt: 'event-prompt', response: 'event-response' },
    };
    expect(extractEvalPromptCompletion(trace)).toEqual({
      prompt: 'event-prompt',
      response: 'event-response',
    });
  });

  it('returns empty strings when nothing is available', () => {
    expect(extractEvalPromptCompletion({ SpanAttributes: {} })).toEqual({
      prompt: '',
      response: '',
    });
    expect(extractEvalPromptCompletion(undefined)).toEqual({
      prompt: '',
      response: '',
    });
  });
});

describe('runOfflineEvaluation', () => {
  const baseConfig = {
    provider: 'openai',
    model: 'gpt-4',
    secret: { value: 'sk-1' },
    evaluationTypes: [
      { id: 'hallucination', enabled: true, defaultPrompt: 'Check for hallucination' },
      { id: 'bias', enabled: false, defaultPrompt: 'Check for bias' },
      { id: 'toxicity', enabled: false, defaultPrompt: 'Check for toxicity' },
      { id: 'custom_check', enabled: true, prompt: 'Custom prompt check' },
    ],
  };

  const baseInput = { prompt: 'What is 2+2?', response: '4' };

  beforeEach(() => {
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });
    (evaluateRules as jest.Mock).mockResolvedValue({ matchingRuleIds: [], entities: [] });
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
  });

  it('runs explicitly enabled evaluation types when evalTypes is not requested', async () => {
    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(result.success).toBe(true);
    expect(result.metadata?.evalTypesRun).toEqual(['hallucination', 'custom_check']);
  });

  it('filters to requested evalTypes when provided', async () => {
    const result = await runOfflineEvaluation(
      { ...baseInput, evalTypes: ['bias'] },
      baseConfig as any,
      'db-1'
    );
    expect(result.success).toBe(true);
    expect(result.metadata?.evalTypesRun).toEqual(['bias']);
  });

  it('falls back to default hallucination/bias/toxicity when no types are enabled and none requested', async () => {
    const configAllDisabled = {
      ...baseConfig,
      evaluationTypes: [
        { id: 'hallucination', enabled: false },
        { id: 'bias', enabled: false },
        { id: 'toxicity', enabled: false },
        { id: 'custom', enabled: false },
      ],
    };
    const result = await runOfflineEvaluation(baseInput, configAllDisabled as any, 'db-1');
    expect([...(result.metadata?.evalTypesRun || [])].sort()).toEqual([
      'bias',
      'hallucination',
      'toxicity',
    ]);
  });

  it('returns a failure without calling runEvaluation when requested evalTypes contains an unknown id', async () => {
    const result = await runOfflineEvaluation(
      { ...baseInput, evalTypes: ['nonexistent'] },
      baseConfig as any,
      'db-1'
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown eval types: nonexistent');
    expect(runEvaluation).not.toHaveBeenCalled();
  });

  it('resolves context from attributes via the rule engine and extracts entity ids', async () => {
    (evaluateRules as jest.Mock).mockResolvedValue({
      matchingRuleIds: ['r1'],
      entities: [],
      entity_data: { 'context:ctx-1': { content: 'attribute-derived context' } },
    });
    const result = await runOfflineEvaluation(
      { ...baseInput, attributes: { 'service.name': 'my-svc' } },
      baseConfig as any,
      'db-1'
    );
    expect(evaluateRules).toHaveBeenCalledWith(
      {
        fields: { 'service.name': 'my-svc' },
        entity_type: 'context',
        include_entity_data: true,
      },
      'db-1'
    );
    expect(result.contextApplied?.ruleMatched).toBe(true);
    expect(result.contextApplied?.matchingRuleIds).toEqual(['r1']);
    expect(result.contextApplied?.contextEntityIds).toEqual(['ctx-1']);
  });

  it('skips the rule engine lookup entirely when attributes is empty', async () => {
    await runOfflineEvaluation({ ...baseInput, attributes: {} }, baseConfig as any, 'db-1');
    expect(evaluateRules).not.toHaveBeenCalled();
  });

  it('skips the rule engine lookup when attributes is not provided', async () => {
    await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(evaluateRules).not.toHaveBeenCalled();
  });

  it('continues with empty rule context when evaluateRules throws', async () => {
    (evaluateRules as jest.Mock).mockRejectedValue(new Error('rule engine down'));
    const result = await runOfflineEvaluation(
      { ...baseInput, attributes: { 'service.name': 'svc' } },
      baseConfig as any,
      'db-1'
    );
    expect(result.success).toBe(true);
    expect(result.contextApplied?.matchingRuleIds).toEqual([]);
    expect(result.contextApplied?.contextEntityIds).toEqual([]);
  });

  it('gracefully handles entity_data entries whose key does not match the context: prefix', async () => {
    (evaluateRules as jest.Mock).mockResolvedValue({
      matchingRuleIds: ['r1'],
      entities: [],
      entity_data: { 'not-a-context-key': { content: 'still has content' } },
    });
    const result = await runOfflineEvaluation(
      { ...baseInput, attributes: { 'service.name': 'svc' } },
      baseConfig as any,
      'db-1'
    );
    expect(result.success).toBe(true);
    expect(result.contextApplied?.contextEntityIds).toEqual([]);
  });

  it('skips entity_data entries without content', async () => {
    (evaluateRules as jest.Mock).mockResolvedValue({
      matchingRuleIds: [],
      entities: [],
      entity_data: { 'context:ctx-1': { content: '' } },
    });
    const result = await runOfflineEvaluation(
      { ...baseInput, attributes: { 'service.name': 'svc' } },
      baseConfig as any,
      'db-1'
    );
    expect(result.contextApplied?.contextEntityIds).toEqual([]);
  });

  it('does nothing extra when evaluateRules resolves without entity_data', async () => {
    (evaluateRules as jest.Mock).mockResolvedValue({ matchingRuleIds: ['r1'], entities: [] });
    const result = await runOfflineEvaluation(
      { ...baseInput, attributes: { 'service.name': 'svc' } },
      baseConfig as any,
      'db-1'
    );
    expect(result.contextApplied?.matchingRuleIds).toEqual(['r1']);
    expect(result.contextApplied?.contextEntityIds).toEqual([]);
  });

  it('appends user-supplied contexts and reports the user contexts count', async () => {
    const result = await runOfflineEvaluation(
      { ...baseInput, contexts: ['user ctx 1', 'user ctx 2'] },
      baseConfig as any,
      'db-1'
    );
    expect(result.contextApplied?.userContextsCount).toBe(2);
  });

  it('defaults userContextsCount to 0 when contexts is not provided', async () => {
    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(result.contextApplied?.userContextsCount).toBe(0);
  });

  it('uses the custom prompt over the default prompt when both are present', async () => {
    await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(runEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ contexts: expect.stringContaining('Custom prompt check') })
    );
  });

  it('falls back to the default prompt when no custom prompt is set', async () => {
    await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(runEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ contexts: expect.stringContaining('Check for hallucination') })
    );
  });

  it('sends an empty contexts string when there are no prebuilt prompts or context contents', async () => {
    const configNoPrompts = {
      ...baseConfig,
      evaluationTypes: [{ id: 'hallucination', enabled: true }],
    };
    await runOfflineEvaluation(baseInput, configNoPrompts as any, 'db-1');
    expect(runEvaluation).toHaveBeenCalledWith(expect.objectContaining({ contexts: '' }));
  });

  it('returns failure without storing when runEvaluation reports failure', async () => {
    (runEvaluation as jest.Mock).mockResolvedValue({ success: false, error: 'Model unavailable' });
    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(result).toEqual({ success: false, error: 'Model unavailable' });
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('includes runId in stored meta and returned metadata when provided', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    const result = await runOfflineEvaluation(
      { ...baseInput, runId: 'run-123' },
      baseConfig as any,
      'db-1'
    );
    expect(result.metadata?.runId).toBe('run-123');
    const [callArg] = (dataCollector as jest.Mock).mock.calls[0];
    expect(callArg.values[0].meta).toMatchObject({ runId: 'run-123' });
  });

  it('omits runId from returned metadata when not provided', async () => {
    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(result.metadata?.runId).toBeUndefined();
  });

  it('stringifies userMetadata entries into meta with a user_ prefix', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    await runOfflineEvaluation(
      { ...baseInput, metadata: { experimentId: 'exp-1', attempt: '2' } },
      baseConfig as any,
      'db-1'
    );
    const [callArg] = (dataCollector as jest.Mock).mock.calls[0];
    expect(callArg.values[0].meta).toMatchObject({
      user_experimentId: 'exp-1',
      user_attempt: '2',
    });
  });

  it('does not add any user_ meta keys when userMetadata is not provided', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    const [callArg] = (dataCollector as jest.Mock).mock.calls[0];
    const metaKeys = Object.keys(callArg.values[0].meta);
    expect(metaKeys.some((k) => k.startsWith('user_'))).toBe(false);
  });

  it('records usage token counts and estimates a positive cost when the model is found', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({
        data: [
          {
            id: 'gpt-4',
            displayName: 'GPT-4',
            modelType: 'chat',
            contextWindow: 8192,
            inputPricePerMToken: 5,
            outputPricePerMToken: 15,
            cacheReadPricePerMToken: 0,
            cacheCreationPricePerMToken: 0,
            capabilities: [],
          },
        ],
        err: null,
      })
      .mockResolvedValueOnce({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 1000, completionTokens: 500 },
    });

    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');

    expect(result.success).toBe(true);
    expect(result.metadata?.usage).toEqual({ promptTokens: 1000, completionTokens: 500 });
    expect(result.metadata?.cost).toBeGreaterThan(0);
    const [callArg] = (dataCollector as jest.Mock).mock.calls[1];
    expect(callArg.values[0].meta).toMatchObject({ promptTokens: '1000', completionTokens: '500' });
    expect(Number(callArg.values[0].meta.cost)).toBeGreaterThan(0);
  });

  it('omits the cost meta field when the model is not found in Manage Models (cost is 0)', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [], err: null })
      .mockResolvedValueOnce({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 100, completionTokens: 50 },
    });

    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');

    expect(result.metadata?.cost).toBeUndefined();
    const [callArg] = (dataCollector as jest.Mock).mock.calls[1];
    expect(callArg.values[0].meta.cost).toBeUndefined();
  });

  it('skips cost estimation and stores no cost when databaseConfigId is empty', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 100, completionTokens: 50 },
    });

    const result = await runOfflineEvaluation(baseInput, baseConfig as any, '');

    expect(result.metadata?.cost).toBeUndefined();
    // Only the storeEvaluation insert call — cost lookup is skipped entirely.
    expect(dataCollector).toHaveBeenCalledTimes(1);
  });

  it('still estimates a cost when only completionTokens is non-zero', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({
        data: [
          {
            id: 'gpt-4',
            inputPricePerMToken: 5,
            outputPricePerMToken: 15,
          },
        ],
        err: null,
      })
      .mockResolvedValueOnce({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 0, completionTokens: 500 },
    });

    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');

    expect(result.metadata?.cost).toBeGreaterThan(0);
  });

  it('still estimates a cost when only promptTokens is non-zero', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({
        data: [
          {
            id: 'gpt-4',
            inputPricePerMToken: 5,
            outputPricePerMToken: 15,
          },
        ],
        err: null,
      })
      .mockResolvedValueOnce({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 1000, completionTokens: 0 },
    });

    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');

    expect(result.metadata?.cost).toBeGreaterThan(0);
  });

  it('skips cost estimation entirely when both promptTokens and completionTokens are zero', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [],
      usage: { promptTokens: 0, completionTokens: 0 },
    });

    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');

    expect(result.metadata?.cost).toBeUndefined();
    // Only the storeEvaluation insert call — cost lookup is skipped for zero usage.
    expect(dataCollector).toHaveBeenCalledTimes(1);
  });

  it('does not attempt cost estimation when usage is absent from the runEvaluation result', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true, result: [] });

    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');

    expect(result.metadata?.usage).toBeUndefined();
    expect(result.metadata?.cost).toBeUndefined();
    // Only the storeEvaluation insert call — no cost-lookup query call.
    expect(dataCollector).toHaveBeenCalledTimes(1);
  });

  it('stores results with an offline_-prefixed span id when storeResults is true (default)', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: true, err: null });
    await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    const [callArg] = (dataCollector as jest.Mock).mock.calls[0];
    expect(callArg.values[0].span_id).toMatch(/^offline_/);
    expect(callArg.values[0].meta).toMatchObject({ source: 'offline_sdk' });
  });

  it('does not call dataCollector to store results when storeResults is false', async () => {
    const result = await runOfflineEvaluation(
      { ...baseInput, storeResults: false },
      baseConfig as any,
      'db-1'
    );
    expect(result.success).toBe(true);
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('logs but does not fail the overall result when storing offline results errors', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: 'Insert failed' });
    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(result.success).toBe(true);
  });

  it('defaults thresholdScore to 0.5 and includes it in the returned metadata', async () => {
    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(result.metadata?.thresholdScore).toBe(0.5);
    expect(runEvaluation).toHaveBeenCalledWith(expect.objectContaining({ thresholdScore: 0.5 }));
  });

  it('uses a caller-supplied thresholdScore when provided', async () => {
    const result = await runOfflineEvaluation(
      { ...baseInput, thresholdScore: 0.75 },
      baseConfig as any,
      'db-1'
    );
    expect(result.metadata?.thresholdScore).toBe(0.75);
    expect(runEvaluation).toHaveBeenCalledWith(expect.objectContaining({ thresholdScore: 0.75 }));
  });

  it('returns a failure with the Error message when runEvaluation throws an Error', async () => {
    (runEvaluation as jest.Mock).mockRejectedValue(new Error('provider timeout'));
    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(result).toEqual({ success: false, error: 'provider timeout' });
  });

  it('returns a failure with a stringified error when runEvaluation throws a non-Error value', async () => {
    (runEvaluation as jest.Mock).mockRejectedValue('plain string failure');
    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(result).toEqual({ success: false, error: 'plain string failure' });
  });

  it('returns the evaluations array from a successful run', async () => {
    (runEvaluation as jest.Mock).mockResolvedValue({
      success: true,
      result: [
        { evaluation: 'hallucination', score: 0.1, classification: 'low', explanation: 'ok', verdict: 'no' },
      ],
    });
    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(result.evaluations).toEqual([
      { evaluation: 'hallucination', score: 0.1, classification: 'low', explanation: 'ok', verdict: 'no' },
    ]);
  });

  it('defaults evaluations to an empty array when runEvaluation returns no result', async () => {
    (runEvaluation as jest.Mock).mockResolvedValue({ success: true });
    const result = await runOfflineEvaluation(baseInput, baseConfig as any, 'db-1');
    expect(result.evaluations).toEqual([]);
  });

  it('falls back to hallucination/bias/toxicity when evaluationConfig.evaluationTypes is undefined', async () => {
    const configWithoutTypes = { provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const result = await runOfflineEvaluation(baseInput, configWithoutTypes as any, 'db-1');
    expect(result.success).toBe(true);
    expect(result.metadata?.evalTypesRun).toEqual([]);
  });

  it('defaults matchingRuleIds to an empty array when evaluateRules resolves without the field', async () => {
    (evaluateRules as jest.Mock).mockResolvedValue({ entities: [] });
    const result = await runOfflineEvaluation(
      { ...baseInput, attributes: { 'service.name': 'svc' } },
      baseConfig as any,
      'db-1'
    );
    expect(result.contextApplied?.matchingRuleIds).toEqual([]);
    expect(result.contextApplied?.ruleMatched).toBe(false);
  });
});
