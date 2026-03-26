jest.mock('@/lib/platform/common', () => ({ dataCollector: jest.fn() }));
jest.mock('@/lib/platform/rule-engine/table-details', () => ({
  OPENLIT_RULES_TABLE_NAME: 'openlit_rules',
  OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME: 'openlit_rule_condition_groups',
  OPENLIT_RULE_CONDITIONS_TABLE_NAME: 'openlit_rule_conditions',
  OPENLIT_RULE_ENTITIES_TABLE_NAME: 'openlit_rule_entities',
}));
jest.mock('@/lib/session', () => ({ getCurrentUser: jest.fn() }));
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((cond: boolean, msg: string) => { if (cond) throw new Error(msg); }),
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
    RULE_NOT_FOUND: 'Rule not found',
    RULE_NOT_CREATED: 'Rule not created',
    RULE_CREATED: 'Rule created!',
    RULE_NOT_UPDATED: 'Rule not updated',
    RULE_UPDATED: 'Rule updated!',
    RULE_NOT_DELETED: 'Rule not deleted',
    RULE_DELETED: 'Rule deleted!',
    RULE_CONDITION_GROUP_NOT_ADDED: 'Group not added',
    RULE_CONDITION_GROUP_ADDED: 'Group added!',
    RULE_ENTITY_NOT_ASSOCIATED: 'Entity not associated',
    RULE_ENTITY_ASSOCIATED: 'Entity associated!',
    RULE_ENTITY_NOT_DELETED: 'Entity not deleted',
    RULE_ENTITY_DELETED: 'Entity deleted!',
  })),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: {
    sanitizeValue: jest.fn((v: string) => v),
    sanitizeObject: jest.fn((o: object) => o),
  },
}));
jest.mock('@/helpers/server/rule-engine', () => ({
  verifyRuleInput: jest.fn(() => ({ success: true })),
  verifyConditionGroupInput: jest.fn(() => ({ success: true })),
  verifyEntityInput: jest.fn(() => ({ success: true })),
}));


import {
  getRules,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
  addConditionGroupsToRule,
  addRuleEntity,
  deleteRuleEntity,
  getRuleEntities,
} from '@/lib/platform/rule-engine/index';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';
import { verifyRuleInput, verifyConditionGroupInput, verifyEntityInput } from '@/helpers/server/rule-engine';

beforeEach(() => {
  jest.clearAllMocks();
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'user@example.com' });
  (verifyRuleInput as jest.Mock).mockReturnValue({ success: true });
  (verifyConditionGroupInput as jest.Mock).mockReturnValue({ success: true });
  (verifyEntityInput as jest.Mock).mockReturnValue({ success: true });
});

// ---------------------------------------------------------------------------
// getRules
// ---------------------------------------------------------------------------
describe('getRules', () => {
  it('throws when unauthenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getRules()).rejects.toThrow('Unauthorized');
  });

  it('queries openlit_rules table', async () => {
    await getRules();
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('openlit_rules');
    expect(query).toContain('SELECT');
  });

  it('passes optional databaseConfigId', async () => {
    await getRules('db-1');
    expect(dataCollector).toHaveBeenCalledWith(expect.any(Object), 'query', 'db-1');
  });

  it('returns dataCollector result', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ id: 'r1' }], err: null });
    const result = await getRules();
    expect(result).toEqual({ data: [{ id: 'r1' }], err: null });
  });
});

// ---------------------------------------------------------------------------
// getRuleById
// ---------------------------------------------------------------------------
describe('getRuleById', () => {
  it('throws when unauthenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getRuleById('r1')).rejects.toThrow('Unauthorized');
  });

  it('returns RULE_NOT_FOUND when no rule data', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    const result = await getRuleById('r1');
    expect(result).toEqual({ err: 'Rule not found' });
  });

  it('returns error when ruleResult has err', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: 'DB err' });
    const result = await getRuleById('r1');
    expect(result.err).toBe('DB err');
  });

  it('returns rule with condition_groups on success', async () => {
    const rule = { id: 'r1', name: 'Test Rule' };
    const group = { id: 'g1', rule_id: 'r1', condition_operator: 'AND' };
    const condition = { id: 'c1', rule_id: 'r1', group_id: 'g1', field: 'cost' };

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [rule], err: null })   // ruleQuery
      .mockResolvedValueOnce({ data: [group], err: null })  // groupsQuery
      .mockResolvedValueOnce({ data: [condition], err: null }); // conditionsQuery

    const result = await getRuleById('r1');
    expect(result.data).toMatchObject({
      id: 'r1',
      condition_groups: [{ id: 'g1', conditions: [condition] }],
    });
  });

  it('attaches conditions to their parent group', async () => {
    const rule = { id: 'r1', name: 'Rule' };
    const group1 = { id: 'g1', rule_id: 'r1' };
    const group2 = { id: 'g2', rule_id: 'r1' };
    const cond1 = { id: 'c1', group_id: 'g1' };
    const cond2 = { id: 'c2', group_id: 'g2' };
    const cond3 = { id: 'c3', group_id: 'g1' };

    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ data: [rule], err: null })
      .mockResolvedValueOnce({ data: [group1, group2], err: null })
      .mockResolvedValueOnce({ data: [cond1, cond2, cond3], err: null });

    const result = await getRuleById('r1');
    const groups = (result.data as any).condition_groups;
    expect(groups[0].conditions).toHaveLength(2); // g1 has cond1 + cond3
    expect(groups[1].conditions).toHaveLength(1); // g2 has cond2
  });
});

// ---------------------------------------------------------------------------
// createRule
// ---------------------------------------------------------------------------
describe('createRule', () => {
  it('throws when unauthenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(createRule({ name: 'r' })).rejects.toThrow('Unauthorized');
  });

  it('throws when verifyRuleInput fails', async () => {
    (verifyRuleInput as jest.Mock).mockReturnValue({ success: false, err: 'Name required' });
    await expect(createRule({})).rejects.toThrow('Name required');
  });

  it('throws when dataCollector exec fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB write error', data: null });
    await expect(createRule({ name: 'r' })).rejects.toThrow();
  });

  it('returns message and id on success', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: {} });
    const result = await createRule({ name: 'My Rule' });
    expect(result).toMatchObject({ message: 'Rule created!', id: expect.any(String) });
  });

  it('inserts into openlit_rules table', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: {} });
    await createRule({ name: 'r' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('INSERT INTO openlit_rules');
  });
});

// ---------------------------------------------------------------------------
// updateRule
// ---------------------------------------------------------------------------
describe('updateRule', () => {
  it('throws when unauthenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(updateRule('r1', { name: 'r' })).rejects.toThrow('Unauthorized');
  });

  it('throws when verifyRuleInput fails', async () => {
    (verifyRuleInput as jest.Mock).mockReturnValue({ success: false, err: 'Invalid' });
    await expect(updateRule('r1', {})).rejects.toThrow('Invalid');
  });

  it('throws when exec fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB error', data: null });
    await expect(updateRule('r1', { name: 'r' })).rejects.toThrow();
  });

  it('returns RULE_UPDATED message on success', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'q1' } });
    const result = await updateRule('r1', { name: 'Updated' });
    expect(result).toEqual({ message: 'Rule updated!' });
  });

  it('includes the rule id in the query', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'q1' } });
    await updateRule('rule-abc', { name: 'r' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('rule-abc');
  });
});

// ---------------------------------------------------------------------------
// deleteRule
// ---------------------------------------------------------------------------
describe('deleteRule', () => {
  it('throws when unauthenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(deleteRule('r1')).rejects.toThrow('Unauthorized');
  });

  it('returns error array when delete fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB error' });
    const result = await deleteRule('r1');
    expect(result).toEqual(['Rule not deleted']);
  });

  it('returns [undefined, success message] on success', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    const result = await deleteRule('r1');
    expect(result).toEqual([undefined, 'Rule deleted!']);
  });

  it('deletes from all 4 related tables in parallel', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deleteRule('r1');
    expect(dataCollector).toHaveBeenCalledTimes(4);
    const queries = (dataCollector as jest.Mock).mock.calls.map((c: any[]) => c[0].query);
    expect(queries.some((q: string) => q.includes('openlit_rules'))).toBe(true);
    expect(queries.some((q: string) => q.includes('openlit_rule_condition_groups'))).toBe(true);
    expect(queries.some((q: string) => q.includes('openlit_rule_conditions'))).toBe(true);
    expect(queries.some((q: string) => q.includes('openlit_rule_entities'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addConditionGroupsToRule
// ---------------------------------------------------------------------------
describe('addConditionGroupsToRule', () => {
  it('throws when unauthenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(addConditionGroupsToRule('r1', [])).rejects.toThrow('Unauthorized');
  });

  it('throws when verifyConditionGroupInput fails', async () => {
    (verifyConditionGroupInput as jest.Mock).mockReturnValue({ success: false, err: 'Invalid group' });
    await expect(
      addConditionGroupsToRule('r1', [{ conditions: [] as any }])
    ).rejects.toThrow('Invalid group');
  });

  it('deletes existing groups then inserts new ones', async () => {
    const group = {
      condition_operator: 'AND',
      conditions: [{ field: 'cost', operator: 'gt', value: '5', data_type: 'number' }],
    };
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await addConditionGroupsToRule('r1', [group as any]);
    // At least 2 deletes + 1 group insert + 1 conditions insert
    expect(dataCollector).toHaveBeenCalledTimes(4);
  });

  it('throws when group insert fails', async () => {
    const group = { condition_operator: 'AND', conditions: [{ field: 'f', operator: 'equals', value: 'v' }] };
    (dataCollector as jest.Mock)
      .mockResolvedValueOnce({ err: null }) // delete groups
      .mockResolvedValueOnce({ err: null }) // delete conditions
      .mockResolvedValueOnce({ err: 'Insert group error' }); // insert group fails
    await expect(addConditionGroupsToRule('r1', [group as any])).rejects.toThrow();
  });

  it('returns success message when no conditions in group', async () => {
    // Empty conditions array in group (but verifyConditionGroupInput is mocked to pass)
    const group = { condition_operator: 'AND', conditions: [] };
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    const result = await addConditionGroupsToRule('r1', [group as any]);
    expect(result).toEqual({ message: 'Group added!' });
  });

  it('returns success message when all inserts succeed', async () => {
    const group = { condition_operator: 'OR', conditions: [{ field: 'f', operator: 'equals', value: 'v' }] };
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    const result = await addConditionGroupsToRule('r1', [group as any]);
    expect(result).toEqual({ message: 'Group added!' });
  });
});

// ---------------------------------------------------------------------------
// addRuleEntity
// ---------------------------------------------------------------------------
describe('addRuleEntity', () => {
  it('throws when unauthenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(addRuleEntity({ rule_id: 'r1', entity_type: 'context', entity_id: 'e1' })).rejects.toThrow('Unauthorized');
  });

  it('throws when verifyEntityInput fails', async () => {
    (verifyEntityInput as jest.Mock).mockReturnValue({ success: false, err: 'Invalid entity' });
    await expect(addRuleEntity({})).rejects.toThrow('Invalid entity');
  });

  it('throws when dataCollector insert fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'Insert error' });
    await expect(addRuleEntity({ rule_id: 'r1', entity_type: 'context', entity_id: 'e1' })).rejects.toThrow();
  });

  it('returns success message on success', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    const result = await addRuleEntity({ rule_id: 'r1', entity_type: 'context', entity_id: 'e1' });
    expect(result).toEqual({ message: 'Entity associated!' });
  });

  it('inserts into openlit_rule_entities table', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await addRuleEntity({ rule_id: 'r1', entity_type: 'context', entity_id: 'e1' });
    const [{ table }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(table).toBe('openlit_rule_entities');
  });
});

// ---------------------------------------------------------------------------
// deleteRuleEntity
// ---------------------------------------------------------------------------
describe('deleteRuleEntity', () => {
  it('throws when unauthenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(deleteRuleEntity('e1')).rejects.toThrow('Unauthorized');
  });

  it('returns error array when delete fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'Delete error' });
    const result = await deleteRuleEntity('e1');
    expect(result).toEqual(['Entity not deleted']);
  });

  it('returns [undefined, success message] on success', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    const result = await deleteRuleEntity('e1');
    expect(result).toEqual([undefined, 'Entity deleted!']);
  });

  it('includes entity id in the delete query', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deleteRuleEntity('entity-xyz');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('entity-xyz');
    expect(query).toContain('openlit_rule_entities');
  });
});

// ---------------------------------------------------------------------------
// getRuleEntities
// ---------------------------------------------------------------------------
describe('getRuleEntities', () => {
  it('throws when unauthenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getRuleEntities()).rejects.toThrow('Unauthorized');
  });

  it('queries without WHERE when no filters provided', async () => {
    await getRuleEntities();
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).not.toContain('WHERE');
  });

  it('queries with rule_id filter', async () => {
    await getRuleEntities({ rule_id: 'r-1' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('rule_id');
    expect(query).toContain('r-1');
  });

  it('queries with entity_type filter', async () => {
    await getRuleEntities({ entity_type: 'context' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('entity_type');
    expect(query).toContain('context');
  });

  it('queries with entity_id filter', async () => {
    await getRuleEntities({ entity_id: 'e-99' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('entity_id');
    expect(query).toContain('e-99');
  });

  it('queries with id filter', async () => {
    await getRuleEntities({ id: 'id-1' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("id = ");
    expect(query).toContain('id-1');
  });

  it('combines multiple filters with AND', async () => {
    await getRuleEntities({ rule_id: 'r1', entity_type: 'context' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('AND');
  });

  it('returns dataCollector result', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ id: 'e1' }], err: null });
    const result = await getRuleEntities({ rule_id: 'r1' });
    expect(result).toEqual({ data: [{ id: 'e1' }], err: null });
  });
});
