jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn().mockResolvedValue({ data: [] }),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
}));

import { getAverageTokensPerRequest, getTokensPerTime } from '@/lib/platform/llm/token';
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

describe('getAverageTokensPerRequest', () => {
  it('builds a JOIN query for type=total', async () => {
    await getAverageTokensPerRequest({ ...baseParams, type: 'total' });
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('total_tokens');
    expect(query).toContain('JOIN');
    expect(query).toContain('previous_total_tokens');
  });

  it('builds a simple query for type=prompt', async () => {
    await getAverageTokensPerRequest({ ...baseParams, type: 'prompt' });
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('total_tokens');
    expect(query).not.toContain('JOIN');
  });

  it('builds a simple query for type=completion', async () => {
    await getAverageTokensPerRequest({ ...baseParams, type: 'completion' });
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('total_tokens');
    expect(query).not.toContain('JOIN');
  });
});

describe('getTokensPerTime', () => {
  it('calls dataCollector with time-series token query', async () => {
    await getTokensPerTime(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('totaltokens');
    expect(query).toContain('prompttokens');
    expect(query).toContain('completiontokens');
    expect(query).toContain('GROUP BY');
    expect(query).toContain('request_time');
  });
});
