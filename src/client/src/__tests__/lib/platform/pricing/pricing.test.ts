jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
    TRACE_NOT_FOUND: 'Trace not found',
    DATABASE_CONFIG_NOT_FOUND: 'DB config not found',
    TRACE_FETCHING_ERROR: 'Trace fetching error',
  })),
}));
jest.mock('@/lib/session', () => ({
  getCurrentUser: jest.fn(),
}));
jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
}));
jest.mock('@/lib/platform/request', () => ({
  getRequestViaSpanId: jest.fn(),
}));
jest.mock('@/lib/platform/traces/read', () => ({
  getTraceSpanRecord: (...args: unknown[]) =>
    require('@/lib/platform/request').getRequestViaSpanId(...args),
}));
jest.mock('@/lib/telemetry-source', () => ({
  resolveTelemetrySourceDescriptor: jest.fn().mockResolvedValue({
    type: 'clickhouse',
    id: 'builtin:test',
    isBuiltIn: true,
  }),
  getTelemetryAdapterForDbConfig: jest.fn().mockResolvedValue({
    isBuiltIn: true,
    descriptor: { type: 'clickhouse', isBuiltIn: true },
    adapter: {},
  }),
}));
jest.mock('@/lib/platform/providers/provider-registry', () => ({
  ProviderRegistry: {
    getModel: jest.fn(),
  },
}));
jest.mock('@/helpers/server/trace', () => ({
  getTraceMappingKeyFullPath: jest.fn((key: string) => {
    const map: Record<string, string> = {
      cost: 'gen_ai.usage.cost',
      model: 'gen_ai.request.model',
      provider: 'gen_ai.provider.name',
      promptTokens: 'gen_ai.usage.input_tokens',
      completionTokens: 'gen_ai.usage.output_tokens',
      type: 'gen_ai.operation.name',
    };
    return map[key] || key;
  }),
  getTraceMappingKeyFullPaths: jest.fn((key: string) => {
    const map: Record<string, string[]> = {
      provider: ['gen_ai.provider.name', 'gen_ai.system'],
      promptTokens: ['gen_ai.usage.input_tokens', 'input_tokens', 'prompt_tokens'],
      completionTokens: ['gen_ai.usage.output_tokens', 'output_tokens', 'completion_tokens'],
    };
    return map[key] || [key];
  }),
}));
jest.mock('@/constants/traces', () => ({
  SUPPORTED_EVALUATION_OPERATIONS: ['chat'],
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: { sanitizeValue: jest.fn((v: string) => v) },
}));
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  }),
}));
jest.mock('@/utils/asaw', () => jest.fn());
jest.mock('@/lib/platform/pricing/config', () => ({
  getPricingConfigById: jest.fn(),
}));
jest.mock('@/lib/platform/cron-log', () => ({
  getLastRunCronLogByCronId: jest.fn().mockResolvedValue(null),
  insertCronLog: jest.fn().mockResolvedValue({ err: null }),
}));
jest.mock('@/lib/db-config', () => ({
  getDBConfigByIdInternal: jest.fn(),
  getDBConfigByUser: jest.fn(),
}));
jest.mock('date-fns', () => ({
  differenceInSeconds: jest.fn(() => 1),
}));
// Mock dynamic import of prisma used inside setPricingForSpanId
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    pricingConfigs: {
      findFirst: jest.fn().mockResolvedValue({ databaseConfigId: 'db-1' }),
    },
  },
}));

import { setPricingForSpanId, autoUpdatePricing } from '@/lib/platform/pricing';
import { getCurrentUser } from '@/lib/session';
import { dataCollector } from '@/lib/platform/common';
import { getRequestViaSpanId } from '@/lib/platform/request';
import { ProviderRegistry } from '@/lib/platform/providers/provider-registry';
import { getPricingConfigById } from '@/lib/platform/pricing/config';
import { insertCronLog } from '@/lib/platform/cron-log';
import getMessage from '@/constants/messages';
import { throwIfError } from '@/utils/error';
import asaw from '@/utils/asaw';
import Sanitizer from '@/utils/sanitizer';

beforeEach(() => {
  jest.resetAllMocks();

  (getMessage as jest.Mock).mockReturnValue({
    UNAUTHORIZED_USER: 'Unauthorized',
    TRACE_NOT_FOUND: 'Trace not found',
    DATABASE_CONFIG_NOT_FOUND: 'DB config not found',
    TRACE_FETCHING_ERROR: 'Trace fetching error',
  });

  (throwIfError as jest.Mock).mockImplementation((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  });

  // Re-apply Sanitizer mock after resetAllMocks (aliased module factory
  // implementations do not survive a reset, unlike e.g. the `lodash` mock).
  (Sanitizer.sanitizeValue as jest.Mock).mockImplementation((v: string) => v);

  // Re-apply insertCronLog mock
  (insertCronLog as jest.Mock).mockResolvedValue({ err: null });

  // Re-apply prisma mock for setPricingForSpanId's dynamic import
  const prisma = require('@/lib/prisma').default;
  prisma.pricingConfigs.findFirst.mockResolvedValue({ databaseConfigId: 'db-1' });

  const { resolveTelemetrySourceDescriptor, getTelemetryAdapterForDbConfig } = require('@/lib/telemetry-source');
  (resolveTelemetrySourceDescriptor as jest.Mock).mockResolvedValue({
    type: 'clickhouse',
    id: 'builtin:test',
    isBuiltIn: true,
  });
  (getTelemetryAdapterForDbConfig as jest.Mock).mockResolvedValue({
    isBuiltIn: true,
    descriptor: { type: 'clickhouse', isBuiltIn: true },
    adapter: {},
  });
});

describe('setPricingForSpanId', () => {
  const mockTrace = {
    SpanId: 'span-1',
    Timestamp: '2026-01-01',
    SpanAttributes: {
      'gen_ai.system': 'openai',
      'gen_ai.request.model': 'gpt-4o',
      'gen_ai.usage.input_tokens': '100',
      'gen_ai.usage.output_tokens': '200',
    },
  };

  it('computes and writes cost successfully', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: mockTrace });
    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.cost).toBeCloseTo(
      (100 / 1_000_000) * 2.5 + (200 / 1_000_000) * 10.0
    );
    // Should call ALTER TABLE to update the trace
    expect(dataCollector).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('mapUpdate'),
      }),
      'exec',
      expect.any(String)
    );
  });

  it('computes cost from direct input and output token attributes', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({
      record: {
        SpanId: 'span-1',
        Timestamp: '2026-01-01',
        SpanAttributes: {
          'gen_ai.system': 'openai',
          'gen_ai.request.model': 'gpt-4o',
          input_tokens: '300',
          output_tokens: '400',
        },
      },
    });
    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(true);
    expect(result.data!.cost).toBeCloseTo(
      (300 / 1_000_000) * 2.5 + (400 / 1_000_000) * 10.0
    );
  });

  it('keeps canonical gen_ai token attributes ahead of direct fallback keys', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({
      record: {
        SpanId: 'span-1',
        Timestamp: '2026-01-01',
        SpanAttributes: {
          'gen_ai.system': 'openai',
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.usage.input_tokens': '100',
          'gen_ai.usage.output_tokens': '200',
          input_tokens: '300',
          output_tokens: '400',
        },
      },
    });
    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(true);
    expect(result.data!.cost).toBeCloseTo(
      (100 / 1_000_000) * 2.5 + (200 / 1_000_000) * 10.0
    );
  });

  it('returns error when model not found', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: mockTrace });
    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue(null);

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(false);
    expect(result.err).toContain('not found');
  });

  it('returns error when trace has no provider', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({
      record: {
        SpanId: 'span-1',
        Timestamp: '2026-01-01',
        SpanAttributes: {},
      },
    });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(false);
    expect(result.err).toContain('Missing');
  });

  it('returns error mentioning only "model" when provider is present but model is missing', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({
      record: {
        SpanId: 'span-1',
        Timestamp: '2026-01-01',
        SpanAttributes: { 'gen_ai.system': 'openai' },
      },
    });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(false);
    expect(result.err).toContain('Missing model');
    expect(result.err).not.toContain(' and ');
  });

  it('returns error mentioning only "provider" when model is present but provider is missing', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({
      record: {
        SpanId: 'span-1',
        Timestamp: '2026-01-01',
        SpanAttributes: { 'gen_ai.request.model': 'gpt-4o' },
      },
    });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(false);
    expect(result.err).toContain('Missing provider');
    expect(result.err).not.toContain(' and ');
  });

  it('handles a trace whose SpanAttributes object is entirely absent', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({
      record: {
        SpanId: 'span-1',
        Timestamp: '2026-01-01',
      },
    });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(false);
    expect(result.err).toContain('Missing');
    expect(result.err).toContain(' and ');
  });

  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);

    await expect(setPricingForSpanId('span-1')).rejects.toThrow('Unauthorized');
  });

  it('returns error when zero tokens', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({
      record: {
        SpanId: 'span-1',
        Timestamp: '2026-01-01',
        SpanAttributes: {
          'gen_ai.system': 'openai',
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.usage.input_tokens': '0',
          'gen_ai.usage.output_tokens': '0',
        },
      },
    });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(false);
    expect(result.err).toContain('zero tokens');
  });

  it('returns error when writeCostToTrace fails', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: mockTrace });
    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'write failed' });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(false);
    expect(result.err).toBe('write failed');
  });

  it('returns DB config not found when no config + no fallback', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: mockTrace });
    const prisma = require('@/lib/prisma').default;
    prisma.pricingConfigs.findFirst.mockResolvedValue(null);
    // The fallback uses asaw(getDBConfigByUser(true)) — return null dbConfig
    (asaw as jest.Mock).mockResolvedValue([null, null]);

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(false);
    expect(result.err).toBe('DB config not found');
  });

  it('falls back to the user default DB config when no pricing config row exists', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: mockTrace });
    const prisma = require('@/lib/prisma').default;
    prisma.pricingConfigs.findFirst.mockResolvedValue(null);
    // The fallback uses asaw(getDBConfigByUser(true)) — return a real dbConfig
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'fallback-db' }]);
    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(true);
    expect(ProviderRegistry.getModel).toHaveBeenCalledWith(
      'openai',
      'gpt-4o',
      'fallback-db'
    );
  });

  it('passes environment and traceId from opts through to the routed lookup and logging', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: mockTrace });
    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });

    const result = await setPricingForSpanId('span-1', {
      environment: 'prod',
      traceId: 'trace-99',
    });

    expect(result.success).toBe(true);
    const { resolveTelemetrySourceDescriptor } = require('@/lib/telemetry-source');
    expect(resolveTelemetrySourceDescriptor).toHaveBeenCalledWith(
      expect.objectContaining({ signal: 'traces', environment: 'prod' })
    );
    expect(getRequestViaSpanId).toHaveBeenCalledWith(
      'span-1',
      expect.objectContaining({ environment: 'prod', traceId: 'trace-99' })
    );
  });

  it('reports the cost as unpersisted when routed to a non-clickhouse, non-builtin connector', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (getRequestViaSpanId as jest.Mock).mockResolvedValue({ record: mockTrace });
    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });
    const { resolveTelemetrySourceDescriptor } = require('@/lib/telemetry-source');
    (resolveTelemetrySourceDescriptor as jest.Mock).mockResolvedValue({
      type: 'jaeger',
      id: 'src-1',
      isBuiltIn: false,
    });

    const result = await setPricingForSpanId('span-1');

    expect(result.success).toBe(true);
    expect(result.data!.persisted).toBe(false);
    expect(result.message).toContain('jaeger');
    // Read-only external connector: no ALTER TABLE / exec write
    expect(dataCollector).not.toHaveBeenCalled();
  });
});

describe('autoUpdatePricing', () => {
  it('processes traces and writes costs', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock)
      // First call: SELECT traces
      .mockResolvedValueOnce({
        data: [
          {
            SpanId: 'span-1',
            Timestamp: '2026-01-01',
            SpanAttributes: {
              'gen_ai.system': 'openai',
              'gen_ai.request.model': 'gpt-4o',
              'gen_ai.usage.input_tokens': '100',
              'gen_ai.usage.output_tokens': '200',
            },
          },
        ],
      })
      // Second call: ALTER TABLE UPDATE
      .mockResolvedValueOnce({ err: null });

    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(true);
    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ totalUpdated: 1 }),
      }),
      'db-1'
    );
  });

  it('auto pricing supports direct token attributes', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({
        data: [
          {
            SpanId: 'span-1',
            Timestamp: '2026-01-01',
            SpanAttributes: {
              'gen_ai.system': 'openai',
              'gen_ai.request.model': 'gpt-4o',
              input_tokens: '100',
              output_tokens: '200',
            },
          },
        ],
      })
      .mockResolvedValueOnce({ err: null });

    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(true);
    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ totalUpdated: 1 }),
      }),
      'db-1'
    );
  });

  it('returns error when pricing config not found', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue(null);

    const result = await autoUpdatePricing({
      pricingConfigId: 'nonexistent',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(false);
    expect(result.err).toContain('not found');
  });

  it('returns error when DB config not found', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-missing',
    });
    (asaw as jest.Mock).mockResolvedValue([null, null]);

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(false);
    expect(result.err).toBe('DB config not found');
  });

  it('logs FAILURE on trace fetch error', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValueOnce({ err: 'fetch failed' });

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(false);
    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        runStatus: 'FAILURE',
      }),
      'db-1'
    );
  });

  it('counts errors when writeCostToTrace fails', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({
        data: [
          {
            SpanId: 'span-1',
            Timestamp: '2026-01-01',
            SpanAttributes: {
              'gen_ai.system': 'openai',
              'gen_ai.request.model': 'gpt-4o',
              'gen_ai.usage.input_tokens': '100',
              'gen_ai.usage.output_tokens': '200',
            },
          },
        ],
      })
      .mockResolvedValueOnce({ err: 'write failed' });

    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(true);
    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          totalUpdated: 0,
          totalFailed: 1,
        }),
      }),
      'db-1'
    );
  });

  it('skips traces without provider/model', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          SpanId: 'span-no-model',
          Timestamp: '2026-01-01',
          SpanAttributes: {},
        },
      ],
    });

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(true);
    // No ALTER TABLE calls — trace was skipped
    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ totalSkipped: 1, totalUpdated: 0 }),
      }),
      'db-1'
    );
  });

  it('computes lastRunIso from a Date instance and filters the SQL query by it', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    const { getLastRunCronLogByCronId } = require('@/lib/platform/cron-log');
    (getLastRunCronLogByCronId as jest.Mock).mockResolvedValueOnce(
      new Date('2026-01-01T00:00:00.000Z')
    );
    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [] });

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(true);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain(
      "parseDateTimeBestEffort('2026-01-01T00:00:00.000Z')"
    );
  });

  it('returns an empty trace list when the SELECT query resolves with no data and no error', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: undefined, err: null });

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(true);
    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ totalSpans: 0 }),
      }),
      'db-1'
    );
  });

  it('records a caught error from fetchAutoPricingCandidateSpans when the routed connector lookup throws', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    const { getTelemetryAdapterForDbConfig } = require('@/lib/telemetry-source');
    (getTelemetryAdapterForDbConfig as jest.Mock).mockRejectedValueOnce(
      new Error('adapter unavailable')
    );

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(false);
    expect(result.err).toContain('adapter unavailable');
    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({ runStatus: 'FAILURE' }),
      'db-1'
    );
  });

  it('counts an exception thrown while computing/writing cost as an error and still marks partial success', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          SpanId: 'span-throws',
          Timestamp: '2026-01-01',
          SpanAttributes: {
            'gen_ai.system': 'openai',
            'gen_ai.request.model': 'gpt-4o',
            'gen_ai.usage.input_tokens': '100',
            'gen_ai.usage.output_tokens': '200',
          },
        },
        {
          SpanId: 'span-ok',
          Timestamp: '2026-01-01',
          SpanAttributes: {
            'gen_ai.system': 'openai',
            'gen_ai.request.model': 'gpt-4o',
            'gen_ai.usage.input_tokens': '100',
            'gen_ai.usage.output_tokens': '200',
          },
        },
      ],
    });
    (dataCollector as jest.Mock).mockResolvedValueOnce({ err: null }); // ALTER for span-ok

    (ProviderRegistry.getModel as jest.Mock)
      .mockRejectedValueOnce(new Error('model lookup failed'))
      .mockResolvedValueOnce({
        id: 'gpt-4o',
        inputPricePerMToken: 2.5,
        outputPricePerMToken: 10.0,
      });

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(true);
    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        runStatus: 'PARTIAL_SUCCESS',
        errorStacktrace: expect.objectContaining({
          'span-throws': 'model lookup failed',
        }),
        meta: expect.objectContaining({ totalUpdated: 1, totalFailed: 1 }),
      }),
      'db-1'
    );
  });

  it('uses lastRunIso (not the 24h default) as the window start for the routed connector', async () => {
    const listSpans = jest.fn().mockResolvedValue({ rows: [] });
    const { getTelemetryAdapterForDbConfig } = require('@/lib/telemetry-source');
    (getTelemetryAdapterForDbConfig as jest.Mock).mockResolvedValue({
      isBuiltIn: false,
      descriptor: { type: 'jaeger', isBuiltIn: false },
      adapter: { listSpans },
    });
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    const { getLastRunCronLogByCronId } = require('@/lib/platform/cron-log');
    (getLastRunCronLogByCronId as jest.Mock).mockResolvedValueOnce(
      '2026-02-01T00:00:00.000Z'
    );

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(true);
    const [{ timeRange }] = listSpans.mock.calls[0];
    expect(timeRange.start).toEqual(new Date('2026-02-01T00:00:00.000Z'));
  });

  it('reads candidates from the routed traces connector and does not write otel_traces', async () => {
    const listSpans = jest.fn().mockResolvedValue({
      rows: [
        {
          spanId: 'jaeger-span',
          timestamp: '2026-01-01',
          spanAttributes: {
            'gen_ai.system': 'openai',
            'gen_ai.request.model': 'gpt-4o',
            'gen_ai.usage.input_tokens': '100',
            'gen_ai.usage.output_tokens': '200',
          },
        },
      ],
    });
    const { getTelemetryAdapterForDbConfig } = require('@/lib/telemetry-source');
    (getTelemetryAdapterForDbConfig as jest.Mock).mockResolvedValue({
      isBuiltIn: false,
      descriptor: { type: 'jaeger', isBuiltIn: false },
      adapter: { listSpans },
    });
    (getPricingConfigById as jest.Mock).mockResolvedValue({
      id: 'pc-1',
      databaseConfigId: 'db-1',
    });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    (ProviderRegistry.getModel as jest.Mock).mockResolvedValue({
      id: 'gpt-4o',
      inputPricePerMToken: 2.5,
      outputPricePerMToken: 10.0,
    });

    const result = await autoUpdatePricing({
      pricingConfigId: 'pc-1',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(true);
    expect(listSpans).toHaveBeenCalled();
    const writes = (dataCollector as jest.Mock).mock.calls.filter(
      ([params, mode]) =>
        mode === 'exec' ||
        (typeof params?.query === 'string' && params.query.includes('ALTER TABLE'))
    );
    expect(writes).toHaveLength(0);
    expect(insertCronLog).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ totalUpdated: 0 }),
      }),
      'db-1'
    );
  });
});
