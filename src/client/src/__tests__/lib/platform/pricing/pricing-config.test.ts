jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    DATABASE_CONFIG_NOT_FOUND: 'DB config not found',
    OPERATION_FAILED: 'Operation failed',
    CRON_JOB_UPDATION_ERROR: 'Cron job error',
  })),
}));
jest.mock('@/lib/db-config', () => ({
  getDBConfigByUser: jest.fn(),
}));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    pricingConfigs: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  },
}));
jest.mock('@/utils/asaw', () => jest.fn());
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  }),
}));
jest.mock('@/helpers/server/cron', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    validateCronSchedule: jest.fn(),
    updateCrontab: jest.fn().mockResolvedValue(undefined),
    deleteCronJob: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('@/utils/json', () => ({
  jsonParse: jest.fn((v: string) => {
    try { return JSON.parse(v); } catch { return {}; }
  }),
  jsonStringify: jest.fn((v: unknown) => JSON.stringify(v)),
}));
jest.mock('lodash', () => ({
  merge: jest.fn((a: any, b: any) => ({ ...a, ...b })),
}));
jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'test-cron-uuid'),
}));
jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
}));

import { getPricingConfig, setPricingConfig, restorePricingCronJobs } from '@/lib/platform/pricing/config';
import { getDBConfigByUser } from '@/lib/db-config';
import prisma from '@/lib/prisma';
import asaw from '@/utils/asaw';
import { throwIfError } from '@/utils/error';
import Cron from '@/helpers/server/cron';
import getMessage from '@/constants/messages';
import { randomUUID } from 'crypto';
import { jsonParse } from '@/utils/json';

const mockDBConfig = { id: 'db-1', name: 'test-db' };

beforeEach(() => {
  jest.resetAllMocks();

  (getMessage as jest.Mock).mockReturnValue({
    DATABASE_CONFIG_NOT_FOUND: 'DB config not found',
    OPERATION_FAILED: 'Operation failed',
    CRON_JOB_UPDATION_ERROR: 'Cron job error',
  });

  (throwIfError as jest.Mock).mockImplementation((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  });

  (randomUUID as jest.Mock).mockReturnValue('test-cron-uuid');

  (Cron as jest.Mock).mockImplementation(() => ({
    validateCronSchedule: jest.fn(),
    updateCrontab: jest.fn().mockResolvedValue(undefined),
    deleteCronJob: jest.fn().mockResolvedValue(undefined),
  }));

  (jsonParse as jest.Mock).mockImplementation((v: string) => {
    try { return JSON.parse(v); } catch { return {}; }
  });

  // Default asaw: wrap a promise into [err, data]
  (asaw as jest.Mock).mockImplementation(async (promise: Promise<any>) => {
    try {
      const data = await promise;
      return [null, data];
    } catch (err) {
      return [err, null];
    }
  });

  // Re-apply path.join mock
  const path = require('path');
  (path.join as jest.Mock).mockImplementation((...args: string[]) => args.join('/'));
});

describe('getPricingConfig', () => {
  it('returns config when it exists', async () => {
    const mockConfig = { id: 'pc-1', auto: false, recurringTime: '', meta: '{}', databaseConfigId: 'db-1' };
    (getDBConfigByUser as jest.Mock).mockResolvedValue(mockDBConfig);
    (prisma.pricingConfigs.findFirst as jest.Mock).mockResolvedValue(mockConfig);

    const result = await getPricingConfig();

    expect(result).toEqual(mockConfig);
  });

  it('returns null when no config exists', async () => {
    (getDBConfigByUser as jest.Mock).mockResolvedValue(mockDBConfig);
    (prisma.pricingConfigs.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await getPricingConfig();

    expect(result).toBeNull();
  });

  it('returns null when no dbConfig', async () => {
    (getDBConfigByUser as jest.Mock).mockRejectedValue(new Error('no db'));

    const result = await getPricingConfig();

    expect(result).toBeNull();
  });
});

describe('setPricingConfig', () => {
  it('creates a new config with cron when auto=true', async () => {
    (getDBConfigByUser as jest.Mock).mockResolvedValue(mockDBConfig);
    (prisma.pricingConfigs.create as jest.Mock).mockResolvedValue({ id: 'pc-new' });

    await setPricingConfig(
      { auto: true, recurringTime: '*/15 * * * *', meta: '{}' },
      'http://localhost:3000'
    );

    expect(prisma.pricingConfigs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          auto: true,
          recurringTime: '*/15 * * * *',
          databaseConfigId: 'db-1',
        }),
      })
    );

    const cronInstance = (Cron as jest.Mock).mock.results[0].value;
    expect(cronInstance.updateCrontab).toHaveBeenCalledWith(
      expect.objectContaining({
        cronId: 'test-cron-uuid',
        cronSchedule: '*/15 * * * *',
        cronScriptPath: expect.stringContaining('scripts/pricing/auto.js'),
      })
    );
  });

  it('updates existing config', async () => {
    (getDBConfigByUser as jest.Mock).mockResolvedValue(mockDBConfig);
    (prisma.pricingConfigs.findFirst as jest.Mock).mockResolvedValue({
      id: 'pc-1', auto: false, recurringTime: '', meta: '{}', databaseConfigId: 'db-1',
    });
    (prisma.pricingConfigs.update as jest.Mock).mockResolvedValue({ id: 'pc-1' });

    await setPricingConfig(
      { id: 'pc-1', auto: false, recurringTime: '', meta: '{}' },
      'http://localhost:3000'
    );

    expect(prisma.pricingConfigs.update).toHaveBeenCalled();
  });

  it('throws when cron updateCrontab fails (auto=true)', async () => {
    (getDBConfigByUser as jest.Mock).mockResolvedValue(mockDBConfig);
    (prisma.pricingConfigs.create as jest.Mock).mockResolvedValue({ id: 'pc-new' });
    (Cron as jest.Mock).mockImplementation(() => ({
      validateCronSchedule: jest.fn(),
      updateCrontab: jest.fn().mockRejectedValue(new Error('cron failed')),
      deleteCronJob: jest.fn(),
    }));

    await expect(
      setPricingConfig(
        { auto: true, recurringTime: '*/15 * * * *', meta: '{}' },
        'http://localhost:3000'
      )
    ).rejects.toThrow('cron failed');
  });

  it('deletes cron job when auto=false', async () => {
    (getDBConfigByUser as jest.Mock).mockResolvedValue(mockDBConfig);
    (prisma.pricingConfigs.findFirst as jest.Mock).mockResolvedValue({
      id: 'pc-1', auto: true, recurringTime: '* * * * *',
      meta: JSON.stringify({ cronJobId: 'existing-cron-id' }),
      databaseConfigId: 'db-1',
    });
    (prisma.pricingConfigs.update as jest.Mock).mockResolvedValue({ id: 'pc-1' });

    await setPricingConfig(
      { id: 'pc-1', auto: false, recurringTime: '', meta: '{}' },
      'http://localhost:3000'
    );

    const cronInstance = (Cron as jest.Mock).mock.results[0].value;
    expect(cronInstance.deleteCronJob).toHaveBeenCalledWith('existing-cron-id');
  });
});

describe('restorePricingCronJobs', () => {
  it('restores cron jobs for all active configs', async () => {
    (prisma.pricingConfigs.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'pc-1',
        auto: true,
        recurringTime: '*/10 * * * *',
        meta: JSON.stringify({ cronJobId: 'cron-1' }),
      },
    ]);

    await restorePricingCronJobs('http://localhost:3000');

    const cronInstance = (Cron as jest.Mock).mock.results[0].value;
    expect(cronInstance.updateCrontab).toHaveBeenCalledWith(
      expect.objectContaining({
        cronId: 'cron-1',
        cronSchedule: '*/10 * * * *',
      })
    );
  });

  it('skips configs without cronJobId', async () => {
    (prisma.pricingConfigs.findMany as jest.Mock).mockResolvedValue([
      { id: 'pc-1', auto: true, recurringTime: '* * * * *', meta: '{}' },
    ]);

    await restorePricingCronJobs('http://localhost:3000');

    // Cron is instantiated but updateCrontab is never called (no cronJobId)
    const cronInstance = (Cron as jest.Mock).mock.results[0]?.value;
    if (cronInstance) {
      expect(cronInstance.updateCrontab).not.toHaveBeenCalled();
    }
  });

  it('does nothing when no auto configs exist', async () => {
    (prisma.pricingConfigs.findMany as jest.Mock).mockResolvedValue([]);

    await restorePricingCronJobs('http://localhost:3000');

    // Cron may or may not be instantiated, but updateCrontab should not run
    const cronInstance = (Cron as jest.Mock).mock.results[0]?.value;
    if (cronInstance) {
      expect(cronInstance.updateCrontab).not.toHaveBeenCalled();
    }
  });

  it('catches per-config errors and continues', async () => {
    (prisma.pricingConfigs.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'pc-1',
        auto: true,
        recurringTime: '*/10 * * * *',
        meta: JSON.stringify({ cronJobId: 'cron-1' }),
      },
      {
        id: 'pc-2',
        auto: true,
        recurringTime: '*/10 * * * *',
        meta: JSON.stringify({ cronJobId: 'cron-2' }),
      },
    ]);
    let call = 0;
    (Cron as jest.Mock).mockImplementation(() => ({
      validateCronSchedule: jest.fn(),
      updateCrontab: jest.fn().mockImplementation(() => {
        call++;
        if (call === 1) throw new Error('cron-1 failed');
      }),
      deleteCronJob: jest.fn(),
    }));

    // Should not throw — per-config errors are caught
    await expect(
      restorePricingCronJobs('http://localhost:3000')
    ).resolves.toBeUndefined();
  });

  it('catches top-level findMany errors', async () => {
    (prisma.pricingConfigs.findMany as jest.Mock).mockRejectedValue(
      new Error('DB down')
    );

    // Should not throw — top-level error is caught
    await expect(
      restorePricingCronJobs('http://localhost:3000')
    ).resolves.toBeUndefined();
  });
});
