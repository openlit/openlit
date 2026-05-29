import { getFilterParamsForDashboard } from '@/helpers/client/filter';

const baseFilter = {
  timeLimit: { type: '24H', start: new Date('2024-01-01'), end: new Date('2024-01-02') },
  limit: 25,
  offset: 0,
  selectedConfig: { models: ['gpt-4'] },
  sorting: { type: 'Timestamp', direction: 'desc' as const },
  refreshRate: '1m' as const,
};

describe('getFilterParamsForDashboard', () => {
  it('omits limit from the result', () => {
    const result = getFilterParamsForDashboard(baseFilter);
    expect(result).not.toHaveProperty('limit');
  });

  it('omits offset from the result', () => {
    const result = getFilterParamsForDashboard(baseFilter);
    expect(result).not.toHaveProperty('offset');
  });

  it('preserves selectedConfig in the result', () => {
    // Dashboard endpoints respect `selectedConfig` (provider, model,
    // environment, and the agent-detail `serviceNames` scope lock) when the
    // server-side helper is called with `filterSelectedConfig=true`.
    // Stripping it here would leak unrelated services into the agent-detail
    // Analytics tab — see comment in `helpers/client/filter.ts`.
    const result = getFilterParamsForDashboard(baseFilter);
    expect(result).toHaveProperty('selectedConfig');
    expect(result.selectedConfig).toEqual(baseFilter.selectedConfig);
  });

  it('omits sorting from the result', () => {
    const result = getFilterParamsForDashboard(baseFilter);
    expect(result).not.toHaveProperty('sorting');
  });

  it('omits refreshRate from the result', () => {
    const result = getFilterParamsForDashboard(baseFilter);
    expect(result).not.toHaveProperty('refreshRate');
  });

  it('preserves timeLimit in the result', () => {
    const result = getFilterParamsForDashboard(baseFilter);
    expect(result).toHaveProperty('timeLimit');
    expect(result.timeLimit).toEqual(baseFilter.timeLimit);
  });

  it('does not mutate the original filter', () => {
    const original = { ...baseFilter };
    getFilterParamsForDashboard(baseFilter);
    expect(baseFilter.limit).toBe(original.limit);
    expect(baseFilter.offset).toBe(original.offset);
  });
});
