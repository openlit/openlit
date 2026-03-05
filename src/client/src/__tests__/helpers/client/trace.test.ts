import {
  integerParser,
  floatParser,
  getTraceMappingKeyFullPath,
  getExtraTabsContentTypes,
  getNormalizedTraceAttribute,
  normalizeTrace,
  findSpanInHierarchyLodash,
  getSpanDurationDisplay,
  getSpanCostFormatted,
  getSpanTooltipText,
} from '@/helpers/client/trace';
import { TraceMapping } from '@/constants/traces';

describe('integerParser', () => {
  it('parses a string integer', () => {
    expect(integerParser('42')).toBe(42);
  });

  it('returns 0 for empty string', () => {
    expect(integerParser('')).toBe(0);
  });

  it('applies offset multiplier', () => {
    expect(integerParser('5', 10)).toBe(50);
  });

  it('truncates decimals', () => {
    expect(integerParser('3.9')).toBe(3);
  });

  it('handles undefined/null by treating as 0', () => {
    expect(integerParser(undefined as any)).toBe(0);
  });
});

describe('floatParser', () => {
  it('parses a string float', () => {
    expect(floatParser('3.14')).toBeCloseTo(3.14);
  });

  it('returns 0 for empty string', () => {
    expect(floatParser('')).toBe(0);
  });

  it('applies offset multiplier', () => {
    expect(floatParser('2.5', 2)).toBeCloseTo(5.0);
  });

  it('handles undefined/null by treating as 0', () => {
    expect(floatParser(undefined as any)).toBe(0);
  });
});

// Keys with array prefix/path added at runtime to cover dead-code-looking branches
const ARRAY_PREFIX_KEY = '_test_array_prefix' as any;
const ARRAY_PATH_WITH_PREFIX_KEY = '_test_array_path_prefix' as any;

describe('getTraceMappingKeyFullPath', () => {
  it('returns the path string for a root key with no prefix', () => {
    // 'time' has path: "Timestamp", isRoot: true, no prefix
    const result = getTraceMappingKeyFullPath('time');
    expect(result).toBe('Timestamp');
  });

  it('returns joined dot-path for a prefixed key', () => {
    // 'provider' has path: "system", prefix: "gen_ai"
    const result = getTraceMappingKeyFullPath('provider');
    expect(result).toBe('gen_ai.system');
  });

  it('joins array paths with dots when no prefix', () => {
    // 'prompt' has path: ["Events.Attributes", "0", "gen_ai.prompt"], isRoot: true
    const result = getTraceMappingKeyFullPath('prompt');
    expect(result).toBe('Events.Attributes.0.gen_ai.prompt');
  });

  it('returns array when shouldReturnArray is true for prefixed key', () => {
    // 'model' has path: "request.model", prefix: "gen_ai"
    const result = getTraceMappingKeyFullPath('model', true);
    expect(Array.isArray(result)).toBe(true);
    const arr = result as string[];
    expect(arr[0]).toBe('gen_ai');
    expect(arr[1]).toBe('request.model');
  });

  it('returns path as-is for array path with shouldReturnArray true and no prefix', () => {
    // 'prompt' has array path, no prefix
    const result = getTraceMappingKeyFullPath('prompt', true);
    expect(Array.isArray(result)).toBe(true);
  });

  describe('array prefix and path branches (runtime-patched TraceMapping)', () => {
    beforeAll(() => {
      (TraceMapping as any)[ARRAY_PREFIX_KEY] = {
        prefix: ['gen_ai', 'extra'],
        path: 'value',
        label: 'Test',
        type: 'string',
        isRoot: false,
      };
      (TraceMapping as any)[ARRAY_PATH_WITH_PREFIX_KEY] = {
        prefix: 'gen_ai',
        path: ['request', 'model'],
        label: 'Test2',
        type: 'string',
        isRoot: false,
      };
    });

    afterAll(() => {
      delete (TraceMapping as any)[ARRAY_PREFIX_KEY];
      delete (TraceMapping as any)[ARRAY_PATH_WITH_PREFIX_KEY];
    });

    it('handles array prefix with shouldReturnArray=true (covers lines 81-82)', () => {
      const result = getTraceMappingKeyFullPath(ARRAY_PREFIX_KEY, true);
      expect(Array.isArray(result)).toBe(true);
      const arr = result as string[];
      expect(arr).toContain('gen_ai');
      expect(arr).toContain('extra');
      expect(arr).toContain('value');
    });

    it('handles array prefix with shouldReturnArray=false (covers lines 96-97)', () => {
      const result = getTraceMappingKeyFullPath(ARRAY_PREFIX_KEY);
      expect(typeof result).toBe('string');
      expect(result as string).toBe('gen_ai.extra.value');
    });

    it('handles string prefix with array path and shouldReturnArray=true (covers lines 87-88)', () => {
      const result = getTraceMappingKeyFullPath(ARRAY_PATH_WITH_PREFIX_KEY, true);
      expect(Array.isArray(result)).toBe(true);
      const arr = result as string[];
      expect(arr).toContain('gen_ai');
      expect(arr).toContain('request');
      expect(arr).toContain('model');
    });

    it('handles string prefix with array path and shouldReturnArray=false (covers lines 102-106)', () => {
      const result = getTraceMappingKeyFullPath(ARRAY_PATH_WITH_PREFIX_KEY);
      expect(typeof result).toBe('string');
      expect(result as string).toBe('gen_ai.request.model');
    });
  });
});

describe('getExtraTabsContentTypes', () => {
  it('returns ["Evaluation"] for chat operation type', () => {
    const trace = { type: 'chat' } as any;
    expect(getExtraTabsContentTypes(trace)).toContain('Evaluation');
  });

  it('returns empty array for unsupported operation types', () => {
    const trace = { type: 'embedding' } as any;
    expect(getExtraTabsContentTypes(trace)).toEqual([]);
  });

  it('returns empty array when type is undefined', () => {
    const trace = {} as any;
    expect(getExtraTabsContentTypes(trace)).toEqual([]);
  });
});

describe('getNormalizedTraceAttribute', () => {
  it('parses integer type attributes', () => {
    // promptTokens has type: "integer"
    const result = getNormalizedTraceAttribute('promptTokens', '100');
    expect(result).toBe(100);
  });

  it('parses float type attributes', () => {
    // requestDuration has type: "float" with offset: 10e-10
    const result = getNormalizedTraceAttribute('requestDuration', '1.5');
    expect(typeof result).toBe('string');
    // result is (1.5 * 10e-10).toFixed(10) — a small number string
    expect(parseFloat(result as string)).toBeGreaterThanOrEqual(0);
  });

  it('parses round type attributes', () => {
    // cost has type: "round"
    const result = getNormalizedTraceAttribute('cost', 0.0012345);
    expect(typeof result).toBe('string');
  });

  it('parses date type attributes', () => {
    // time has type: "date"
    const result = getNormalizedTraceAttribute('time', '2024-01-15T10:30:00.000Z');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('2024');
  });

  it('appends Z suffix when date string does not end with Z (covers line 36)', () => {
    // date without Z suffix — the "Z" branch of the ternary
    const result = getNormalizedTraceAttribute('time', '2024-01-15 10:30:00');
    expect(typeof result).toBe('string');
    expect(result as string).toContain('2024');
  });

  it('returns string value for text type (no special type)', () => {
    // provider has type: "string"
    const result = getNormalizedTraceAttribute('provider', 'openai');
    expect(result).toBe('openai');
  });

  it('returns defaultValue "-" when traceValue is falsy for a key with defaultValue', () => {
    // cost has defaultValue: "-"
    const result = getNormalizedTraceAttribute('cost', '');
    expect(result).toBe('-');
  });

  it('returns defaultValue "-" when traceValue is null for a key with defaultValue', () => {
    // promptTokens has defaultValue: "-"
    const result = getNormalizedTraceAttribute('promptTokens', null);
    expect(result).toBe('-');
  });

  it('returns undefined when traceValue is falsy for a key with no defaultValue', () => {
    // provider has no defaultValue field
    const result = getNormalizedTraceAttribute('provider', '');
    expect(result).toBeUndefined();
  });
});

describe('normalizeTrace', () => {
  it('maps TraceRow fields to TransformedTraceRow', () => {
    const trace = {
      SpanId: 'span-1',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SpanAttributes: {
        'gen_ai.system': 'openai',
        'gen_ai.request.model': 'gpt-4',
        'gen_ai.usage.prompt_tokens': '100',
        'gen_ai.usage.completion_tokens': '50',
      },
    } as any;

    const result = normalizeTrace(trace);
    expect(result).toHaveProperty('provider');
    expect(result).toHaveProperty('model');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4');
  });

  it('fills in defaultValues for missing attributes', () => {
    const trace = {
      SpanId: 'span-2',
      Timestamp: '2024-01-15T10:30:00.000Z',
      SpanAttributes: {},
    } as any;

    const result = normalizeTrace(trace);
    // Keys with defaultValue get '-', keys without defaultValue get undefined
    expect(result.cost).toBe('-');
    expect(result.promptTokens).toBe('-');
  });
});

describe('getSpanDurationDisplay', () => {
  const makeSpan = (Duration: string) => ({ Duration, SpanId: 's', SpanName: 'test', Cost: 0, children: [] } as any);

  it('returns formatted duration string', () => {
    const result = getSpanDurationDisplay(makeSpan('1500000000'));
    expect(typeof result).toBe('string');
    expect(result).toContain('s');
  });

  it('returns "0.00s" for zero duration', () => {
    const result = getSpanDurationDisplay(makeSpan('0'));
    expect(result).toMatch(/0\.00/);
  });
});

describe('getSpanCostFormatted', () => {
  const makeSpan = (Cost: number | null) => ({ Cost, SpanId: 's', SpanName: 'test', Duration: '0', children: [] } as any);

  it('returns formatted cost string when cost > 0', () => {
    const result = getSpanCostFormatted(makeSpan(0.001234));
    expect(result).toBe('$0.001234');
  });

  it('returns null when cost is 0', () => {
    expect(getSpanCostFormatted(makeSpan(0))).toBeNull();
  });

  it('returns null when cost is null', () => {
    expect(getSpanCostFormatted(makeSpan(null))).toBeNull();
  });

  it('returns null when cost is negative', () => {
    expect(getSpanCostFormatted(makeSpan(-1))).toBeNull();
  });

  it('uses custom precision', () => {
    const result = getSpanCostFormatted(makeSpan(0.1), 2);
    expect(result).toBe('$0.10');
  });
});

describe('getSpanTooltipText', () => {
  const makeSpan = (SpanName: string, Cost: number | null, Duration: string) =>
    ({ SpanName, Cost, Duration, SpanId: 's', children: [] } as any);

  it('includes cost in tooltip when cost > 0', () => {
    const result = getSpanTooltipText(makeSpan('my-span', 0.005, '1500000000'));
    expect(result).toContain('my-span');
    expect(result).toContain('Cost');
    expect(result).toContain('Duration');
  });

  it('omits cost from tooltip when cost is null', () => {
    const result = getSpanTooltipText(makeSpan('my-span', null, '1500000000'));
    expect(result).toContain('my-span');
    expect(result).toContain('Duration');
    expect(result).not.toContain('Cost');
  });

  it('omits cost from tooltip when cost is 0', () => {
    const result = getSpanTooltipText(makeSpan('no-cost', 0, '0'));
    expect(result).not.toContain('Cost');
  });
});

describe('findSpanInHierarchyLodash', () => {
  const hierarchy = {
    SpanId: 'root',
    children: [
      {
        SpanId: 'child-1',
        children: [
          { SpanId: 'grandchild-1', children: [] },
        ],
      },
      { SpanId: 'child-2', children: [] },
    ],
  } as any;

  it('finds the root span', () => {
    const result = findSpanInHierarchyLodash(hierarchy, 'root');
    expect(result?.SpanId).toBe('root');
  });

  it('finds a direct child span', () => {
    const result = findSpanInHierarchyLodash(hierarchy, 'child-2');
    expect(result?.SpanId).toBe('child-2');
  });

  it('finds a grandchild span', () => {
    const result = findSpanInHierarchyLodash(hierarchy, 'grandchild-1');
    expect(result).toBeDefined();
  });

  it('returns undefined when span not found', () => {
    const result = findSpanInHierarchyLodash(hierarchy, 'nonexistent');
    expect(result).toBeUndefined();
  });

  it('returns undefined for leaf node with no children', () => {
    const leaf = { SpanId: 'leaf', children: [] } as any;
    const result = findSpanInHierarchyLodash(leaf, 'other');
    expect(result).toBeUndefined();
  });
});
