import {
  validateMetricsRequest,
  validateMetricsRequestType,
  getFilterWhereCondition,
  getFilterPreviousParams,
  getFilterWhereConditionForGPU,
  dateTruncGroupingLogic,
} from '@/helpers/server/platform';
import { addDays, addMonths } from 'date-fns';

// ─── validateMetricsRequest ────────────────────────────────────────────────────

const withTimeLimit = {
  timeLimit: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
};

describe('validateMetricsRequest', () => {
  describe('types requiring only timeLimit', () => {
    const timeLimitTypes = [
      'REQUEST_PER_TIME',
      'GET_ALL',
      'TOTAL_COST',
      'AVERAGE_REQUEST_COST',
      'COST_BY_APPLICATION',
      'COST_BY_ENVIRONMENT',
      'MODEL_PER_TIME',
      'GENERATION_BY_CATEGORY',
      'TOKENS_PER_TIME',
      'GENERATION_BY_ENDPOINT',
      'AVERAGE_MEMORY_USAGE',
      'MEMORY_PER_TIME',
      'AVERAGE_TEMPERATURE',
      'TEMPERATURE_PER_TIME',
      'AVERAGE_POWER_DRAW',
      'POWER_PER_TIME',
      'FANSPEED_PER_TIME',
      'GENERATION_BY_OPERATION',
      'GENERATION_BY_SYSTEM',
      'GENERATION_BY_ENVIRONMENT',
      'GENERATION_BY_APPLICATION',
      'GET_TOTAL_EVALUATION_DETECTED',
    ] as const;

    timeLimitTypes.forEach((type) => {
      it(`${type}: succeeds with valid timeLimit`, () => {
        const result = validateMetricsRequest(
          withTimeLimit,
          validateMetricsRequestType[type]
        );
        expect(result.success).toBe(true);
      });

      it(`${type}: fails when timeLimit.start is missing`, () => {
        const result = validateMetricsRequest(
          { timeLimit: { end: new Date() } },
          validateMetricsRequestType[type]
        );
        expect(result.success).toBe(false);
        expect(result.err).toMatch(/Start date|End date/i);
      });

      it(`${type}: fails when timeLimit is absent`, () => {
        const result = validateMetricsRequest({}, validateMetricsRequestType[type]);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('TOP_MODELS', () => {
    it('fails when timeLimit is missing', () => {
      const result = validateMetricsRequest(
        { top: 5 },
        validateMetricsRequestType.TOP_MODELS
      );
      expect(result.success).toBe(false);
      expect(result.err).toMatch(/Start date|End date/i);
    });

    it('fails when top is missing', () => {
      const result = validateMetricsRequest(
        withTimeLimit,
        validateMetricsRequestType.TOP_MODELS
      );
      expect(result.success).toBe(false);
      expect(result.err).toContain('top models');
    });

    it('succeeds with valid timeLimit and top', () => {
      const result = validateMetricsRequest(
        { ...withTimeLimit, top: 10 },
        validateMetricsRequestType.TOP_MODELS
      );
      expect(result.success).toBe(true);
    });
  });

  describe('AVERAGE_REQUEST_TOKEN', () => {
    it('fails when timeLimit is missing', () => {
      const result = validateMetricsRequest(
        { type: 'input' },
        validateMetricsRequestType.AVERAGE_REQUEST_TOKEN
      );
      expect(result.success).toBe(false);
    });

    it('fails when type is missing', () => {
      const result = validateMetricsRequest(
        withTimeLimit,
        validateMetricsRequestType.AVERAGE_REQUEST_TOKEN
      );
      expect(result.success).toBe(false);
      expect(result.err).toContain('Type of token');
    });

    it('succeeds with valid timeLimit and type', () => {
      const result = validateMetricsRequest(
        { ...withTimeLimit, type: 'input' },
        validateMetricsRequestType.AVERAGE_REQUEST_TOKEN
      );
      expect(result.success).toBe(true);
    });
  });

  describe('AVERAGE_REQUEST_DURATION / TOTAL_REQUESTS', () => {
    (['AVERAGE_REQUEST_DURATION', 'TOTAL_REQUESTS'] as const).forEach((type) => {
      it(`${type}: fails when timeLimit is missing`, () => {
        const result = validateMetricsRequest(
          { operationType: 'llm' },
          validateMetricsRequestType[type]
        );
        expect(result.success).toBe(false);
      });

      it(`${type}: fails when operationType is missing`, () => {
        const result = validateMetricsRequest(
          withTimeLimit,
          validateMetricsRequestType[type]
        );
        expect(result.success).toBe(false);
        expect(result.err).toContain('Operation type');
      });

      it(`${type}: succeeds with timeLimit and operationType`, () => {
        const result = validateMetricsRequest(
          { ...withTimeLimit, operationType: 'llm' },
          validateMetricsRequestType[type]
        );
        expect(result.success).toBe(true);
      });
    });
  });

  it('returns success for unrecognised type (default case)', () => {
    const result = validateMetricsRequest({}, 'UNKNOWN_TYPE' as any);
    expect(result.success).toBe(true);
  });
});

// ─── getFilterWhereCondition ───────────────────────────────────────────────────

describe('getFilterWhereCondition', () => {
  const start = new Date('2024-01-01T00:00:00Z');
  const end = new Date('2024-01-31T00:00:00Z');
  const timeLimit = { start, end };

  it('always includes StatusCode clause', () => {
    const result = getFilterWhereCondition({} as any);
    expect(result).toContain('StatusCode IN');
  });

  it('uses custom statusCode when provided', () => {
    const result = getFilterWhereCondition({
      statusCode: ['STATUS_CODE_ERROR'],
    } as any);
    expect(result).toContain("'STATUS_CODE_ERROR'");
  });

  it('includes Timestamp range when timeLimit is provided', () => {
    const result = getFilterWhereCondition({ timeLimit } as any);
    expect(result).toContain('Timestamp >=');
    expect(result).toContain('Timestamp <=');
    expect(result).toContain('parseDateTimeBestEffort');
  });

  it('skips Timestamp range when timeLimit is absent', () => {
    const result = getFilterWhereCondition({} as any);
    expect(result).not.toContain('Timestamp >=');
  });

  it('adds model filter when filterSelectedConfig is true and models provided', () => {
    const result = getFilterWhereCondition(
      { timeLimit, selectedConfig: { models: ['gpt-4', 'gpt-3.5-turbo'] } } as any,
      true
    );
    expect(result).toContain("'gpt-4'");
    expect(result).toContain("'gpt-3.5-turbo'");
  });

  it('does not add model filter when filterSelectedConfig is false', () => {
    const result = getFilterWhereCondition(
      { timeLimit, selectedConfig: { models: ['gpt-4'] } } as any,
      false
    );
    expect(result).not.toContain("'gpt-4'");
  });

  it('adds provider filter when filterSelectedConfig is true', () => {
    const result = getFilterWhereCondition(
      { timeLimit, selectedConfig: { providers: ['openai', 'anthropic'] } } as any,
      true
    );
    expect(result).toContain("'openai'");
    expect(result).toContain("'anthropic'");
  });

  it('adds traceType filter when filterSelectedConfig is true', () => {
    const result = getFilterWhereCondition(
      { timeLimit, selectedConfig: { traceTypes: ['chat', 'embedding'] } } as any,
      true
    );
    expect(result).toContain("'chat'");
    expect(result).toContain("'embedding'");
  });

  it('adds cost filter when maxCost is provided', () => {
    const result = getFilterWhereCondition(
      { timeLimit, selectedConfig: { maxCost: 0.05 } } as any,
      true
    );
    expect(result).toContain('BETWEEN 0 AND');
  });

  it('adds applicationName filter when provided', () => {
    const result = getFilterWhereCondition(
      { timeLimit, selectedConfig: { applicationNames: ['my-app'] } } as any,
      true
    );
    expect(result).toContain("'my-app'");
  });

  it('adds environment filter when provided', () => {
    const result = getFilterWhereCondition(
      { timeLimit, selectedConfig: { environments: ['production'] } } as any,
      true
    );
    expect(result).toContain("'production'");
  });

  it('adds SpanAttributes custom filter (covers lines 250-252)', () => {
    const result = getFilterWhereCondition(
      {
        timeLimit: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
        selectedConfig: {
          customFilters: [{ attributeType: 'SpanAttributes', key: 'gen_ai.system', value: 'openai' }],
        },
      } as any,
      true
    );
    expect(result).toContain("SpanAttributes['gen_ai.system'] = 'openai'");
  });

  it('adds ResourceAttributes custom filter (covers lines 253-255)', () => {
    const result = getFilterWhereCondition(
      {
        timeLimit: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
        selectedConfig: {
          customFilters: [{ attributeType: 'ResourceAttributes', key: 'service.name', value: 'my-service' }],
        },
      } as any,
      true
    );
    expect(result).toContain("ResourceAttributes['service.name'] = 'my-service'");
  });

  it('adds Field custom filter and strips unsafe chars (covers lines 256-261)', () => {
    const result = getFilterWhereCondition(
      {
        timeLimit: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
        selectedConfig: {
          customFilters: [{ attributeType: 'Field', key: 'SpanName', value: 'my-span' }],
        },
      } as any,
      true
    );
    expect(result).toContain("SpanName = 'my-span'");
  });

  it('skips custom filter entry when key or value is empty (covers the key && value guard)', () => {
    const result = getFilterWhereCondition(
      {
        timeLimit: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
        selectedConfig: {
          customFilters: [
            { attributeType: 'SpanAttributes', key: '', value: 'openai' },
            { attributeType: 'SpanAttributes', key: 'gen_ai.system', value: '' },
          ],
        },
      } as any,
      true
    );
    expect(result).not.toContain("SpanAttributes[''");
  });

  it('skips Field custom filter when safeKey is empty after sanitization (covers the safeKey guard)', () => {
    const result = getFilterWhereCondition(
      {
        timeLimit: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
        selectedConfig: {
          customFilters: [{ attributeType: 'Field', key: '!!!', value: 'value' }],
        },
      } as any,
      true
    );
    // key '!!!' becomes '' after stripping non-alphanumeric, so condition is not added
    expect(result).not.toContain("= 'value'");
  });

  it("escapes single quotes in custom filter values (SQL injection protection)", () => {
    const result = getFilterWhereCondition(
      {
        timeLimit: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
        selectedConfig: {
          customFilters: [{ attributeType: 'SpanAttributes', key: 'gen_ai.system', value: "it's" }],
        },
      } as any,
      true
    );
    expect(result).toContain("= 'it''s'");
  });

  it('escapes single quotes in model names to prevent SQL injection', () => {
    const result = getFilterWhereCondition(
      {
        timeLimit: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
        selectedConfig: { models: ["model'; DROP TABLE traces; --"] },
      } as any,
      true
    );
    expect(result).toContain("'model''; DROP TABLE traces; --'");
    expect(result).not.toContain("model'; DROP");
  });

  it('escapes single quotes in provider names to prevent SQL injection', () => {
    const result = getFilterWhereCondition(
      {
        timeLimit: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
        selectedConfig: { providers: ["open'ai"] },
      } as any,
      true
    );
    expect(result).toContain("'open''ai'");
    expect(result).not.toContain("open'ai'");
  });

  it('escapes single quotes in environment names to prevent SQL injection', () => {
    const result = getFilterWhereCondition(
      {
        timeLimit: { start: new Date('2024-01-01'), end: new Date('2024-01-31') },
        selectedConfig: { environments: ["prod'; DROP TABLE traces; --"] },
      } as any,
      true
    );
    expect(result).toContain("'prod''; DROP TABLE traces; --'");
    expect(result).not.toContain("prod'; DROP");
  });

  it('adds notOrEmpty conditions', () => {
    const result = getFilterWhereCondition({
      notOrEmpty: [{ key: 'SpanAttributes' }, { key: 'ServiceName' }],
    } as any);
    expect(result).toContain('notEmpty(SpanAttributes)');
    expect(result).toContain('notEmpty(ServiceName)');
    expect(result).toContain(' OR ');
  });

  it('adds notEmpty conditions', () => {
    const result = getFilterWhereCondition({
      notEmpty: [{ key: 'TraceId' }],
    } as any);
    expect(result).toContain('notEmpty(TraceId)');
  });

  it('adds vectordb operationType filter', () => {
    const result = getFilterWhereCondition({
      operationType: 'vectordb',
    } as any);
    expect(result).toContain("= 'vectordb'");
  });

  it('adds not-vectordb operationType filter for non-vectordb type', () => {
    const result = getFilterWhereCondition({
      operationType: 'llm',
    } as any);
    expect(result).toContain("!= 'vectordb'");
  });

  it('joins multiple conditions with AND', () => {
    const result = getFilterWhereCondition({ timeLimit } as any);
    expect(result).toContain(' AND ');
  });

  it('returns empty string on exception (null filter)', () => {
    const result = getFilterWhereCondition(null as any);
    // Should not throw; returns whatever was built before the error
    expect(typeof result).toBe('string');
  });
});

// ─── getFilterPreviousParams ───────────────────────────────────────────────────

describe('getFilterPreviousParams', () => {
  const makeFilter = (type: string, start: Date, end: Date) => ({
    timeLimit: { type, start: start.toISOString(), end: end.toISOString() },
  });

  it('24H: shifts start and end back 1 day', () => {
    const start = new Date('2024-02-02T00:00:00Z');
    const end = new Date('2024-02-03T00:00:00Z');
    const result = getFilterPreviousParams(makeFilter('24H', start, end) as any);
    expect(new Date(result.timeLimit.start).toISOString()).toBe(
      addDays(start, -1).toISOString()
    );
    expect(new Date(result.timeLimit.end).toISOString()).toBe(
      addDays(end, -1).toISOString()
    );
  });

  it('7D: shifts start back 7 days and end back 1 day', () => {
    const start = new Date('2024-02-01T00:00:00Z');
    const end = new Date('2024-02-08T00:00:00Z');
    const result = getFilterPreviousParams(makeFilter('7D', start, end) as any);
    expect(new Date(result.timeLimit.start).toISOString()).toBe(
      addDays(start, -7).toISOString()
    );
    expect(new Date(result.timeLimit.end).toISOString()).toBe(
      addDays(end, -1).toISOString()
    );
  });

  it('1M: shifts start and end back 1 month', () => {
    const start = new Date('2024-02-01T00:00:00Z');
    const end = new Date('2024-03-01T00:00:00Z');
    const result = getFilterPreviousParams(makeFilter('1M', start, end) as any);
    expect(new Date(result.timeLimit.start).toISOString()).toBe(
      addMonths(start, -1).toISOString()
    );
    expect(new Date(result.timeLimit.end).toISOString()).toBe(
      addMonths(end, -1).toISOString()
    );
  });

  it('3M: shifts start and end back 3 months', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-04-01T00:00:00Z');
    const result = getFilterPreviousParams(makeFilter('3M', start, end) as any);
    expect(new Date(result.timeLimit.start).toISOString()).toBe(
      addMonths(start, -3).toISOString()
    );
    expect(new Date(result.timeLimit.end).toISOString()).toBe(
      addMonths(end, -3).toISOString()
    );
  });

  it('CUSTOM: shifts start and end back by diff days', () => {
    const start = new Date('2024-02-01T00:00:00Z');
    const end = new Date('2024-02-11T00:00:00Z'); // 10-day range
    const result = getFilterPreviousParams(makeFilter('CUSTOM', start, end) as any);
    expect(new Date(result.timeLimit.start).toISOString()).toBe(
      addDays(start, -10).toISOString()
    );
    expect(new Date(result.timeLimit.end).toISOString()).toBe(
      addDays(end, -10).toISOString()
    );
  });

  it('default (unknown type): returns the same filter unchanged', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-01-31T00:00:00Z');
    const filter = makeFilter('UNKNOWN', start, end);
    const result = getFilterPreviousParams(filter as any);
    expect(result.timeLimit.start).toBe(filter.timeLimit.start);
    expect(result.timeLimit.end).toBe(filter.timeLimit.end);
  });

  it('returns original filter on exception', () => {
    const filter = null;
    const result = getFilterPreviousParams(filter as any);
    expect(result).toBeNull();
  });

  it('returns unchanged filter when timeLimit is absent (covers || {} fallback on line 310)', () => {
    const filter = { selectedConfig: {} };
    const result = getFilterPreviousParams(filter as any);
    // No timeLimit → no time shift, returned as-is
    expect(result).toEqual(filter);
  });
});

// ─── getFilterWhereConditionForGPU ─────────────────────────────────────────────

describe('getFilterWhereConditionForGPU', () => {
  it('includes TimeUnix range when timeLimit is provided', () => {
    const filter = {
      timeLimit: {
        start: new Date('2024-01-01'),
        end: new Date('2024-01-31'),
      },
    };
    const result = getFilterWhereConditionForGPU(filter as any);
    expect(result).toContain('TimeUnix >=');
    expect(result).toContain('TimeUnix <=');
    expect(result).toContain('parseDateTimeBestEffort');
  });

  it('returns empty string when timeLimit is absent', () => {
    const result = getFilterWhereConditionForGPU({} as any);
    expect(result).toBe('');
  });

  it('returns empty string when start or end is missing', () => {
    const result = getFilterWhereConditionForGPU({
      timeLimit: { start: new Date() },
    } as any);
    expect(result).toBe('');
  });

  it('returns empty string without throwing when filter is null (covers catch block on line 371)', () => {
    const result = getFilterWhereConditionForGPU(null as any);
    expect(result).toBe('');
  });
});

// ─── dateTruncGroupingLogic ────────────────────────────────────────────────────

describe('dateTruncGroupingLogic', () => {
  it('returns "month" when difference is >= 1 year', () => {
    const start = new Date('2022-01-01');
    const end = new Date('2023-06-01'); // > 1 year
    expect(dateTruncGroupingLogic(end, start)).toBe('month');
  });

  it('returns "hour" when difference is <= 1 day', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-01-01T12:00:00Z'); // 12 hours
    expect(dateTruncGroupingLogic(end, start)).toBe('hour');
  });

  it('returns "day" for differences between 1 day and 1 year', () => {
    const start = new Date('2024-01-01');
    const end = new Date('2024-06-01'); // ~5 months
    expect(dateTruncGroupingLogic(end, start)).toBe('day');
  });
});
