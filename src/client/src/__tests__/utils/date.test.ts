import { formatBrowserDateTime, formatDate, formatDatePartsValue } from '@/utils/date';

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

  it('returns fallback for invalid or empty date strings', () => {
    expect(formatDate('not-a-date')).toBe('-');
    expect(formatDate('')).toBe('-');
  });

  it('normalizes date strings that use a space separator', () => {
    const result = formatDate('2024-06-15 10:30:00', { time: true });

    expect(result).toMatch(/Jun/i);
    expect(result).toMatch(/2024/);
    expect(result).toMatch(/:/);
  });
});

describe('formatBrowserDateTime', () => {
  it('formats valid browser date time strings', () => {
    const result = formatBrowserDateTime('2024-06-15T10:30:00Z');

    expect(result).toMatch(/2024/);
  });

  it('uses the default fallback for missing or invalid dates', () => {
    expect(formatBrowserDateTime(null)).toBe('-');
    expect(formatBrowserDateTime(undefined)).toBe('-');
    expect(formatBrowserDateTime('not-a-date')).toBe('-');
  });

  it('uses a custom fallback when provided', () => {
    expect(formatBrowserDateTime('', 'No date')).toBe('No date');
  });
});

describe('formatDatePartsValue', () => {
  it('formats calendar part objects as a locale datetime', () => {
    const formatted = formatDatePartsValue({
      Day: 17,
      Hour: 11,
      Year: 2026,
      Month: 8,
      Minute: 28,
      Quarter: 3,
      'Is weekend': 'No',
      'Day of week': 'monday',
      'Day of year': 229,
      'Week of year': 34,
    });

    expect(formatted).toBe(new Date(2026, 7, 17, 11, 28, 0).toLocaleString());
    expect(formatted).not.toMatch(/Day of week/i);
  });

  it('leaves mixed objects alone', () => {
    expect(
      formatDatePartsValue({
        year: 2026,
        month: 8,
        day: 17,
        note: 'kickoff',
      })
    ).toBeNull();
  });
});
