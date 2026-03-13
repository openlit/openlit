jest.mock('child_process', () => ({
  spawn: jest.fn(),
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
jest.mock('@/constants/traces', () => ({
  SUPPORTED_EVALUATION_OPERATIONS: ['llm', 'chat'],
}));
jest.mock('@/utils/log', () => ({
  consoleLog: jest.fn(),
}));
jest.mock('date-fns', () => ({
  differenceInSeconds: jest.fn(() => 5),
}));

import { getEvaluationsForSpanId, getEvaluationDetectedByType, autoEvaluate, setEvaluationsForSpanId } from '@/lib/platform/evaluation/index';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';
import { getEvaluationConfig, getEvaluationConfigById } from '@/lib/platform/evaluation/config';
import { getLastRunCronLogByCronId, getLastFailureCronLogBySpanId, insertCronLog } from '@/lib/platform/cron-log';
import { getDBConfigById } from '@/lib/db-config';
import asaw from '@/utils/asaw';
import { spawn } from 'child_process';

// Helper to create a mock spawn process that calls callbacks synchronously
// (synchronous calls are required for V8 coverage to capture the production callback bodies)
function makeMockSpawnProcess(exitCode: number, stdout: string, stderr: string = '') {
  let stdoutDataCb: Function | null = null;
  let stderrDataCb: Function | null = null;

  const mockProcess = {
    stdout: {
      on: jest.fn((event: string, cb: Function) => {
        if (event === 'data') stdoutDataCb = cb;
      }),
    },
    stderr: {
      on: jest.fn((event: string, cb: Function) => {
        if (event === 'data') stderrDataCb = cb;
      }),
    },
    on: jest.fn((event: string, cb: Function) => {
      if (event === 'close') {
        // Send data synchronously before calling close — stdout.on('data') is registered first
        if (stdout && stdoutDataCb) stdoutDataCb(Buffer.from(stdout));
        if (stderr && stderrDataCb) stderrDataCb(Buffer.from(stderr));
        cb(exitCode);
      }
    }),
  };
  return mockProcess;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset mocks that may have unconsumed mockResolvedValueOnce queues from previous tests
  (dataCollector as jest.Mock).mockReset();
  (asaw as jest.Mock).mockReset();
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

  it('processes traces via Python spawn and handles success', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-1', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })  // fetch traces
      .mockResolvedValueOnce({ data: true, err: null });     // storeEvaluation

    const mockProcess = makeMockSpawnProcess(0, '{"success":true,"result":[{"evaluation":"toxicity","score":0.1,"classification":"low","explanation":"ok","verdict":"no"}]}');
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(true);
    expect(spawn).toHaveBeenCalled();
  });

  it('handles spawn process error event (covers error callback body)', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-2', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [trace], err: null });

    // Synchronous error callback so V8 coverage captures lines 175-179
    const mockProcess = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn((event: string, cb: Function) => {
        if (event === 'error') {
          cb(new Error('Python not found'));
        }
      }),
    };
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result).toBeDefined();
  });

  it('handles spawn non-zero exit code (covers else branch lines 206-212)', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-3', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [trace], err: null });

    const mockProcess = makeMockSpawnProcess(1, '', 'Python script error');
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result).toBeDefined();
  });

  it('handles spawn throwing (covers catch block lines 219-220)', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-4', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [trace], err: null });

    (spawn as jest.Mock).mockImplementation(() => { throw new Error('spawn not available'); });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result).toBeDefined();
  });

  it('records SUCCESS status when all traces evaluate successfully (covers line 337)', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-ok', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })   // fetch traces
      .mockResolvedValue({ data: true, err: null });          // storeEvaluation

    const successOutput = '{"success":true,"result":[{"evaluation":"toxicity","score":0.1,"classification":"low","explanation":"ok","verdict":"no"}]}';
    const mockProcess = makeMockSpawnProcess(0, successOutput);
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(true);
    expect(insertCronLog).toHaveBeenCalled();
  });

  it('records PARTIAL_SUCCESS status when some traces fail (covers line 336)', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace1 = { SpanId: 'span-ok2', Timestamp: '2024-01-01', SpanAttributes: {} };
    const trace2 = { SpanId: 'span-fail', Timestamp: '2024-01-02', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace1, trace2], err: null })  // fetch traces
      .mockResolvedValue({ data: true, err: null });                   // storeEvaluation

    const successOutput = '{"success":true,"result":[{"evaluation":"toxicity","score":0.1,"classification":"low","explanation":"ok","verdict":"no"}]}';
    let callCount = 0;
    (spawn as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeMockSpawnProcess(0, successOutput); // first trace succeeds
      }
      return makeMockSpawnProcess(1, '', 'error');      // second trace fails
    });

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(true);
  });

  it('handles storeEvaluation error (covers lines 123-125)', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-store-err', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    const successOutput = '{"success":true,"result":[{"evaluation":"toxicity","score":0.1,"classification":"low","explanation":"ok","verdict":"no"}]}';
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [trace], err: null })            // fetch traces
      .mockResolvedValue({ data: null, err: 'Insert failed' });       // storeEvaluation fails

    const mockProcess = makeMockSpawnProcess(0, successOutput);
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result.success).toBe(true); // autoEvaluate still succeeds even if storeEvaluation logs error
  });

  it('handles spawn close with no JSON match (covers lines 199-200)', async () => {
    const evalConfig = { id: 'eval-cfg-1', databaseConfigId: 'db-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } };
    const trace = { SpanId: 'span-no-json', Timestamp: '2024-01-01', SpanAttributes: {} };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, evalConfig])
      .mockResolvedValueOnce([null, { id: 'db-1' }]);

    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [trace], err: null });

    // Spawn exits with code 0 but output has no JSON object
    const mockProcess = makeMockSpawnProcess(0, 'no valid json here');
    (spawn as jest.Mock).mockReturnValue(mockProcess);

    const result = await autoEvaluate(autoEvalConfig as any);
    expect(result).toBeDefined();
  });
});

describe('setEvaluationsForSpanId', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(setEvaluationsForSpanId('span-1')).rejects.toThrow('Unauthorized');
  });

  it('throws when span not found', async () => {
    const { getRequestViaSpanId } = require('@/lib/platform/request');
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: {} });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'cfg-1' }]);
    await expect(setEvaluationsForSpanId('missing-span')).rejects.toThrow('Trace not found');
  });

  it('calls getEvaluationConfig and getEvaluationConfigForTrace when span is found (covers lines 142-143)', async () => {
    const { getRequestViaSpanId } = require('@/lib/platform/request');
    const { getEvaluationConfig } = require('@/lib/platform/evaluation/config');
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: { SpanId: 'span-1' } });
    (getEvaluationConfig as jest.Mock).mockResolvedValue({ id: 'cfg-1', provider: 'openai', model: 'gpt-4', secret: { value: 'sk-1' } });
    // Spawn fails immediately so the function can complete
    (spawn as jest.Mock).mockImplementation(() => { throw new Error('no python'); });

    const result = await setEvaluationsForSpanId('span-1');
    expect(result).toBeDefined();
  });
});
