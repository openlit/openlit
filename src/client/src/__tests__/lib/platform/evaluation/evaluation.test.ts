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
jest.mock('@/constants/traces', () => ({
  SUPPORTED_EVALUATION_OPERATIONS: ['llm', 'chat'],
}));
jest.mock('@/utils/log', () => ({
  consoleLog: jest.fn(),
}));
jest.mock('date-fns', () => ({
  differenceInSeconds: jest.fn(() => 5),
}));

import { getEvaluationsForSpanId, getEvaluationDetectedByType, autoEvaluate } from '@/lib/platform/evaluation/index';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';
import { getEvaluationConfig, getEvaluationConfigById } from '@/lib/platform/evaluation/config';
import { getLastRunCronLogByCronId, getLastFailureCronLogBySpanId, insertCronLog } from '@/lib/platform/cron-log';
import { getDBConfigById } from '@/lib/db-config';
import asaw from '@/utils/asaw';

beforeEach(() => {
  jest.clearAllMocks();
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'user@example.com' });
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
  (getLastFailureCronLogBySpanId as jest.Mock).mockResolvedValue({ data: [] });
  (insertCronLog as jest.Mock).mockResolvedValue({ err: null });
  (getLastRunCronLogByCronId as jest.Mock).mockResolvedValue(null);
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
    const evalRecord = { spanId: 'span-1', evaluations: [], id: 'eval-1', createdAt: new Date() };
    (dataCollector as jest.Mock).mockResolvedValue({ data: [evalRecord], err: null });

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.data).toEqual(evalRecord);
  });

  it('returns config id when no evaluation data and config exists', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1' }]);

    const result = await getEvaluationsForSpanId('span-1');
    expect(result.config).toBe('cfg-1');
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
});
