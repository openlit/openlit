jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
}));

import {
  getRequestPerTime,
  getTotalRequests,
  getAverageRequestDuration,
  getRequestsConfig,
  getRequests,
  getRequestViaSpanId,
  getRequestViaTraceId,
  getHeirarchyViaSpanId,
  getRequestExist,
  getAttributeKeys,
} from '@/lib/platform/request/index';
import { dataCollector } from '@/lib/platform/common';

const baseParams = {
  timeLimit: {
    start: new Date('2024-01-01'),
    end: new Date('2024-01-31'),
    type: '1M',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
});

describe('getRequestPerTime', () => {
  it('calls dataCollector with time-series request query', async () => {
    await getRequestPerTime(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('total');
    expect(query).toContain('request_time');
    expect(query).toContain('GROUP BY');
  });
});

describe('getTotalRequests', () => {
  it('builds JOIN query for current/previous comparison', async () => {
    await getTotalRequests(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('total_requests');
    expect(query).toContain('JOIN');
    expect(query).toContain('previous_total_requests');
  });
});

describe('getAverageRequestDuration', () => {
  it('builds JOIN query for duration comparison', async () => {
    await getAverageRequestDuration(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('average_duration');
    expect(query).toContain('JOIN');
    expect(query).toContain('previous_average_duration');
  });
});

describe('getRequestsConfig', () => {
  it('queries providers, models, traceTypes, applicationNames, environments', async () => {
    await getRequestsConfig(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('providers');
    expect(query).toContain('models');
    expect(query).toContain('totalRows');
  });
});

describe('getRequests', () => {
  it('calls dataCollector twice (count + data) and returns records', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ total: 42 }], err: null })
      .mockResolvedValueOnce({ data: [{ SpanId: 'abc' }], err: null });

    const result = await getRequests({ ...baseParams, limit: 10, offset: 0 });
    expect(dataCollector).toHaveBeenCalledTimes(2);
    expect(result.total).toBe(42);
    expect(result.records).toEqual([{ SpanId: 'abc' }]);
  });

  it('returns err when count query fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: null, err: 'DB error' });
    const result = await getRequests(baseParams);
    expect(result.err).toBe('DB error');
  });

  it('applies sorting when provided', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ total: 5 }], err: null })
      .mockResolvedValueOnce({ data: [], err: null });

    await getRequests({
      ...baseParams,
      sorting: { type: 'Timestamp', direction: 'ASC' },
    });
    const { query } = (dataCollector as jest.Mock).mock.calls[1][0];
    expect(query).toContain('ORDER BY Timestamp ASC');
  });

  it('applies toFloat64OrZero ORDER BY for cost sorting', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ total: 5 }], err: null })
      .mockResolvedValueOnce({ data: [], err: null });

    await getRequests({
      ...baseParams,
      sorting: { type: 'gen_ai.usage.cost', direction: 'DESC' },
    });
    const { query } = (dataCollector as jest.Mock).mock.calls[1][0];
    expect(query).toContain('toFloat64OrZero(gen_ai.usage.cost)');
  });

  it('applies toInt32OrZero ORDER BY for tokens sorting', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ total: 5 }], err: null })
      .mockResolvedValueOnce({ data: [], err: null });

    await getRequests({
      ...baseParams,
      sorting: { type: 'gen_ai.usage.prompt_tokens', direction: 'ASC' },
    });
    const { query } = (dataCollector as jest.Mock).mock.calls[1][0];
    expect(query).toContain('toInt32OrZero(gen_ai.usage.prompt_tokens)');
  });
});

describe('getRequestViaSpanId', () => {
  it('queries by SpanId and returns record', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [{ SpanId: 'span-1', SpanName: 'test' }],
      err: null,
    });
    const result = await getRequestViaSpanId('span-1');
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain("SpanId='span-1'");
    expect(result.record).toEqual({ SpanId: 'span-1', SpanName: 'test' });
  });
});

describe('getRequestViaTraceId', () => {
  it('queries by TraceId and returns record', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [{ TraceId: 'trace-1' }],
      err: null,
    });
    const result = await getRequestViaTraceId('trace-1');
    expect(result.record).toEqual({ TraceId: 'trace-1' });
  });
});

describe('getHeirarchyViaSpanId', () => {
  it('returns error when span not found (traceId query returns empty)', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    const result = await getHeirarchyViaSpanId('span-1');
    expect(result.err).toBe('Span not found');
  });

  it('fetches all spans by traceId and builds hierarchy', async () => {
    const rootSpan = { SpanId: 'root-span', ParentSpanId: '', TraceId: 't1' };
    const childSpan = { SpanId: 'child-span', ParentSpanId: 'root-span', TraceId: 't1' };

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ TraceId: 't1' }], err: null })   // step 1: get traceId
      .mockResolvedValueOnce({ data: [rootSpan, childSpan], err: null }); // step 2: get all spans

    const result = await getHeirarchyViaSpanId('child-span');
    expect(dataCollector).toHaveBeenCalledTimes(2);
    expect(result.err).toBeNull();
    expect(result.record).toBeDefined();
  });

  it('returns error when all-spans query fails', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ TraceId: 't1' }], err: null })
      .mockResolvedValueOnce({ data: [], err: 'DB error' });

    const result = await getHeirarchyViaSpanId('child-span');
    expect(dataCollector).toHaveBeenCalledTimes(2);
    expect(result.err).toBeTruthy();
  });
});

describe('getRequestExist', () => {
  it('calls dataCollector with total count query', async () => {
    await getRequestExist();
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('total_requests');
    expect(query).toContain('otel_traces');
  });
});

describe('getAttributeKeys', () => {
  it('returns spanAttributeKeys and resourceAttributeKeys on success', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ key: 'gen_ai.system' }, { key: 'gen_ai.request.model' }], err: null })
      .mockResolvedValueOnce({ data: [{ key: 'service.name' }], err: null });

    const result = await getAttributeKeys(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(2);
    expect(result.spanAttributeKeys).toEqual(['gen_ai.system', 'gen_ai.request.model']);
    expect(result.resourceAttributeKeys).toEqual(['service.name']);
    expect(result.err).toBeNull();
  });

  it('returns empty arrays when data is null', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: null, err: null })
      .mockResolvedValueOnce({ data: null, err: null });

    const result = await getAttributeKeys(baseParams);
    expect(result.spanAttributeKeys).toEqual([]);
    expect(result.resourceAttributeKeys).toEqual([]);
  });

  it('propagates error from span query', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: null, err: 'span error' })
      .mockResolvedValueOnce({ data: [], err: null });

    const result = await getAttributeKeys(baseParams);
    expect(result.err).toBe('span error');
  });

  it('queries use DISTINCT arrayJoin(mapKeys(...))', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [], err: null })
      .mockResolvedValueOnce({ data: [], err: null });

    await getAttributeKeys(baseParams);
    const [call1, call2] = (dataCollector as jest.Mock).mock.calls;
    expect(call1[0].query).toContain('SpanAttributes');
    expect(call2[0].query).toContain('ResourceAttributes');
  });
});
