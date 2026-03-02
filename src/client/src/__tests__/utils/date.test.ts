import { formatDate } from '@/utils/date';

describe('formatDate', () => {
  const isoDate = '2024-06-15T10:30:00Z';

  it('formats a date string without time by default', () => {
    const result = formatDate(isoDate);
    expect(result).toMatch(/Jun/i);
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/15/);
  });

  it('does not include time when options.time is false', () => {
    const result = formatDate(isoDate, { time: false });
    // Should not contain colons (time separators)
    const colonCount = (result.match(/:/g) || []).length;
    expect(colonCount).toBe(0);
  });

  it('includes time when options.time is true', () => {
    const result = formatDate(isoDate, { time: true });
    // Should contain at least one colon for time
    expect(result).toMatch(/:/);
  });

  it('returns a non-empty string for valid dates', () => {
    const result = formatDate('2023-01-01T00:00:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles year-only date string', () => {
    const result = formatDate('2020-01-01');
    expect(result).toMatch(/2020/);
  });
});
