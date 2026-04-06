jest.mock('@/lib/platform/evaluation/evaluation-type-defaults', () => ({
  getEvaluationTypeDefaultPrompts: jest.fn().mockResolvedValue({}),
  getEvaluationTypeDefaultPrompt: jest.fn().mockResolvedValue(undefined),
}));
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

import { getEvaluationConfig, setEvaluationConfig, getEvaluationConfigById, restoreEvaluationCronJobs } from '@/lib/platform/evaluation/config';
import { getEvaluationTypeDefaultPrompts } from '@/lib/platform/evaluation/evaluation-type-defaults';
import { getDBConfigByUser } from '@/lib/db-config';
import prisma from '@/lib/prisma';
import asaw from '@/utils/asaw';
import { throwIfError } from '@/utils/error';
import { getSecretById } from '@/lib/platform/vault';
import Cron from '@/helpers/server/cron';
import getMessage from '@/constants/messages';
import { randomUUID } from 'crypto';
import { jsonParse } from '@/utils/json';

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

  // Default evaluation-type-defaults response (needed by buildEvaluationTypesWithPrompts)
  (getEvaluationTypeDefaultPrompts as jest.Mock).mockResolvedValue({});

  // Re-apply jsonParse so that meta parsing in buildEvaluationTypesWithPrompts works
  (jsonParse as jest.Mock).mockImplementation((v: string) => {
    try { return JSON.parse(v); } catch { return {}; }
  });
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

// ---------------------------------------------------------------------------
// buildEvaluationTypesWithPrompts (tested via getEvaluationConfig / getEvaluationConfigById)
// ---------------------------------------------------------------------------

describe('buildEvaluationTypesWithPrompts — custom evaluation types', () => {
  /**
   * Helper: create an eval config whose meta JSON contains the given evaluationTypes array.
   */
  const makeConfigWithMeta = (evaluationTypes: Array<Record<string, any>>) => ({
    ...makeMockEvalConfig(),
    meta: JSON.stringify({ evaluationTypes }),
  });

  it('includes all 11 built-in types when meta has no evaluationTypes', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([null, makeMockEvalConfig()]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    expect(result.evaluationTypes).toBeDefined();
    expect(result.evaluationTypes!.length).toBe(11);
    result.evaluationTypes!.forEach((t) => {
      expect(t.isCustom).toBe(false);
    });
  });

  it('built-in types use enabledByDefault when no override is present', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([null, makeMockEvalConfig()]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const hallucination = result.evaluationTypes!.find((t) => t.id === 'hallucination');
    expect(hallucination).toBeDefined();
    expect(hallucination!.enabled).toBe(true); // enabledByDefault = true
    expect(hallucination!.isCustom).toBe(false);

    const safety = result.evaluationTypes!.find((t) => t.id === 'safety');
    expect(safety).toBeDefined();
    expect(safety!.enabled).toBe(false); // enabledByDefault = false
  });

  it('custom types in meta.evaluationTypes that are not in EVALUATION_TYPES get included with isCustom: true', async () => {
    const config = makeConfigWithMeta([
      {
        id: 'my_custom_eval',
        enabled: true,
        label: 'My Custom Eval',
        description: 'A custom evaluation type',
        prompt: 'Check for custom issues',
      },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    // Should have 11 built-in + 1 custom = 12
    expect(result.evaluationTypes!.length).toBe(12);

    const custom = result.evaluationTypes!.find((t) => t.id === 'my_custom_eval');
    expect(custom).toBeDefined();
    expect(custom!.isCustom).toBe(true);
    expect(custom!.label).toBe('My Custom Eval');
    expect(custom!.description).toBe('A custom evaluation type');
    expect(custom!.prompt).toBe('Check for custom issues');
    expect(custom!.enabled).toBe(true);
    expect(custom!.enabledByDefault).toBe(false);
    expect(custom!.defaultPrompt).toBe('');
  });

  it('custom types preserve label, description, and prompt from meta', async () => {
    const config = makeConfigWithMeta([
      {
        id: 'brand_voice',
        enabled: true,
        label: 'Brand Voice',
        description: 'Checks if the response matches our brand tone',
        prompt: 'Evaluate whether the response uses our brand voice consistently',
      },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const brandVoice = result.evaluationTypes!.find((t) => t.id === 'brand_voice');
    expect(brandVoice).toMatchObject({
      id: 'brand_voice',
      label: 'Brand Voice',
      description: 'Checks if the response matches our brand tone',
      prompt: 'Evaluate whether the response uses our brand voice consistently',
      isCustom: true,
    });
  });

  it('custom types with enabled: false are included but disabled', async () => {
    const config = makeConfigWithMeta([
      {
        id: 'disabled_custom',
        enabled: false,
        label: 'Disabled Custom',
        description: 'Should be present but disabled',
      },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const disabled = result.evaluationTypes!.find((t) => t.id === 'disabled_custom');
    expect(disabled).toBeDefined();
    expect(disabled!.enabled).toBe(false);
    expect(disabled!.isCustom).toBe(true);
  });

  it('custom types default enabled to false when not specified', async () => {
    const config = makeConfigWithMeta([
      { id: 'no_enabled_field', label: 'No Enabled Field', description: 'Test' },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const noEnabled = result.evaluationTypes!.find((t) => t.id === 'no_enabled_field');
    expect(noEnabled).toBeDefined();
    expect(noEnabled!.enabled).toBe(false);
  });

  it('custom types use id as label fallback when label is missing', async () => {
    const config = makeConfigWithMeta([
      { id: 'fallback_label', description: 'Desc', enabled: true },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const fallback = result.evaluationTypes!.find((t) => t.id === 'fallback_label');
    expect(fallback!.label).toBe('fallback_label');
  });

  it('custom types use default description when description is missing', async () => {
    const config = makeConfigWithMeta([
      { id: 'no_desc', label: 'No Desc', enabled: true },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const noDesc = result.evaluationTypes!.find((t) => t.id === 'no_desc');
    expect(noDesc!.description).toBe('Custom evaluation type');
  });

  it('built-in types still work correctly alongside custom types', async () => {
    const config = makeConfigWithMeta([
      // Override a built-in type
      { id: 'hallucination', enabled: false, prompt: 'custom hallucination prompt' },
      // Add a custom type
      { id: 'custom_one', enabled: true, label: 'Custom One', description: 'Desc 1' },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    // 11 built-in + 1 custom = 12
    expect(result.evaluationTypes!.length).toBe(12);

    // Built-in hallucination should have override applied
    const hallucination = result.evaluationTypes!.find((t) => t.id === 'hallucination');
    expect(hallucination!.isCustom).toBe(false);
    expect(hallucination!.enabled).toBe(false);
    expect(hallucination!.prompt).toBe('custom hallucination prompt');

    // Custom type should be at the end
    const customOne = result.evaluationTypes!.find((t) => t.id === 'custom_one');
    expect(customOne!.isCustom).toBe(true);
    expect(customOne!.enabled).toBe(true);
  });

  it('built-in type overrides apply enabled state from meta', async () => {
    const config = makeConfigWithMeta([
      { id: 'toxicity', enabled: false },
      { id: 'relevance', enabled: true },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const toxicity = result.evaluationTypes!.find((t) => t.id === 'toxicity');
    expect(toxicity!.enabled).toBe(false); // overridden from true

    const relevance = result.evaluationTypes!.find((t) => t.id === 'relevance');
    expect(relevance!.enabled).toBe(true); // overridden from false
  });

  it('built-in types use default prompts from getEvaluationTypeDefaultPrompts', async () => {
    (getEvaluationTypeDefaultPrompts as jest.Mock).mockResolvedValue({
      hallucination: 'Default hallucination prompt text',
      bias: 'Default bias prompt text',
    });
    (asaw as jest.Mock).mockResolvedValueOnce([null, makeMockEvalConfig()]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const hallucination = result.evaluationTypes!.find((t) => t.id === 'hallucination');
    expect(hallucination!.defaultPrompt).toBe('Default hallucination prompt text');

    const bias = result.evaluationTypes!.find((t) => t.id === 'bias');
    expect(bias!.defaultPrompt).toBe('Default bias prompt text');

    // Types without a default prompt get empty string
    const safety = result.evaluationTypes!.find((t) => t.id === 'safety');
    expect(safety!.defaultPrompt).toBe('');
  });

  it('custom types always have empty defaultPrompt', async () => {
    (getEvaluationTypeDefaultPrompts as jest.Mock).mockResolvedValue({
      my_custom: 'this should not appear',
    });
    const config = makeConfigWithMeta([
      { id: 'my_custom', enabled: true, label: 'My Custom' },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const custom = result.evaluationTypes!.find((t) => t.id === 'my_custom');
    expect(custom!.defaultPrompt).toBe('');
  });

  it('multiple custom types can coexist', async () => {
    const config = makeConfigWithMeta([
      { id: 'custom_a', enabled: true, label: 'Custom A', description: 'First custom' },
      { id: 'custom_b', enabled: false, label: 'Custom B', description: 'Second custom' },
      { id: 'custom_c', enabled: true, label: 'Custom C', description: 'Third custom', prompt: 'Prompt C' },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    // 11 built-in + 3 custom = 14
    expect(result.evaluationTypes!.length).toBe(14);

    const customTypes = result.evaluationTypes!.filter((t) => t.isCustom);
    expect(customTypes).toHaveLength(3);
    expect(customTypes.map((t) => t.id)).toEqual(['custom_a', 'custom_b', 'custom_c']);
  });

  it('entries with no id are filtered out', async () => {
    const config = makeConfigWithMeta([
      { id: '', label: 'Empty ID' },
      { label: 'No ID at all' } as any,
      { id: 'valid_custom', enabled: true, label: 'Valid' },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    // Only 'valid_custom' should be added as custom (entries with no/empty id are filtered)
    const customTypes = result.evaluationTypes!.filter((t) => t.isCustom);
    expect(customTypes).toHaveLength(1);
    expect(customTypes[0].id).toBe('valid_custom');
  });

  it('rules with valid ruleId are preserved, invalid ones filtered', async () => {
    const config = makeConfigWithMeta([
      {
        id: 'custom_with_rules',
        enabled: true,
        label: 'Custom With Rules',
        rules: [
          { ruleId: 'rule-1', priority: 1 },
          { ruleId: '', priority: 2 },  // invalid — empty ruleId
          { ruleId: 'rule-3', priority: 3 },
        ],
      },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const custom = result.evaluationTypes!.find((t) => t.id === 'custom_with_rules');
    expect(custom!.rules).toHaveLength(2);
    expect(custom!.rules![0].ruleId).toBe('rule-1');
    expect(custom!.rules![1].ruleId).toBe('rule-3');
  });

  it('built-in type rules from overrides are applied', async () => {
    const config = makeConfigWithMeta([
      {
        id: 'hallucination',
        enabled: true,
        rules: [{ ruleId: 'rule-hal-1', priority: 1 }],
      },
    ]);
    (asaw as jest.Mock).mockResolvedValueOnce([null, config]);

    const result = await getEvaluationConfigById('eval-cfg-1');

    const hallucination = result.evaluationTypes!.find((t) => t.id === 'hallucination');
    expect(hallucination!.rules).toHaveLength(1);
    expect(hallucination!.rules![0].ruleId).toBe('rule-hal-1');
  });
});

describe('restoreEvaluationCronJobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getMessage as jest.Mock).mockReturnValue({
      CRON_JOB_UPDATION_ERROR: 'Cron job error',
    });
    (jsonParse as jest.Mock).mockImplementation((v: string) => {
      try { return JSON.parse(v); } catch { return {}; }
    });
  });

  it('does nothing when no auto-evaluation configs exist', async () => {
    (prisma.evaluationConfigs.findMany as jest.Mock).mockResolvedValue([]);
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await restoreEvaluationCronJobs('http://localhost:3000');

    expect(prisma.evaluationConfigs.findMany).toHaveBeenCalledWith({ where: { auto: true } });
    expect(consoleSpy).toHaveBeenCalledWith('No auto-evaluation configs to restore');
    consoleSpy.mockRestore();
  });

  it('does nothing when findMany returns null', async () => {
    (prisma.evaluationConfigs.findMany as jest.Mock).mockResolvedValue(null);
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await restoreEvaluationCronJobs('http://localhost:3000');

    expect(consoleSpy).toHaveBeenCalledWith('No auto-evaluation configs to restore');
    consoleSpy.mockRestore();
  });

  it('restores cron jobs for configs with cronJobId and recurringTime', async () => {
    const mockUpdateCrontab = jest.fn();
    (Cron as unknown as jest.Mock).mockImplementation(() => ({
      validateCronSchedule: jest.fn(),
      updateCrontab: mockUpdateCrontab,
      deleteCronJob: jest.fn(),
    }));

    (prisma.evaluationConfigs.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'cfg-1',
        recurringTime: '0 * * * *',
        meta: JSON.stringify({ cronJobId: 'cron-123' }),
      },
    ]);
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await restoreEvaluationCronJobs('http://localhost:3000');

    expect(mockUpdateCrontab).toHaveBeenCalledWith(
      expect.objectContaining({
        cronId: 'cron-123',
        cronSchedule: '0 * * * *',
        cronEnvVars: {
          EVALUATION_CONFIG_ID: 'cfg-1',
          API_URL: 'http://localhost:3000',
        },
      })
    );
    expect(consoleSpy).toHaveBeenCalledWith('Restored cron job for evaluation config cfg-1');
    consoleSpy.mockRestore();
  });

  it('skips configs without cronJobId in meta', async () => {
    const mockUpdateCrontab = jest.fn();
    (Cron as unknown as jest.Mock).mockImplementation(() => ({
      validateCronSchedule: jest.fn(),
      updateCrontab: mockUpdateCrontab,
      deleteCronJob: jest.fn(),
    }));

    (prisma.evaluationConfigs.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'cfg-2',
        recurringTime: '0 * * * *',
        meta: JSON.stringify({}),
      },
    ]);

    await restoreEvaluationCronJobs('http://localhost:3000');

    expect(mockUpdateCrontab).not.toHaveBeenCalled();
  });

  it('skips configs without recurringTime', async () => {
    const mockUpdateCrontab = jest.fn();
    (Cron as unknown as jest.Mock).mockImplementation(() => ({
      validateCronSchedule: jest.fn(),
      updateCrontab: mockUpdateCrontab,
      deleteCronJob: jest.fn(),
    }));

    (prisma.evaluationConfigs.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'cfg-3',
        recurringTime: '',
        meta: JSON.stringify({ cronJobId: 'cron-456' }),
      },
    ]);

    await restoreEvaluationCronJobs('http://localhost:3000');

    expect(mockUpdateCrontab).not.toHaveBeenCalled();
  });

  it('continues restoring other configs if one fails', async () => {
    const mockUpdateCrontab = jest.fn()
      .mockImplementationOnce(() => { throw new Error('cron fail'); })
      .mockImplementationOnce(() => {});
    (Cron as unknown as jest.Mock).mockImplementation(() => ({
      validateCronSchedule: jest.fn(),
      updateCrontab: mockUpdateCrontab,
      deleteCronJob: jest.fn(),
    }));

    (prisma.evaluationConfigs.findMany as jest.Mock).mockResolvedValue([
      { id: 'cfg-a', recurringTime: '* * * * *', meta: JSON.stringify({ cronJobId: 'c-a' }) },
      { id: 'cfg-b', recurringTime: '* * * * *', meta: JSON.stringify({ cronJobId: 'c-b' }) },
    ]);

    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    await restoreEvaluationCronJobs('http://localhost:3000');

    expect(errorSpy).toHaveBeenCalledWith('Failed to restore cron job for config cfg-a:', expect.any(Error));
    expect(logSpy).toHaveBeenCalledWith('Restored cron job for evaluation config cfg-b');
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('catches top-level errors gracefully', async () => {
    (prisma.evaluationConfigs.findMany as jest.Mock).mockRejectedValue(new Error('DB down'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    await restoreEvaluationCronJobs('http://localhost:3000');

    expect(errorSpy).toHaveBeenCalledWith('Failed to restore evaluation cron jobs:', expect.any(Error));
    errorSpy.mockRestore();
  });
});
