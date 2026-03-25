jest.mock('@/lib/platform/rule-engine/evaluate', () => ({
  evaluateRules: jest.fn(),
}));

import {
  extractRuleEngineFieldsFromTrace,
  getContextFromRuleEngineForTrace,
  getContextFromRulesWithPriority,
} from '@/lib/platform/evaluation/rule-engine-context';
import { evaluateRules } from '@/lib/platform/rule-engine/evaluate';

const makeTrace = (overrides: Record<string, any> = {}): any => ({
  ServiceName: 'my-service',
  SpanName: 'my-span',
  SpanKind: 'CLIENT',
  StatusCode: 'OK',
  ResourceAttributes: { 'deployment.environment': 'production', 'service.name': 'svc' },
  SpanAttributes: { 'gen_ai.system': 'openai', 'gen_ai.request.model': 'gpt-4' },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (evaluateRules as jest.Mock).mockResolvedValue({ matchingRuleIds: [], entities: [], entity_data: {} });
});

describe('extractRuleEngineFieldsFromTrace', () => {
  it('extracts top-level trace fields', () => {
    const fields = extractRuleEngineFieldsFromTrace(makeTrace());
    expect(fields['ServiceName']).toBe('my-service');
    expect(fields['SpanName']).toBe('my-span');
    expect(fields['SpanKind']).toBe('CLIENT');
    expect(fields['StatusCode']).toBe('OK');
  });

  it('extracts nested ResourceAttributes fields', () => {
    const fields = extractRuleEngineFieldsFromTrace(makeTrace());
    expect(fields['deployment.environment']).toBe('production');
    expect(fields['service.name']).toBe('svc');
  });

  it('extracts nested SpanAttributes fields', () => {
    const fields = extractRuleEngineFieldsFromTrace(makeTrace());
    expect(fields['gen_ai.system']).toBe('openai');
    expect(fields['gen_ai.request.model']).toBe('gpt-4');
  });

  it('skips fields with null values', () => {
    const trace = makeTrace({ ServiceName: null });
    const fields = extractRuleEngineFieldsFromTrace(trace);
    expect(fields['ServiceName']).toBeUndefined();
  });

  it('skips fields with undefined values', () => {
    const trace = makeTrace({ SpanKind: undefined });
    const fields = extractRuleEngineFieldsFromTrace(trace);
    expect(fields['SpanKind']).toBeUndefined();
  });

  it('skips fields with empty string values', () => {
    const trace = makeTrace({ SpanName: '' });
    const fields = extractRuleEngineFieldsFromTrace(trace);
    expect(fields['SpanName']).toBeUndefined();
  });

  it('returns empty object when all fields are empty', () => {
    const trace = {
      ServiceName: null,
      SpanName: '',
      SpanKind: undefined,
      StatusCode: null,
      ResourceAttributes: {},
      SpanAttributes: {},
    };
    const fields = extractRuleEngineFieldsFromTrace(trace as any);
    expect(Object.keys(fields)).toHaveLength(0);
  });

  it('converts non-primitive truthy values to string', () => {
    // Passing an object as a field value hits the else-branch String(v) on line 55
    const trace = makeTrace({ ServiceName: { toString: () => 'obj-service' } as any });
    const fields = extractRuleEngineFieldsFromTrace(trace);
    expect(typeof fields['ServiceName']).toBe('string');
  });

  it('converts deployment.environment from SpanAttributes as fallback', () => {
    const trace = makeTrace({
      ResourceAttributes: {},
      SpanAttributes: { 'deployment.environment': 'staging', 'gen_ai.system': 'anthropic', 'gen_ai.request.model': 'claude-3' },
    });
    const fields = extractRuleEngineFieldsFromTrace(trace);
    expect(fields['deployment.environment']).toBe('staging');
  });
});

describe('getContextFromRuleEngineForTrace', () => {
  it('returns empty result when no fields extracted', async () => {
    const trace = { ServiceName: null, SpanName: '', SpanKind: undefined, StatusCode: null, ResourceAttributes: {}, SpanAttributes: {} };
    const result = await getContextFromRuleEngineForTrace(trace as any);
    expect(result).toEqual({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] });
    expect(evaluateRules).not.toHaveBeenCalled();
  });

  it('calls evaluateRules with correct parameters', async () => {
    await getContextFromRuleEngineForTrace(makeTrace(), 'db-1');
    expect(evaluateRules).toHaveBeenCalledWith(
      expect.objectContaining({ entity_type: 'context', include_entity_data: true }),
      'db-1'
    );
  });

  it('returns empty contextContents when entity_data is missing', async () => {
    (evaluateRules as jest.Mock).mockResolvedValue({ matchingRuleIds: ['r1'], entities: [] });
    const result = await getContextFromRuleEngineForTrace(makeTrace());
    expect(result.contextContents).toEqual([]);
    expect(result.matchingRuleIds).toEqual(['r1']);
    expect(result.contextEntityIds).toEqual([]);
  });

  it('extracts context content from entity_data', async () => {
    (evaluateRules as jest.Mock).mockResolvedValue({
      matchingRuleIds: ['r1'],
      entities: [{ rule_id: 'r1', entity_type: 'context', entity_id: 'ctx-1' }],
      entity_data: { 'context:ctx-1': { id: 'ctx-1', content: 'hello world' } },
    });
    const result = await getContextFromRuleEngineForTrace(makeTrace());
    expect(result.contextContents).toEqual(['hello world']);
    expect(result.contextEntityIds).toEqual(['ctx-1']);
    expect(result.matchingRuleIds).toEqual(['r1']);
  });

  it('skips entity_data entries without content', async () => {
    (evaluateRules as jest.Mock).mockResolvedValue({
      matchingRuleIds: ['r1'],
      entities: [],
      entity_data: { 'context:ctx-1': { id: 'ctx-1' } },
    });
    const result = await getContextFromRuleEngineForTrace(makeTrace());
    expect(result.contextContents).toEqual([]);
    expect(result.contextEntityIds).toEqual([]);
  });

  it('returns empty result when evaluateRules throws', async () => {
    (evaluateRules as jest.Mock).mockRejectedValue(new Error('DB error'));
    const result = await getContextFromRuleEngineForTrace(makeTrace());
    expect(result).toEqual({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] });
  });
});

describe('getContextFromRulesWithPriority', () => {
  it('returns raw result when rulesWithPriority is empty', async () => {
    (evaluateRules as jest.Mock).mockResolvedValue({
      matchingRuleIds: ['r1'],
      entities: [],
      entity_data: { 'context:ctx-1': { content: 'base content' } },
    });
    const result = await getContextFromRulesWithPriority(makeTrace(), []);
    expect(result.matchingRuleIds).toContain('r1');
  });

  it('returns result from getContextFromRuleEngineForTrace when no matching rules in priority list', async () => {
    (evaluateRules as jest.Mock).mockResolvedValue({
      matchingRuleIds: ['r99'],
      entities: [],
      entity_data: {},
    });
    const result = await getContextFromRulesWithPriority(makeTrace(), [{ ruleId: 'r1', priority: 1 }]);
    // none of the prioritized rules matched, so returns the original result
    expect(result.matchingRuleIds).toEqual(['r99']);
  });

  it('re-fetches and orders context by priority', async () => {
    // First call for getContextFromRuleEngineForTrace (matching r1 and r2)
    (evaluateRules as jest.Mock)
      .mockResolvedValueOnce({
        matchingRuleIds: ['r1', 'r2'],
        entities: [],
        entity_data: {},
      })
      // Second call for re-fetch with entity data
      .mockResolvedValueOnce({
        matchingRuleIds: ['r1', 'r2'],
        entities: [
          { rule_id: 'r1', entity_type: 'context', entity_id: 'ctx-1' },
          { rule_id: 'r2', entity_type: 'context', entity_id: 'ctx-2' },
        ],
        entity_data: {
          'context:ctx-1': { content: 'low priority content' },
          'context:ctx-2': { content: 'high priority content' },
        },
      });

    const result = await getContextFromRulesWithPriority(makeTrace(), [
      { ruleId: 'r1', priority: 1 },
      { ruleId: 'r2', priority: 10 },
    ]);

    // r2 has higher priority so its content should come first
    expect(result.contextContents[0]).toBe('high priority content');
    expect(result.contextContents[1]).toBe('low priority content');
    expect(result.matchingRuleIds).toEqual(['r2', 'r1']);
  });

  it('returns empty result when re-fetch has no entity_data', async () => {
    (evaluateRules as jest.Mock)
      .mockResolvedValueOnce({ matchingRuleIds: ['r1'], entities: [], entity_data: {} })
      .mockResolvedValueOnce({ matchingRuleIds: ['r1'], entities: undefined, entity_data: undefined });

    const result = await getContextFromRulesWithPriority(makeTrace(), [{ ruleId: 'r1', priority: 5 }]);
    expect(result.contextContents).toEqual([]);
    expect(result.matchingRuleIds).toEqual(['r1']);
  });

  it('returns original result when second evaluateRules throws', async () => {
    (evaluateRules as jest.Mock)
      .mockResolvedValueOnce({
        matchingRuleIds: ['r1'],
        entities: [],
        entity_data: { 'context:ctx-x': { content: 'fallback' } },
      })
      .mockRejectedValueOnce(new Error('second fetch failed'));

    const result = await getContextFromRulesWithPriority(makeTrace(), [{ ruleId: 'r1', priority: 5 }]);
    expect(result.matchingRuleIds).toContain('r1');
  });

  it('returns empty when trace has no fields (even with priority rules)', async () => {
    const emptyTrace = { ServiceName: null, SpanName: '', SpanKind: undefined, StatusCode: null, ResourceAttributes: {}, SpanAttributes: {} };
    const result = await getContextFromRulesWithPriority(emptyTrace as any, [{ ruleId: 'r1', priority: 5 }]);
    expect(result).toEqual({ contextContents: [], matchingRuleIds: [], contextEntityIds: [] });
  });
});
