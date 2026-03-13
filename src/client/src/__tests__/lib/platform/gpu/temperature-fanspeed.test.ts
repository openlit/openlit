jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn().mockResolvedValue({ data: [] }),
  OTEL_GPUS_TABLE_NAME: 'otel_metrics_gauge',
}));

import { getAverageTemperature, getAverageTemperatureParamsPerTime } from '@/lib/platform/gpu/temperature';
import { getFanspeedParamsPerTime } from '@/lib/platform/gpu/fanspeed';
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

describe('GPU temperature', () => {
  it('getAverageTemperature calls dataCollector with temperature query', async () => {
    const result = await getAverageTemperature(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('temperature');
    expect(query).toContain('gpu.temperature');
    expect(result).toEqual({ data: [] });
  });

  it('getAverageTemperatureParamsPerTime calls dataCollector with time-series query', async () => {
    await getAverageTemperatureParamsPerTime(baseParams);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('temperature');
    expect(query).toContain('request_time');
    expect(query).toContain('ORDER BY');
  });
});

describe('GPU fan speed', () => {
  it('getFanspeedParamsPerTime calls dataCollector with fan speed query', async () => {
    const result = await getFanspeedParamsPerTime(baseParams);
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain('fan_speed');
    expect(query).toContain('gpu.fan_speed');
    expect(query).toContain('request_time');
    expect(result).toEqual({ data: [] });
  });
});
