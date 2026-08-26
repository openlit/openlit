jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn().mockResolvedValue({ data: [] }),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
}));
// Isolate the built-in ClickHouse SQL path: the external-source router pulls in
// the telemetry-source/next-auth chain (ESM `jose`) which Jest cannot parse.
// Returning null routes every helper to the built-in SQL branch under test.
jest.mock('@/lib/platform/llm/external', () => ({
  externalTotalCost: jest.fn().mockResolvedValue(null),
  externalAverageCost: jest.fn().mockResolvedValue(null),
  externalCostPerTime: jest.fn().mockResolvedValue(null),
  externalAverageTokens: jest.fn().mockResolvedValue(null),
  externalTokensPerTime: jest.fn().mockResolvedValue(null),
  externalGenerationByCategories: jest.fn().mockResolvedValue(null),
  externalGenerationByProvider: jest.fn().mockResolvedValue(null),
  externalTopModels: jest.fn().mockResolvedValue(null),
  externalCostByApplication: jest.fn().mockResolvedValue(null),
  externalCostByEnvironment: jest.fn().mockResolvedValue(null),
  externalModelsPerTime: jest.fn().mockResolvedValue(null),
}));

import { getResultGenerationByCategories } from '@/lib/platform/llm/category';
import { dataCollector } from '@/lib/platform/common';

const baseParams = {
  timeLimit: { start: '2024-01-01', end: '2024-01-31', type: '1M' },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getResultGenerationByCategories', () => {
  it('calls dataCollector and returns result', async () => {
    const result = await getResultGenerationByCategories(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: [] });
  });

  it('query contains category and GROUP BY', async () => {
    await getResultGenerationByCategories(baseParams);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('category');
    expect(query).toContain('GROUP BY');
    expect(query).toContain('otel_traces');
  });
});
