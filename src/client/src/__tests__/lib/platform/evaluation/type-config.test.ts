jest.mock('@/lib/platform/evaluation/sync-rule-entities', () => ({
  syncRuleEntitiesFromConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/utils/json', () => ({
  jsonParse: jest.fn((v: string) => {
    try { return JSON.parse(v); } catch { return {}; }
  }),
  jsonStringify: jest.fn((v: unknown) => JSON.stringify(v)),
}));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    evaluationConfigs: {
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));

import {
  normalizeRules,
  normalizeTypeConfig,
  mergeTypeIntoList,
  persistEvaluationTypes,
} from '@/lib/platform/evaluation/type-config';
import { syncRuleEntitiesFromConfig } from '@/lib/platform/evaluation/sync-rule-entities';
import prisma from '@/lib/prisma';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizeRules', () => {
  it('returns an empty array for a non-array input', () => {
    expect(normalizeRules('not-an-array' as any)).toEqual([]);
  });

  it('filters out entries without a ruleId', () => {
    const result = normalizeRules([{ ruleId: 'r1', priority: 2 }, { priority: 3 }, { ruleId: '' }]);
    expect(result).toEqual([{ ruleId: 'r1', priority: 2 }]);
  });

  it('defaults priority to 0 when missing or non-numeric', () => {
    const result = normalizeRules([{ ruleId: 'r1' }, { ruleId: 'r2', priority: 'bad' }]);
    expect(result).toEqual([{ ruleId: 'r1', priority: 0 }, { ruleId: 'r2', priority: 0 }]);
  });
});

describe('normalizeTypeConfig', () => {
  it('builds a minimal built-in type config', () => {
    const result = normalizeTypeConfig({ id: 'toxicity', enabled: true }, undefined);
    expect(result).toEqual({ id: 'toxicity', enabled: true, rules: [] });
  });

  it('includes thresholdScore only when provided', () => {
    const result = normalizeTypeConfig({ id: 'toxicity', enabled: true }, 0.8);
    expect(result.thresholdScore).toBe(0.8);
    const withoutThreshold = normalizeTypeConfig({ id: 'toxicity', enabled: true }, undefined);
    expect(withoutThreshold).not.toHaveProperty('thresholdScore');
  });

  it('collects rules from the rules array over the legacy ruleId field', () => {
    const result = normalizeTypeConfig(
      { id: 'toxicity', enabled: true, rules: [{ ruleId: 'r1', priority: 2 }], ruleId: 'legacy' },
      undefined
    );
    expect(result.rules).toEqual([{ ruleId: 'r1', priority: 2 }]);
  });

  it('falls back to the legacy ruleId/priority fields when rules is absent', () => {
    const result = normalizeTypeConfig({ id: 'toxicity', enabled: true, ruleId: 'r-legacy', priority: 3 }, undefined);
    expect(result.rules).toEqual([{ ruleId: 'r-legacy', priority: 3 }]);
  });

  it('preserves custom type metadata for isCustom types', () => {
    const result = normalizeTypeConfig(
      { id: 'my_custom', enabled: true, isCustom: true, label: ' Custom Label ', description: ' Desc ', prompt: ' Custom prompt ' },
      undefined
    );
    expect(result).toMatchObject({
      isCustom: true,
      label: 'Custom Label',
      description: 'Desc',
      prompt: 'Custom prompt',
    });
  });

  it('trims a custom prompt for built-in (non-custom) types too', () => {
    const result = normalizeTypeConfig({ id: 'toxicity', enabled: true, prompt: '  override  ' }, undefined);
    expect(result.prompt).toBe('override');
    expect(result.isCustom).toBeUndefined();
  });
});

describe('mergeTypeIntoList', () => {
  it('appends a new entry when no existing entry has the same id', () => {
    const result = mergeTypeIntoList([{ id: 'a', enabled: true }], { id: 'b', enabled: false });
    expect(result).toEqual([{ id: 'a', enabled: true }, { id: 'b', enabled: false }]);
  });

  it('replaces the existing entry in place when the id already exists', () => {
    const result = mergeTypeIntoList(
      [{ id: 'a', enabled: true }, { id: 'b', enabled: false }],
      { id: 'a', enabled: false }
    );
    expect(result).toEqual([{ id: 'a', enabled: false }, { id: 'b', enabled: false }]);
  });

  it('does not mutate the original array', () => {
    const original = [{ id: 'a', enabled: true }];
    mergeTypeIntoList(original, { id: 'a', enabled: false });
    expect(original).toEqual([{ id: 'a', enabled: true }]);
  });
});

describe('persistEvaluationTypes', () => {
  it('merges evaluationTypes into the existing meta and persists it', async () => {
    await persistEvaluationTypes(
      'cfg-1',
      JSON.stringify({ cronJobId: 'keep-me' }),
      [{ id: 'toxicity', enabled: true }]
    );

    expect(prisma.evaluationConfigs.update).toHaveBeenCalledWith({
      where: { id: 'cfg-1' },
      data: {
        meta: JSON.stringify({
          cronJobId: 'keep-me',
          evaluationTypes: [{ id: 'toxicity', enabled: true }],
        }),
      },
    });
  });

  it('handles a null/empty meta by starting fresh', async () => {
    await persistEvaluationTypes('cfg-1', null, [{ id: 'toxicity', enabled: true }]);
    expect(prisma.evaluationConfigs.update).toHaveBeenCalledWith({
      where: { id: 'cfg-1' },
      data: { meta: JSON.stringify({ evaluationTypes: [{ id: 'toxicity', enabled: true }] }) },
    });
  });

  it('re-syncs rule entities after persisting', async () => {
    await persistEvaluationTypes('cfg-1', '{}', []);
    expect(syncRuleEntitiesFromConfig).toHaveBeenCalled();
  });
});
