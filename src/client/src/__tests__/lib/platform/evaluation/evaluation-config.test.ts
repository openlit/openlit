jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
    EVALUATION_CONFIG_NOT_FOUND: 'Eval config not found',
    EVALUATION_VAULT_SECRET_NOT_FOUND: 'Vault secret not found',
    DATABASE_CONFIG_NOT_FOUND: 'DB config not found',
    EVALUATION_CONFIG_SET_ERROR: 'Eval config set error',
    CRON_JOB_UPDATION_ERROR: 'Cron job error',
  })),
}));
jest.mock('@/lib/db-config', () => ({
  getDBConfigByUser: jest.fn(),
}));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    evaluationConfigs: {
      findFirst: jest.fn(),
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
jest.mock('@/lib/platform/vault', () => ({
  getSecretById: jest.fn(),
}));
jest.mock('@/helpers/server/cron', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      validateCronSchedule: jest.fn(),
      updateCrontab: jest.fn().mockResolvedValue(undefined),
      deleteCronJob: jest.fn().mockResolvedValue(undefined),
    })),
  };
});
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
  randomUUID: jest.fn(() => 'test-uuid-1234'),
}));
jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  dirname: jest.fn((p: string) => p.split('/').slice(0, -1).join('/')),
}));

import { getEvaluationConfig, setEvaluationConfig, getEvaluationConfigById } from '@/lib/platform/evaluation/config';
import { getDBConfigByUser } from '@/lib/db-config';
import prisma from '@/lib/prisma';
import asaw from '@/utils/asaw';
import { throwIfError } from '@/utils/error';
import { getSecretById } from '@/lib/platform/vault';
import Cron from '@/helpers/server/cron';
import getMessage from '@/constants/messages';
import { randomUUID } from 'crypto';

const mockDBConfig = { id: 'db-1', name: 'test-db' };

// Factory function to always get a fresh copy, preventing cross-test mutation
// (the source mutates updatedConfig.vaultId directly on the object reference)
const makeMockEvalConfig = () => ({
  id: 'eval-cfg-1',
  vaultId: 'vault-1',
  databaseConfigId: 'db-1',
  auto: false,
  recurringTime: '0 * * * *',
  meta: '{}',
  provider: 'openai',
  model: 'gpt-4',
});

const mockSecret = { id: 'secret-1', key: 'OPENAI_API_KEY', value: 'sk-xxx' };

beforeEach(() => {
  jest.resetAllMocks();

  // Re-apply getMessage implementation after resetAllMocks clears the factory
  (getMessage as jest.Mock).mockReturnValue({
    UNAUTHORIZED_USER: 'Unauthorized',
    EVALUATION_CONFIG_NOT_FOUND: 'Eval config not found',
    EVALUATION_VAULT_SECRET_NOT_FOUND: 'Vault secret not found',
    DATABASE_CONFIG_NOT_FOUND: 'DB config not found',
    EVALUATION_CONFIG_SET_ERROR: 'Eval config set error',
    CRON_JOB_UPDATION_ERROR: 'Cron job error',
  });

  // Re-apply throwIfError implementation after resetAllMocks
  (throwIfError as jest.Mock).mockImplementation((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  });

  // Re-apply randomUUID implementation after resetAllMocks
  (randomUUID as jest.Mock).mockReturnValue('test-uuid-1234');

  // Default Cron mock factory re-applied after reset
  (Cron as jest.Mock).mockImplementation(() => ({
    validateCronSchedule: jest.fn(),
    updateCrontab: jest.fn().mockResolvedValue(undefined),
    deleteCronJob: jest.fn().mockResolvedValue(undefined),
  }));

  // Default getSecretById response
  (getSecretById as jest.Mock).mockResolvedValue({ data: [mockSecret] });
});

// ---------------------------------------------------------------------------
// getEvaluationConfig
// ---------------------------------------------------------------------------

describe('getEvaluationConfig', () => {
  it('uses the provided dbConfig and skips getDBConfigByUser', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([null, makeMockEvalConfig()]);

    const result = await getEvaluationConfig(mockDBConfig as any);

    expect(getDBConfigByUser).not.toHaveBeenCalled();
    expect(result.id).toBe('eval-cfg-1');
    expect(result.secret).toEqual(mockSecret);
  });

  it('calls getDBConfigByUser when no dbConfig is provided', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig])          // getDBConfigByUser
      .mockResolvedValueOnce([null, makeMockEvalConfig()]); // prisma.evaluationConfigs.findFirst

    const result = await getEvaluationConfig();

    expect(asaw).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('eval-cfg-1');
  });

  it('throws EVALUATION_CONFIG_NOT_FOUND when config has no id', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig])
      .mockResolvedValueOnce([null, null]); // no config found

    await expect(getEvaluationConfig()).rejects.toThrow('Eval config not found');
  });

  it('throws EVALUATION_VAULT_SECRET_NOT_FOUND when secret not found and validateVaultId=true', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig])
      .mockResolvedValueOnce([null, makeMockEvalConfig()]);
    (getSecretById as jest.Mock).mockResolvedValue({ data: [] }); // no secret

    await expect(getEvaluationConfig(undefined, true, true)).rejects.toThrow(
      'Vault secret not found'
    );
  });

  it('returns config with empty vaultId when secret not found and validateVaultId=false', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig])
      .mockResolvedValueOnce([null, makeMockEvalConfig()]);
    (getSecretById as jest.Mock).mockResolvedValue({ data: [] }); // no secret

    const result = await getEvaluationConfig(undefined, true, false);

    expect(result.vaultId).toBe('');
    expect(result.secret).toEqual({});
  });

  it('returns full config with secret when all succeeds', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig])
      .mockResolvedValueOnce([null, makeMockEvalConfig()]);
    (getSecretById as jest.Mock).mockResolvedValue({ data: [mockSecret] });

    const result = await getEvaluationConfig();

    expect(result).toMatchObject({
      id: 'eval-cfg-1',
      vaultId: 'vault-1',
      databaseConfigId: 'db-1',
      secret: mockSecret,
    });
  });
});

// ---------------------------------------------------------------------------
// setEvaluationConfig
// ---------------------------------------------------------------------------

describe('setEvaluationConfig', () => {
  it('throws DATABASE_CONFIG_NOT_FOUND when dbConfig not found', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([null, null]); // no dbConfig

    await expect(
      setEvaluationConfig({ auto: false } as any, 'http://api.example.com')
    ).rejects.toThrow('DB config not found');
  });

  it('create path: creates new config when no id provided', async () => {
    const newConfig = { auto: false, recurringTime: '', meta: '{}' };
    const createdRecord = { id: 'new-cfg-1', ...newConfig, databaseConfigId: 'db-1' };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig]) // getDBConfigByUser
      .mockResolvedValueOnce([null, createdRecord]); // prisma.evaluationConfigs.create

    const result = await setEvaluationConfig(newConfig as any, 'http://api.example.com');

    expect(prisma.evaluationConfigs.create).toHaveBeenCalledTimes(1);
    expect(prisma.evaluationConfigs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ databaseConfigId: 'db-1' }),
      })
    );
    expect(result).toEqual(createdRecord);
  });

  it('update path: updates existing config when id is provided', async () => {
    const previousConfig = makeMockEvalConfig();
    const inputConfig = { id: 'eval-cfg-1', auto: false, recurringTime: '', meta: '{}' };
    const updatedRecord = { ...previousConfig, auto: false };

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig])    // getDBConfigByUser
      .mockResolvedValueOnce([null, previousConfig])  // prisma.evaluationConfigs.findFirst (load previous)
      .mockResolvedValueOnce([null, updatedRecord]);  // prisma.evaluationConfigs.update

    const result = await setEvaluationConfig(inputConfig as any, 'http://api.example.com');

    expect(prisma.evaluationConfigs.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'eval-cfg-1' } })
    );
    expect(prisma.evaluationConfigs.update).toHaveBeenCalledTimes(1);
    expect(result).toEqual(updatedRecord);
  });

  it('throws EVALUATION_CONFIG_SET_ERROR when prisma create fails', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig])       // getDBConfigByUser
      .mockResolvedValueOnce(['DB write error', null]);  // prisma.evaluationConfigs.create fails

    await expect(
      setEvaluationConfig({ auto: false, meta: '{}' } as any, 'http://api.example.com')
    ).rejects.toThrow('Eval config set error');
  });

  it('auto=true: calls updateCrontab with correct parameters', async () => {
    const autoConfig = {
      auto: true,
      recurringTime: '0 * * * *',
      meta: '{}',
    };
    const createdRecord = { id: 'new-cfg-1', ...autoConfig, databaseConfigId: 'db-1' };

    const mockUpdateCrontab = jest.fn().mockResolvedValue(undefined);
    const mockValidateCronSchedule = jest.fn();
    (Cron as jest.Mock).mockImplementation(() => ({
      validateCronSchedule: mockValidateCronSchedule,
      updateCrontab: mockUpdateCrontab,
      deleteCronJob: jest.fn().mockResolvedValue(undefined),
    }));

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig])
      .mockResolvedValueOnce([null, createdRecord]);

    await setEvaluationConfig(autoConfig as any, 'http://api.example.com');

    expect(mockValidateCronSchedule).toHaveBeenCalledWith('0 * * * *');
    expect(mockUpdateCrontab).toHaveBeenCalledWith(
      expect.objectContaining({
        cronId: 'test-uuid-1234',
        cronSchedule: '0 * * * *',
        cronEnvVars: expect.objectContaining({
          EVALUATION_CONFIG_ID: 'new-cfg-1',
          API_URL: 'http://api.example.com',
        }),
      })
    );
  });

  it('auto=false: calls deleteCronJob with the cronJobId', async () => {
    const manualConfig = { auto: false, recurringTime: '', meta: '{}' };
    const createdRecord = { id: 'new-cfg-1', ...manualConfig, databaseConfigId: 'db-1' };

    const mockDeleteCronJob = jest.fn().mockResolvedValue(undefined);
    (Cron as jest.Mock).mockImplementation(() => ({
      validateCronSchedule: jest.fn(),
      updateCrontab: jest.fn().mockResolvedValue(undefined),
      deleteCronJob: mockDeleteCronJob,
    }));

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig])
      .mockResolvedValueOnce([null, createdRecord]);

    await setEvaluationConfig(manualConfig as any, 'http://api.example.com');

    expect(mockDeleteCronJob).toHaveBeenCalledWith('test-uuid-1234');
  });

  it('rethrows when Cron throws an error during updateCrontab', async () => {
    const autoConfig = { auto: true, recurringTime: '0 * * * *', meta: '{}' };
    const createdRecord = { id: 'new-cfg-1', ...autoConfig, databaseConfigId: 'db-1' };
    const cronError = new Error('Cron system unavailable');

    (Cron as jest.Mock).mockImplementation(() => ({
      validateCronSchedule: jest.fn(),
      updateCrontab: jest.fn().mockRejectedValue(cronError),
      deleteCronJob: jest.fn().mockResolvedValue(undefined),
    }));

    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, mockDBConfig])
      .mockResolvedValueOnce([null, createdRecord]);

    await expect(
      setEvaluationConfig(autoConfig as any, 'http://api.example.com')
    ).rejects.toThrow('Cron system unavailable');
  });
});

// ---------------------------------------------------------------------------
// getEvaluationConfigById
// ---------------------------------------------------------------------------

describe('getEvaluationConfigById', () => {
  it('throws EVALUATION_CONFIG_NOT_FOUND when config not found', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([null, null]); // no config

    await expect(getEvaluationConfigById('missing-id')).rejects.toThrow(
      'Eval config not found'
    );
  });

  it('throws EVALUATION_CONFIG_NOT_FOUND when prisma returns an error', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce(['DB error', null]);

    await expect(getEvaluationConfigById('eval-cfg-1')).rejects.toThrow(
      'Eval config not found'
    );
  });

  it('returns config with secret when found', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([null, makeMockEvalConfig()]);
    (getSecretById as jest.Mock).mockResolvedValue({ data: [mockSecret] });

    const result = await getEvaluationConfigById('eval-cfg-1');

    expect(result).toMatchObject({
      id: 'eval-cfg-1',
      vaultId: 'vault-1',
      databaseConfigId: 'db-1',
      secret: mockSecret,
    });
    expect(getSecretById).toHaveBeenCalledWith('vault-1', 'db-1', true);
  });

  it('includes vault value when excludeVaultValue=false', async () => {
    const secretWithValue = { ...mockSecret, value: 'sk-actual-key' };
    (asaw as jest.Mock).mockResolvedValueOnce([null, makeMockEvalConfig()]);
    (getSecretById as jest.Mock).mockResolvedValue({ data: [secretWithValue] });

    const result = await getEvaluationConfigById('eval-cfg-1', false);

    expect(getSecretById).toHaveBeenCalledWith('vault-1', 'db-1', false);
    expect(result.secret).toEqual(secretWithValue);
  });

  it('returns empty secret object when secret data is empty', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([null, makeMockEvalConfig()]);
    (getSecretById as jest.Mock).mockResolvedValue({ data: [] });

    const result = await getEvaluationConfigById('eval-cfg-1');

    expect(result.secret).toEqual({});
  });
});
