jest.mock('@/store', () => ({
  useRootStore: jest.fn(),
}));

import {
  getFilterDetails,
  getUpdateFilter,
  getFilterConfig,
  getUpdateConfig,
  getAttributeKeys,
  getUpdateAttributeKeys,
  useFilters,
} from '@/selectors/filter';
import { useRootStore } from '@/store';

const mockFilterDetails = {
  timeLimit: { type: '24H', start: new Date(), end: new Date() },
  limit: 25,
  offset: 0,
  selectedConfig: {},
  sorting: { type: 'Timestamp', direction: 'desc' as const },
  refreshRate: '1m' as const,
};

const makeState = (overrides: Record<string, any> = {}) =>
  ({
    filter: {
      details: mockFilterDetails,
      config: undefined,
      updateFilter: jest.fn(),
      updateConfig: jest.fn(),
      ...overrides,
    },
  } as any);

describe('getFilterDetails', () => {
  it('returns filter details from state', () => {
    const state = makeState();
    expect(getFilterDetails(state)).toBe(state.filter.details);
  });

  it('includes timeLimit, limit and offset', () => {
    const state = makeState();
    const details = getFilterDetails(state);
    expect(details).toHaveProperty('timeLimit');
    expect(details).toHaveProperty('limit');
    expect(details).toHaveProperty('offset');
  });
});

describe('getUpdateFilter', () => {
  it('returns the updateFilter function from state', () => {
    const state = makeState();
    expect(getUpdateFilter(state)).toBe(state.filter.updateFilter);
  });
});

describe('getFilterConfig', () => {
  it('returns undefined config when not set', () => {
    const state = makeState();
    expect(getFilterConfig(state)).toBeUndefined();
  });

  it('returns config when set', () => {
    const config = { models: ['gpt-4'], providers: ['openai'] };
    const state = makeState({ config });
    expect(getFilterConfig(state)).toEqual(config);
  });
});

describe('getUpdateConfig', () => {
  it('returns the updateConfig function from state', () => {
    const state = makeState();
    expect(getUpdateConfig(state)).toBe(state.filter.updateConfig);
  });
});

describe('getAttributeKeys', () => {
  it('returns attributeKeys from state', () => {
    const attributeKeys = { spanAttributeKeys: ['gen_ai.system'], resourceAttributeKeys: [] };
    const state = makeState({ attributeKeys });
    expect(getAttributeKeys(state as any)).toBe(attributeKeys);
  });

  it('returns undefined when attributeKeys not set', () => {
    const state = makeState();
    expect(getAttributeKeys(state as any)).toBeUndefined();
  });
});

describe('getUpdateAttributeKeys', () => {
  it('returns the updateAttributeKeys function from state', () => {
    const updateAttributeKeys = jest.fn();
    const state = makeState({ updateAttributeKeys });
    expect(getUpdateAttributeKeys(state as any)).toBe(updateAttributeKeys);
  });
});

describe('useFilters', () => {
  it('calls useRootStore and returns filter slice', () => {
    const mockFilter = {
      details: mockFilterDetails,
      config: undefined,
      updateFilter: jest.fn(),
      updateConfig: jest.fn(),
    };
    (useRootStore as jest.Mock).mockImplementation((selector: (s: any) => any) => {
      return selector({ filter: mockFilter });
    });
    const result = useFilters();
    expect(result).toBe(mockFilter);
  });
});
