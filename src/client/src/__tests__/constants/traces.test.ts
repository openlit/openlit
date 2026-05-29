import {
  TraceMapping,
  ReverseTraceMapping,
  SPAN_KIND,
  SUPPORTED_EVALUATION_OPERATIONS,
} from '@/constants/traces';

describe('TraceMapping', () => {
  it('is a non-empty object', () => {
    expect(typeof TraceMapping).toBe('object');
    expect(Object.keys(TraceMapping).length).toBeGreaterThan(0);
  });

  it('each entry has a label and type', () => {
    Object.values(TraceMapping).forEach((entry) => {
      expect(entry).toHaveProperty('label');
      expect(entry).toHaveProperty('type');
    });
  });

  it('each entry has a path (string or array)', () => {
    Object.values(TraceMapping).forEach((entry) => {
      const isString = typeof entry.path === 'string';
      const isArray = Array.isArray(entry.path);
      expect(isString || isArray).toBe(true);
    });
  });

  it('has a "time" key with path "Timestamp" and isRoot true', () => {
    expect(TraceMapping.time.path).toBe('Timestamp');
    expect(TraceMapping.time.isRoot).toBe(true);
  });

  it('has a "provider" key with prefix "gen_ai"', () => {
    expect(TraceMapping.provider.prefix).toBe('gen_ai');
    expect(TraceMapping.provider.path).toBe('system');
  });

  it('has a "model" key with prefix "gen_ai" and path "request.model"', () => {
    expect(TraceMapping.model.prefix).toBe('gen_ai');
    expect(TraceMapping.model.path).toBe('request.model');
  });

  it('has a "prompt" key with an array path', () => {
    expect(Array.isArray(TraceMapping.prompt.path)).toBe(true);
  });

  it('has a "cost" key with valuePrefix "$"', () => {
    expect((TraceMapping.cost as any).valuePrefix).toBe('$');
  });

  it('has "operation" key with prefix "db"', () => {
    expect(TraceMapping.operation.prefix).toBe('db');
  });
});

describe('ReverseTraceMapping', () => {
  it('is a non-empty object', () => {
    expect(typeof ReverseTraceMapping).toBe('object');
    expect(Object.keys(ReverseTraceMapping).length).toBeGreaterThan(0);
  });

  it('maps "Timestamp" back to "time"', () => {
    expect(ReverseTraceMapping['Timestamp']).toBe('time');
  });

  it('maps "system" (gen_ai.system → key "system") back to a TraceMapping key', () => {
    // The reverse mapping uses the path value as key
    expect(ReverseTraceMapping['system']).toBeDefined();
  });

  it('all values are valid keys in TraceMapping', () => {
    Object.values(ReverseTraceMapping).forEach((key) => {
      expect(TraceMapping).toHaveProperty(key);
    });
  });
});

describe('SPAN_KIND', () => {
  it('has SPAN_KIND_INTERNAL', () => {
    expect(SPAN_KIND.SPAN_KIND_INTERNAL).toBe('SPAN_KIND_INTERNAL');
  });

  it('has SPAN_KIND_CLIENT', () => {
    expect(SPAN_KIND.SPAN_KIND_CLIENT).toBe('SPAN_KIND_CLIENT');
  });

  it('has exactly 2 entries', () => {
    expect(Object.keys(SPAN_KIND)).toHaveLength(2);
  });
});

describe('SUPPORTED_EVALUATION_OPERATIONS', () => {
  it('is an array', () => {
    expect(Array.isArray(SUPPORTED_EVALUATION_OPERATIONS)).toBe(true);
  });

  it('includes "chat"', () => {
    expect(SUPPORTED_EVALUATION_OPERATIONS).toContain('chat');
  });
});
