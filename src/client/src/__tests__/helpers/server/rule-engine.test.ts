import {
  verifyRuleInput,
  verifyConditionInput,
  verifyConditionGroupInput,
  verifyEntityInput,
} from '@/helpers/server/rule-engine';

describe('verifyRuleInput', () => {
  it('returns error when name is missing', () => {
    expect(verifyRuleInput({})).toMatchObject({ success: false, err: expect.any(String) });
  });

  it('returns error when name is only whitespace', () => {
    expect(verifyRuleInput({ name: '   ' })).toMatchObject({ success: false });
  });

  it('returns error for invalid group_operator', () => {
    expect(verifyRuleInput({ name: 'r', group_operator: 'INVALID' as any })).toMatchObject({ success: false });
  });

  it('returns error for invalid status', () => {
    expect(verifyRuleInput({ name: 'r', status: 'UNKNOWN' as any })).toMatchObject({ success: false });
  });

  it('returns success for valid minimal input', () => {
    expect(verifyRuleInput({ name: 'My Rule' })).toEqual({ success: true });
  });

  it('returns success for AND group_operator', () => {
    expect(verifyRuleInput({ name: 'r', group_operator: 'AND' })).toEqual({ success: true });
  });

  it('returns success for OR group_operator', () => {
    expect(verifyRuleInput({ name: 'r', group_operator: 'OR' })).toEqual({ success: true });
  });

  it('returns success for ACTIVE status', () => {
    expect(verifyRuleInput({ name: 'r', status: 'ACTIVE' })).toEqual({ success: true });
  });

  it('returns success for INACTIVE status', () => {
    expect(verifyRuleInput({ name: 'r', status: 'INACTIVE' })).toEqual({ success: true });
  });

  it('returns success for full valid input', () => {
    expect(verifyRuleInput({ name: 'My Rule', group_operator: 'AND', status: 'ACTIVE' })).toEqual({ success: true });
  });
});

describe('verifyConditionInput', () => {
  it('returns error when field is missing', () => {
    expect(verifyConditionInput({})).toMatchObject({ success: false });
  });

  it('returns error when field is whitespace', () => {
    expect(verifyConditionInput({ field: '  ' })).toMatchObject({ success: false });
  });

  it('returns error when operator is missing', () => {
    expect(verifyConditionInput({ field: 'cost' })).toMatchObject({ success: false });
  });

  it('returns error for invalid operator', () => {
    expect(verifyConditionInput({ field: 'cost', operator: 'INVALID' as any })).toMatchObject({ success: false });
  });

  it('returns error when value is missing', () => {
    expect(verifyConditionInput({ field: 'cost', operator: 'equals' as any })).toMatchObject({ success: false });
  });

  it('returns error when value is empty string', () => {
    expect(verifyConditionInput({ field: 'cost', operator: 'equals' as any, value: '   ' })).toMatchObject({ success: false });
  });

  it('returns success for valid input', () => {
    expect(verifyConditionInput({ field: 'cost', operator: 'equals' as any, value: '10' })).toEqual({ success: true });
  });

  it.each([
    'equals', 'not_equals', 'contains', 'not_contains',
    'starts_with', 'ends_with', 'regex', 'in', 'not_in',
    'gt', 'gte', 'lt', 'lte', 'between',
  ])('returns success for operator: %s', (op) => {
    expect(verifyConditionInput({ field: 'f', operator: op as any, value: 'v' })).toEqual({ success: true });
  });
});

describe('verifyConditionGroupInput', () => {
  it('returns error when conditions is missing', () => {
    expect(verifyConditionGroupInput({})).toMatchObject({ success: false });
  });

  it('returns error when conditions is an empty array', () => {
    expect(verifyConditionGroupInput({ conditions: [] })).toMatchObject({ success: false });
  });

  it('returns error when a condition in the group is invalid', () => {
    expect(
      verifyConditionGroupInput({ conditions: [{ field: '', operator: 'equals' as any, value: 'x' }] })
    ).toMatchObject({ success: false });
  });

  it('returns success for a group with one valid condition', () => {
    expect(
      verifyConditionGroupInput({ conditions: [{ field: 'cost', operator: 'gt' as any, value: '5' }] })
    ).toEqual({ success: true });
  });

  it('returns success for a group with multiple valid conditions', () => {
    expect(
      verifyConditionGroupInput({
        conditions: [
          { field: 'cost', operator: 'gt' as any, value: '5' },
          { field: 'model', operator: 'equals' as any, value: 'gpt-4' },
        ],
      })
    ).toEqual({ success: true });
  });

  it('returns error if any condition in the group is invalid', () => {
    expect(
      verifyConditionGroupInput({
        conditions: [
          { field: 'cost', operator: 'gt' as any, value: '5' },
          { field: '', operator: 'equals' as any, value: 'x' }, // invalid
        ],
      })
    ).toMatchObject({ success: false });
  });
});

describe('verifyEntityInput', () => {
  it('returns error when rule_id is missing', () => {
    expect(verifyEntityInput({})).toMatchObject({ success: false });
  });

  it('returns error when rule_id is empty', () => {
    expect(verifyEntityInput({ rule_id: '  ' })).toMatchObject({ success: false });
  });

  it('returns error when entity_type is missing', () => {
    expect(verifyEntityInput({ rule_id: 'r-1' })).toMatchObject({ success: false });
  });

  it('returns error for invalid entity_type', () => {
    expect(verifyEntityInput({ rule_id: 'r-1', entity_type: 'unknown' as any })).toMatchObject({ success: false });
  });

  it('returns error when entity_id is missing', () => {
    expect(verifyEntityInput({ rule_id: 'r-1', entity_type: 'context' })).toMatchObject({ success: false });
  });

  it('returns error when entity_id is empty', () => {
    expect(verifyEntityInput({ rule_id: 'r-1', entity_type: 'context', entity_id: '  ' })).toMatchObject({ success: false });
  });

  it('returns success for context entity type', () => {
    expect(verifyEntityInput({ rule_id: 'r-1', entity_type: 'context', entity_id: 'ctx-1' })).toEqual({ success: true });
  });

  it('returns success for prompt entity type', () => {
    expect(verifyEntityInput({ rule_id: 'r-1', entity_type: 'prompt', entity_id: 'p-1' })).toEqual({ success: true });
  });

  it('returns success for evaluation entity type', () => {
    expect(verifyEntityInput({ rule_id: 'r-1', entity_type: 'evaluation', entity_id: 'e-1' })).toEqual({ success: true });
  });
});
