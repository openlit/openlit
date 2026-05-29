jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn().mockResolvedValue({ data: [] }),
  OTEL_TRACES_TABLE_NAME: 'otel_traces',
}));

import { getResultGenerationByApplication } from '@/lib/platform/vector/application';
import { getResultGenerationByEnvironment } from '@/lib/platform/vector/environment';
import { getResultGenerationByOperation } from '@/lib/platform/vector/operation';
import { getResultGenerationBySystem } from '@/lib/platform/vector/system';
import { dataCollector } from '@/lib/platform/common';

const baseParams = {
  timeLimit: { start: '2024-01-01', end: '2024-01-31', type: '1M' },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getResultGenerationByApplication', () => {
  it('calls dataCollector with applicationName GROUP BY query', async () => {
    const result = await getResultGenerationByApplication(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('applicationName');
    expect(query).toContain('GROUP BY');
    expect(query).toContain('otel_traces');
    expect(result).toEqual({ data: [] });
  });
});

describe('getResultGenerationByEnvironment', () => {
  it('calls dataCollector with environment GROUP BY query', async () => {
    await getResultGenerationByEnvironment(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('environment');
    expect(query).toContain('GROUP BY');
  });
});

describe('getResultGenerationByOperation', () => {
  it('calls dataCollector with operation GROUP BY query', async () => {
    await getResultGenerationByOperation(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('operation');
    expect(query).toContain('GROUP BY');
  });
});

describe('getResultGenerationBySystem', () => {
  it('calls dataCollector with system GROUP BY query', async () => {
    await getResultGenerationBySystem(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('system');
    expect(query).toContain('GROUP BY');
  });
});
