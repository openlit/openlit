import { getChartColors } from '@/constants/chart-colors';
import { PRIMARY_BACKGROUND } from '@/constants/common-classes';

describe('getChartColors', () => {
  it('returns array of requested length', () => {
    const colors = getChartColors(3);
    expect(colors).toHaveLength(3);
  });

  it('returns strings (color class names)', () => {
    const colors = getChartColors(5);
    colors.forEach((c) => expect(typeof c).toBe('string'));
  });

  it('returns empty array for length 0', () => {
    const colors = getChartColors(0);
    expect(colors).toHaveLength(0);
  });

  it('returns at most 11 colors (max available)', () => {
    const colors = getChartColors(20);
    expect(colors.length).toBeLessThanOrEqual(11);
  });
});

describe('PRIMARY_BACKGROUND', () => {
  it('is a non-empty string', () => {
    expect(typeof PRIMARY_BACKGROUND).toBe('string');
    expect(PRIMARY_BACKGROUND.length).toBeGreaterThan(0);
  });

  it('contains dark mode class', () => {
    expect(PRIMARY_BACKGROUND).toContain('dark:');
  });
});
