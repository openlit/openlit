import {
  integerParser,
  floatParser,
  getTraceMappingKeyFullPath,
  getExtraTabsContentTypes,
} from '@/helpers/client/trace';

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
