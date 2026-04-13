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
      provider: 'gen_ai.system',
      promptTokens: 'gen_ai.usage.input_tokens',
      completionTokens: 'gen_ai.usage.output_tokens',
      type: 'gen_ai.operation.name',
    };
    return map[key] || key;
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
  getDBConfigById: jest.fn(),
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
import { getDBConfigById } from '@/lib/db-config';
import { insertCronLog } from '@/lib/platform/cron-log';
import getMessage from '@/constants/messages';
import { throwIfError } from '@/utils/error';
import asaw from '@/utils/asaw';

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

  // Re-apply insertCronLog mock
  (insertCronLog as jest.Mock).mockResolvedValue({ err: null });

  // Re-apply prisma mock for setPricingForSpanId's dynamic import
  const prisma = require('@/lib/prisma').default;
  prisma.pricingConfigs.findFirst.mockResolvedValue({ databaseConfigId: 'db-1' });
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

  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);

    await expect(setPricingForSpanId('span-1')).rejects.toThrow('Unauthorized');
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

  it('returns error when pricing config not found', async () => {
    (getPricingConfigById as jest.Mock).mockResolvedValue(null);

    const result = await autoUpdatePricing({
      pricingConfigId: 'nonexistent',
      cronId: 'cron-1',
    });

    expect(result.success).toBe(false);
    expect(result.err).toContain('not found');
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
});
