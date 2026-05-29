jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn().mockResolvedValue({ data: [] }),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
}));

import { getTopModels, getModelsPerTime } from '@/lib/platform/llm/model';
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
});

describe('getTopModels', () => {
  it('calls dataCollector with LIMIT and GROUP BY model', async () => {
    await getTopModels({ ...baseParams, top: 5 });
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('model_count');
    expect(query).toContain('GROUP BY');
    expect(query).toContain('LIMIT 5');
  });

  it('respects top parameter', async () => {
    await getTopModels({ ...baseParams, top: 10 });
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('LIMIT 10');
  });
});

describe('getModelsPerTime', () => {
  it('calls dataCollector with time-series model query', async () => {
    await getModelsPerTime(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('models');
    expect(query).toContain('model_counts');
    expect(query).toContain('request_time');
    expect(query).toContain('GROUP BY');
  });
});
