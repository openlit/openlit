jest.mock('@/store', () => ({
  useRootStore: jest.fn(),
}));

import { useDashboardPageSearch, useSetDashboardPageSearch } from '@/selectors/dashboards';
import { useRootStore } from '@/store';

describe('useDashboardPageSearch', () => {
  it('returns dashboards.page.search from store', () => {
    const mockSearch = 'my query';
    (useRootStore as jest.Mock).mockReturnValue({
      dashboards: { page: { search: mockSearch }, setPageSearch: jest.fn() },
    });
    const result = useDashboardPageSearch();
    expect(result).toBe(mockSearch);
  });

  it('returns empty string when search is empty', () => {
    (useRootStore as jest.Mock).mockReturnValue({
      dashboards: { page: { search: '' }, setPageSearch: jest.fn() },
    });
    expect(useDashboardPageSearch()).toBe('');
  });
});

describe('useSetDashboardPageSearch', () => {
  it('returns dashboards.setPageSearch from store', () => {
    const mockSetPageSearch = jest.fn();
    (useRootStore as jest.Mock).mockReturnValue({
      dashboards: { page: { search: '' }, setPageSearch: mockSetPageSearch },
    });
    const result = useSetDashboardPageSearch();
    expect(result).toBe(mockSetPageSearch);
  });
});
