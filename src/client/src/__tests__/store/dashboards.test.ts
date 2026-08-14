import { create } from 'zustand';
import { withLenses } from '@dhmk/zustand-lens';
import { dashboardStoreSlice } from '@/store/dashboards';

const createStore = () =>
  create<any>()(withLenses({ dashboards: dashboardStoreSlice }));

describe('dashboardStoreSlice', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe('initial state', () => {
    it('has empty page search', () => {
      expect(store.getState().dashboards.page.search).toBe('');
    });
  });

  describe('setPageSearch', () => {
    it('updates the page search string', () => {
      store.getState().dashboards.setPageSearch('my dashboard');
      expect(store.getState().dashboards.page.search).toBe('my dashboard');
    });

    it('can clear the search string', () => {
      store.getState().dashboards.setPageSearch('something');
      store.getState().dashboards.setPageSearch('');
      expect(store.getState().dashboards.page.search).toBe('');
    });
  });
});
