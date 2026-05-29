import { create } from 'zustand';
import { withLenses } from '@dhmk/zustand-lens';
import { pageStoreSlice } from '@/store/page';

const createStore = () => create<any>()(withLenses({ page: pageStoreSlice }));

describe('pageStoreSlice', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe('initial state', () => {
    it('has dashboard type "llm"', () => {
      expect(store.getState().page.dashboard.type).toBe('llm');
    });

    it('has visibilityColumns for request', () => {
      const cols = store.getState().page.request.visibilityColumns;
      expect(cols).toHaveProperty('id', true);
      expect(cols).toHaveProperty('time', true);
    });

    it('has empty header', () => {
      expect(store.getState().page.header.title).toBe('');
      expect(store.getState().page.header.breadcrumbs).toEqual([]);
    });
  });

  describe('setHeader', () => {
    it('updates the header title and breadcrumbs', () => {
      store.getState().page.setHeader({
        title: 'Dashboard',
        breadcrumbs: [{ title: 'Home', href: '/' }],
      });
      const { header } = store.getState().page;
      expect(header.title).toBe('Dashboard');
      expect(header.breadcrumbs).toEqual([{ title: 'Home', href: '/' }]);
    });

    it('updates description when provided', () => {
      store.getState().page.setHeader({
        title: 'Traces',
        description: 'View all traces',
        breadcrumbs: [],
      });
      expect(store.getState().page.header.description).toBe('View all traces');
    });
  });

  describe('setData', () => {
    it('updates a nested key in the dashboard page', () => {
      store.getState().page.setData('dashboard', 'type', 'vector');
      expect(store.getState().page.dashboard.type).toBe('vector');
    });

    it('updates a visibility column in the request page', () => {
      store.getState().page.setData('request', 'visibilityColumns.time', false);
      expect(store.getState().page.request.visibilityColumns.time).toBe(false);
    });

    it('updates a visibility column in the exception page', () => {
      store.getState().page.setData('exception', 'visibilityColumns.spanName', false);
      expect(store.getState().page.exception.visibilityColumns.spanName).toBe(false);
    });

    it('does not mutate other pages when setting data for one page', () => {
      const requestBefore = store.getState().page.request;
      store.getState().page.setData('dashboard', 'type', 'gpu');
      expect(store.getState().page.request).toEqual(requestBefore);
    });
  });
});
