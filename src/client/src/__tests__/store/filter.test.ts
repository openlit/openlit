import {
  getTimeLimitObject,
  TIME_RANGE_TYPE,
  REFRESH_RATE_TYPE,
  DEFAULT_TIME_RANGE,
} from '@/store/filter';
import { addDays, addWeeks, addMonths } from 'date-fns';

describe('TIME_RANGE_TYPE', () => {
  it('has all expected time range keys', () => {
    expect(TIME_RANGE_TYPE).toHaveProperty('24H', '24H');
    expect(TIME_RANGE_TYPE).toHaveProperty('7D', '7D');
    expect(TIME_RANGE_TYPE).toHaveProperty('1M', '1M');
    expect(TIME_RANGE_TYPE).toHaveProperty('3M', '3M');
    expect(TIME_RANGE_TYPE).toHaveProperty('CUSTOM', 'CUSTOM');
  });

  it('has exactly 5 time range options', () => {
    expect(Object.keys(TIME_RANGE_TYPE)).toHaveLength(5);
  });
});

describe('REFRESH_RATE_TYPE', () => {
  it('has all expected refresh rate keys', () => {
    expect(REFRESH_RATE_TYPE).toHaveProperty('Never', 'Never');
    expect(REFRESH_RATE_TYPE).toHaveProperty('30s', '30s');
    expect(REFRESH_RATE_TYPE).toHaveProperty('1m', '1m');
    expect(REFRESH_RATE_TYPE).toHaveProperty('5m', '5m');
    expect(REFRESH_RATE_TYPE).toHaveProperty('15m', '15m');
  });
});

describe('DEFAULT_TIME_RANGE', () => {
  it('defaults to 24H', () => {
    expect(DEFAULT_TIME_RANGE).toBe('24H');
  });
});

describe('getTimeLimitObject', () => {
  const TOLERANCE_MS = 5000; // 5 second tolerance for timing

  it('returns start ~1 day ago and end ~now for 24H', () => {
    const before = Date.now();
    const result = getTimeLimitObject('24H', '') as { start: Date; end: Date };
    const after = Date.now();

    expect(result.start).toBeInstanceOf(Date);
    expect(result.end).toBeInstanceOf(Date);

    const expectedStart = addDays(new Date(), -1);
    expect(Math.abs(result.start.getTime() - expectedStart.getTime())).toBeLessThan(TOLERANCE_MS);
    expect(result.end.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.end.getTime()).toBeLessThanOrEqual(after + TOLERANCE_MS);
  });

  it('returns start ~7 days ago and end ~now for 7D', () => {
    const result = getTimeLimitObject('7D', '') as { start: Date; end: Date };
    const expectedStart = addWeeks(new Date(), -1);
    expect(Math.abs(result.start.getTime() - expectedStart.getTime())).toBeLessThan(TOLERANCE_MS);
  });

  it('returns start ~1 month ago for 1M', () => {
    const result = getTimeLimitObject('1M', '') as { start: Date; end: Date };
    const expectedStart = addMonths(new Date(), -1);
    expect(Math.abs(result.start.getTime() - expectedStart.getTime())).toBeLessThan(TOLERANCE_MS);
  });

  it('returns start ~3 months ago for 3M', () => {
    const result = getTimeLimitObject('3M', '') as { start: Date; end: Date };
    const expectedStart = addMonths(new Date(), -3);
    expect(Math.abs(result.start.getTime() - expectedStart.getTime())).toBeLessThan(TOLERANCE_MS);
  });

  it('uses provided start and end for CUSTOM range', () => {
    const start = new Date('2024-01-01');
    const end = new Date('2024-01-31');
    const result = getTimeLimitObject('CUSTOM', '', { start, end }) as {
      start: Date;
      end: Date;
    };
    expect(result.start).toEqual(start);
    expect(result.end).toEqual(end);
  });

  it('returns empty object for CUSTOM when start/end are missing', () => {
    const result = getTimeLimitObject('CUSTOM', '', {}) as Record<string, unknown>;
    expect(result.start).toBeUndefined();
    expect(result.end).toBeUndefined();
  });

  it('nests result under the given key prefix', () => {
    const result = getTimeLimitObject('24H', 'timeLimit.') as Record<string, unknown>;
    expect(result).toHaveProperty('timeLimit');
    expect((result as any).timeLimit).toHaveProperty('start');
    expect((result as any).timeLimit).toHaveProperty('end');
  });

  it('returns empty object for unknown time range', () => {
    const result = getTimeLimitObject('UNKNOWN', '') as Record<string, unknown>;
    expect(Object.keys(result)).toHaveLength(0);
  });
});
