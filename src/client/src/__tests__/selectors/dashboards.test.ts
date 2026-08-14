jest.mock('@/store', () => ({
  useRootStore: jest.fn(),
}));

import { useDashboardPageSearch, useSetDashboardPageSearch } from '@/selectors/dashboards';
import { useRootStore } from '@/store';

const mockStore = {
  dashboards: {
    page: { search: '' },
    setPageSearch: jest.fn(),
  },
};

describe('useDashboardPageSearch', () => {
  beforeEach(() => {
    mockStore.dashboards.page.search = '';
    (useRootStore as unknown as jest.Mock).mockImplementation((selector) => selector(mockStore));
  });

  it('returns dashboards.page.search from store', () => {
    mockStore.dashboards.page.search = 'my query';
    expect(useDashboardPageSearch()).toBe('my query');
  });

  it('returns empty string when search is empty', () => {
    expect(useDashboardPageSearch()).toBe('');
  });
});

describe('useSetDashboardPageSearch', () => {
  beforeEach(() => {
    (useRootStore as unknown as jest.Mock).mockImplementation((selector) => selector(mockStore));
  });

  it('returns dashboards.setPageSearch from store', () => {
    expect(useSetDashboardPageSearch()).toBe(mockStore.dashboards.setPageSearch);
  });
});
