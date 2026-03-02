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
  it('returns error when no upward data found', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    const result = await getHeirarchyViaSpanId('span-1');
    expect(result.err).toBe('Error in fetching heirarchy');
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
