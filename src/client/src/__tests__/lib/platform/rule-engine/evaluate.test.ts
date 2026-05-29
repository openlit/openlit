jest.mock('@/lib/platform/common', () => ({ dataCollector: jest.fn() }));
jest.mock('@/lib/platform/rule-engine/table-details', () => ({
  OPENLIT_RULES_TABLE_NAME: 'openlit_rules',
  OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME: 'openlit_rule_condition_groups',
  OPENLIT_RULE_CONDITIONS_TABLE_NAME: 'openlit_rule_conditions',
  OPENLIT_RULE_ENTITIES_TABLE_NAME: 'openlit_rule_entities',
}));
jest.mock('@/lib/platform/context/table-details', () => ({
  OPENLIT_CONTEXTS_TABLE_NAME: 'openlit_contexts',
}));
jest.mock('@/lib/platform/prompt/compiled', () => ({
  getCompiledPromptByDbConfig: jest.fn(),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: { sanitizeValue: jest.fn((v: string) => v) },
}));

import { evaluateRules } from '@/lib/platform/rule-engine/evaluate';
import { dataCollector } from '@/lib/platform/common';
import { getCompiledPromptByDbConfig } from '@/lib/platform/prompt/compiled';

beforeEach(() => {
  jest.clearAllMocks();
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
  (getCompiledPromptByDbConfig as jest.Mock).mockResolvedValue({ content: 'prompt-content' });
});

describe('evaluateRules', () => {
  describe('early return for empty fields', () => {
    it('returns empty result when fields is undefined', async () => {
      const result = await evaluateRules({ fields: undefined as any, entity_type: 'context', include_entity_data: false });
      expect(result).toEqual({ matchingRuleIds: [], entities: [] });
      expect(dataCollector).not.toHaveBeenCalled();
    });

    it('returns empty result when fields is empty object', async () => {
      const result = await evaluateRules({ fields: {}, entity_type: 'context', include_entity_data: false });
      expect(result).toEqual({ matchingRuleIds: [], entities: [] });
      expect(dataCollector).not.toHaveBeenCalled();
    });
  });

  describe('SQL query construction', () => {
    it('calls dataCollector with a query containing CTE names', async () => {
      await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: false });
      expect(dataCollector).toHaveBeenCalledTimes(1);
      const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
      expect(query).toContain('input_values');
      expect(query).toContain('condition_matches');
      expect(query).toContain('group_matches');
      expect(query).toContain('rule_matches');
    });

    it('embeds field key and value in the UNION ALL row', async () => {
      await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: false });
      const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
      expect(query).toContain('model');
      expect(query).toContain('gpt-4');
    });

    it('uses UNION ALL for multiple fields', async () => {
      await evaluateRules({ fields: { model: 'gpt-4', status: 'OK' }, entity_type: 'context', include_entity_data: false });
      const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
      expect(query).toContain('UNION ALL');
    });

    it('filters by entity_type in WHERE clause', async () => {
      await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'prompt', include_entity_data: false });
      const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
      expect(query).toContain("'prompt'");
    });

    it('passes databaseConfigId to dataCollector', async () => {
      await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: false }, 'db-42');
      expect(dataCollector).toHaveBeenCalledWith(expect.any(Object), 'query', 'db-42');
    });

    it('escapes special characters in field values', async () => {
      await evaluateRules({ fields: { input: "it's a test" }, entity_type: 'context', include_entity_data: false });
      const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
      // sqlstring escapes single quotes — they should not break the query
      expect(query).toContain('input');
    });
  });

  describe('result mapping', () => {
    it('returns empty result when dataCollector returns no rows', async () => {
      const result = await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: false });
      expect(result).toEqual({ matchingRuleIds: [], entities: [] });
    });

    it('maps rows to matchingRuleIds (deduplicated) and entities', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({
        data: [
          { rule_id: 'r1', entity_type: 'context', entity_id: 'e1' },
          { rule_id: 'r1', entity_type: 'context', entity_id: 'e2' },
          { rule_id: 'r2', entity_type: 'context', entity_id: 'e3' },
        ],
        err: null,
      });
      const result = await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: false });
      expect(result.matchingRuleIds).toEqual(['r1', 'r2']);
      expect(result.entities).toHaveLength(3);
      expect(result.entities[0]).toEqual({ rule_id: 'r1', entity_type: 'context', entity_id: 'e1' });
    });

    it('throws when dataCollector returns an error', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB error', data: null });
      await expect(
        evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: false })
      ).rejects.toThrow('DB error');
    });
  });

  describe('include_entity_data = false', () => {
    it('does not fetch entity data', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({
        data: [{ rule_id: 'r1', entity_type: 'context', entity_id: 'e1' }],
        err: null,
      });
      const result = await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: false });
      // dataCollector called once for main query only
      expect(dataCollector).toHaveBeenCalledTimes(1);
      expect(result.entity_data).toBeUndefined();
    });
  });

  describe('include_entity_data = true — context entity', () => {
    it('fetches context data for each unique context entity', async () => {
      (dataCollector as jest.Mock)
        .mockResolvedValueOnce({
          data: [{ rule_id: 'r1', entity_type: 'context', entity_id: 'ctx-1' }],
          err: null,
        })
        .mockResolvedValueOnce({
          data: [{ id: 'ctx-1', content: 'context content' }],
          err: null,
        });

      const result = await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: true });
      expect(result.entity_data).toBeDefined();
      expect(result.entity_data!['context:ctx-1']).toEqual({ id: 'ctx-1', content: 'context content' });
    });

    it('deduplicates entities with the same type:id key', async () => {
      (dataCollector as jest.Mock)
        .mockResolvedValueOnce({
          data: [
            { rule_id: 'r1', entity_type: 'context', entity_id: 'ctx-1' },
            { rule_id: 'r2', entity_type: 'context', entity_id: 'ctx-1' }, // same entity, different rule
          ],
          err: null,
        })
        .mockResolvedValueOnce({ data: [{ id: 'ctx-1', content: 'data' }], err: null });

      await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: true });
      // context fetch should only happen once (deduplication)
      expect(dataCollector).toHaveBeenCalledTimes(2);
    });

    it('sets entity_data to null when context fetch returns empty', async () => {
      (dataCollector as jest.Mock)
        .mockResolvedValueOnce({
          data: [{ rule_id: 'r1', entity_type: 'context', entity_id: 'ctx-1' }],
          err: null,
        })
        .mockResolvedValueOnce({ data: [], err: null });

      const result = await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: true });
      expect(result.entity_data!['context:ctx-1']).toBeNull();
    });

    it('sets entity_data to null when context fetch throws', async () => {
      (dataCollector as jest.Mock)
        .mockResolvedValueOnce({
          data: [{ rule_id: 'r1', entity_type: 'context', entity_id: 'ctx-1' }],
          err: null,
        })
        .mockRejectedValueOnce(new Error('fetch failed'));

      const result = await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'context', include_entity_data: true });
      expect(result.entity_data!['context:ctx-1']).toBeNull();
    });
  });

  describe('include_entity_data = true — prompt entity', () => {
    it('fetches prompt data using getCompiledPromptByDbConfig', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({
        data: [{ rule_id: 'r1', entity_type: 'prompt', entity_id: 'p-1' }],
        err: null,
      });
      (getCompiledPromptByDbConfig as jest.Mock).mockResolvedValue({ content: 'compiled prompt' });

      const result = await evaluateRules({
        fields: { model: 'gpt-4' },
        entity_type: 'prompt',
        include_entity_data: true,
        entity_inputs: { variables: { name: 'Alice' }, version: 'v1', shouldCompile: true },
      });

      expect(getCompiledPromptByDbConfig).toHaveBeenCalledWith({
        id: 'p-1',
        version: 'v1',
        variables: { name: 'Alice' },
        shouldCompile: true,
        databaseConfigId: undefined,
      });
      expect(result.entity_data!['prompt:p-1']).toEqual({ content: 'compiled prompt' });
    });

    it('sets entity_data to null when prompt fetch throws', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({
        data: [{ rule_id: 'r1', entity_type: 'prompt', entity_id: 'p-1' }],
        err: null,
      });
      (getCompiledPromptByDbConfig as jest.Mock).mockRejectedValue(new Error('prompt error'));

      const result = await evaluateRules({ fields: { model: 'gpt-4' }, entity_type: 'prompt', include_entity_data: true });
      expect(result.entity_data!['prompt:p-1']).toBeNull();
    });
  });
});
