jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn().mockResolvedValue({ data: [] }),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
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
