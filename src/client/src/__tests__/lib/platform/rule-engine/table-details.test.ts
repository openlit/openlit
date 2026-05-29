import {
  OPENLIT_RULES_TABLE_NAME,
  OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME,
  OPENLIT_RULE_CONDITIONS_TABLE_NAME,
  OPENLIT_RULE_ENTITIES_TABLE_NAME,
} from '@/lib/platform/rule-engine/table-details';

describe('rule-engine table-details', () => {
  it('OPENLIT_RULES_TABLE_NAME is correct', () => {
    expect(OPENLIT_RULES_TABLE_NAME).toBe('openlit_rules');
  });

  it('OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME is correct', () => {
    expect(OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME).toBe('openlit_rule_condition_groups');
  });

  it('OPENLIT_RULE_CONDITIONS_TABLE_NAME is correct', () => {
    expect(OPENLIT_RULE_CONDITIONS_TABLE_NAME).toBe('openlit_rule_conditions');
  });

  it('OPENLIT_RULE_ENTITIES_TABLE_NAME is correct', () => {
    expect(OPENLIT_RULE_ENTITIES_TABLE_NAME).toBe('openlit_rule_entities');
  });

  it('all table names are non-empty strings', () => {
    const names = [
      OPENLIT_RULES_TABLE_NAME,
      OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME,
      OPENLIT_RULE_CONDITIONS_TABLE_NAME,
      OPENLIT_RULE_ENTITIES_TABLE_NAME,
    ];
    names.forEach((n) => {
      expect(typeof n).toBe('string');
      expect(n.length).toBeGreaterThan(0);
    });
  });

  it('all table names are unique', () => {
    const names = [
      OPENLIT_RULES_TABLE_NAME,
      OPENLIT_RULE_CONDITION_GROUPS_TABLE_NAME,
      OPENLIT_RULE_CONDITIONS_TABLE_NAME,
      OPENLIT_RULE_ENTITIES_TABLE_NAME,
    ];
    expect(new Set(names).size).toBe(names.length);
  });
});
