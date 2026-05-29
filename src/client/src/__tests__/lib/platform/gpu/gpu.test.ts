jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn().mockResolvedValue({ data: [] }),
  OTEL_GPUS_TABLE_NAME: 'otel_metrics_gauge',
}));

import { getAverageUtilization, getUtilizationParamsPerTime } from '@/lib/platform/gpu/utilization';
import { getAveragePowerDraw, getPowerParamsPerTime } from '@/lib/platform/gpu/power';
import { getMemoryParamsPerTime, getAverageMemoryUsage } from '@/lib/platform/gpu/memory';
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

describe('GPU utilization', () => {
  it('getAverageUtilization calls dataCollector with utilization query', async () => {
    const result = await getAverageUtilization(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('utilization');
    expect(query).toContain('otel_metrics_gauge');
    expect(result).toEqual({ data: [] });
  });

  it('getUtilizationParamsPerTime calls dataCollector with time-series query', async () => {
    await getUtilizationParamsPerTime(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('request_time');
    expect(query).toContain('GROUP BY');
  });
});

describe('GPU power', () => {
  it('getAveragePowerDraw calls dataCollector with power query', async () => {
    await getAveragePowerDraw(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('power_draw');
    expect(query).toContain('gpu.power.draw');
  });

  it('getPowerParamsPerTime calls dataCollector with time-series query', async () => {
    await getPowerParamsPerTime(baseParams);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('power_draw');
    expect(query).toContain('power_limit');
    expect(query).toContain('request_time');
  });
});

describe('GPU memory', () => {
  it('getAverageMemoryUsage calls dataCollector with memory query', async () => {
    await getAverageMemoryUsage(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('memory_used');
    expect(query).toContain('gpu.memory.used');
  });

  it('getMemoryParamsPerTime calls dataCollector with time-series memory query', async () => {
    await getMemoryParamsPerTime(baseParams);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('memory_available');
    expect(query).toContain('memory_total');
    expect(query).toContain('memory_used');
    expect(query).toContain('memory_free');
    expect(query).toContain('request_time');
  });
});
