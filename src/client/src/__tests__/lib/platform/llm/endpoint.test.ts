jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn().mockResolvedValue({ data: [] }),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
}));

import { getResultGenerationByEndpoint } from '@/lib/platform/llm/endpoint';
import { dataCollector } from '@/lib/platform/common';

const baseParams = {
  timeLimit: { start: '2024-01-01', end: '2024-01-31', type: '1M' },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getResultGenerationByEndpoint', () => {
  it('calls dataCollector and returns result', async () => {
    const result = await getResultGenerationByEndpoint(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: [] });
  });

  it('query contains provider and GROUP BY', async () => {
    await getResultGenerationByEndpoint(baseParams);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('provider');
    expect(query).toContain('GROUP BY');
    expect(query).toContain('otel_traces');
  });
});
