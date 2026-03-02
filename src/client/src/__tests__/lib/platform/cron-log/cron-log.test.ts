jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
}));
jest.mock('@/lib/platform/cron-log/table-details', () => ({
  OPENLIT_CRON_LOG_TABLE_NAME: 'openlit_cron_logs',
}));

import { insertCronLog, getCronLogs, getLastRunCronLogByCronId, getLastFailureCronLogBySpanId } from '@/lib/platform/cron-log/index';
import { dataCollector } from '@/lib/platform/common';

const mockInsertData = { data: null, err: null };

beforeEach(() => {
  jest.clearAllMocks();
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
});

describe('insertCronLog', () => {
  it('calls dataCollector with insert params', async () => {
    (dataCollector as jest.Mock).mockResolvedValue(mockInsertData);
    const data = {
      cronId: 'cron-1',
      cronType: 'evaluation',
      runStatus: 'success',
      meta: {},
      errorStacktrace: {},
      startedAt: new Date('2024-01-01T00:00:00Z'),
      finishedAt: new Date('2024-01-01T00:01:00Z'),
      duration: 60,
    };
    await insertCronLog(data as any, 'db-1');
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const [params, mode] = (dataCollector as jest.Mock).mock.calls[0];
    expect(params.table).toBe('openlit_cron_logs');
    expect(params.values).toHaveLength(1);
    expect(mode).toBe('insert');
  });
});

describe('getCronLogs', () => {
  it('returns data and pagination when no filters', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ total: 3 }], err: null })
      .mockResolvedValueOnce({ data: [{ cronId: 'c1' }], err: null });

    const result = await getCronLogs();
    expect(dataCollector).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual([{ cronId: 'c1' }]);
    expect(result.pagination.total).toBe(3);
  });

  it('adds WHERE conditions when filters provided', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ total: 1 }], err: null })
      .mockResolvedValueOnce({ data: [], err: null });

    await getCronLogs({
      cronId: 'c1',
      cronType: 'evaluation',
      runStatus: 'success' as any,
      page: 2,
      limit: 5,
    });

    const { query: countQuery } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(countQuery).toContain("cron_id = 'c1'");
    expect(countQuery).toContain("cron_type = 'evaluation'");
    expect(countQuery).toContain("run_status = 'success'");
  });

  it('throws when count query errors', async () => {
    (dataCollector as jest.Mock).mockResolvedValueOnce({ data: null, err: 'DB error' });
    await expect(getCronLogs()).rejects.toBe('DB error');
  });

  it('throws when logs query errors', async () => {
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [{ total: 1 }], err: null })
      .mockResolvedValueOnce({ data: null, err: 'Logs error' });
    await expect(getCronLogs()).rejects.toBe('Logs error');
  });
});

describe('getLastRunCronLogByCronId', () => {
  it('returns startedAt when a successful run exists', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({
      data: [{ startedAt: new Date('2024-01-15') }],
      err: null,
    });
    const result = await getLastRunCronLogByCronId('cron-1');
    expect(result).toEqual(new Date('2024-01-15'));
  });

  it('returns null when data is null', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: null });
    const result = await getLastRunCronLogByCronId('cron-1');
    expect(result).toBeNull();
  });

  it('returns null when error', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: 'err' });
    const result = await getLastRunCronLogByCronId('cron-1');
    expect(result).toBeNull();
  });
});

describe('getLastFailureCronLogBySpanId', () => {
  it('calls dataCollector with spanId query', async () => {
    await getLastFailureCronLogBySpanId('span-1');
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('span-1');
    expect(query).toContain('FAILURE');
  });
});
