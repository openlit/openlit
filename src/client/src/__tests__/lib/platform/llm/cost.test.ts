jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn().mockResolvedValue({ data: [] }),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
}));

import { getTotalCost, getAverageCost, getCostByApplication, getCostByEnvironment } from '@/lib/platform/llm/cost';
import { dataCollector } from '@/lib/platform/common';

const baseParams = {
  timeLimit: { start: '2024-01-01', end: '2024-01-31', type: '1M' },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getTotalCost', () => {
  it('calls dataCollector and returns result', async () => {
    const result = await getTotalCost(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('total_usage_cost');
    expect(query).toContain('otel_traces');
    expect(result).toEqual({ data: [] });
  });

  it('query includes JOIN for current/previous comparison', async () => {
    await getTotalCost(baseParams);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('JOIN');
    expect(query).toContain('previous_total_usage_cost');
  });
});

describe('getAverageCost', () => {
  it('calls dataCollector with average query', async () => {
    await getAverageCost(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('average_usage_cost');
    expect(query).toContain('JOIN');
  });
});

describe('getCostByApplication', () => {
  it('calls dataCollector with GROUP BY applicationName', async () => {
    await getCostByApplication(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('applicationName');
    expect(query).toContain('GROUP BY');
  });
});

describe('getCostByEnvironment', () => {
  it('calls dataCollector with GROUP BY environment', async () => {
    await getCostByEnvironment(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('environment');
    expect(query).toContain('GROUP BY');
  });
});
