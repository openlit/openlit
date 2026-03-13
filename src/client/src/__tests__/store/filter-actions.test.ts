import { create } from 'zustand';
import { withLenses } from '@dhmk/zustand-lens';
import { filterStoreSlice } from '@/store/filter';

const createStore = () => create<any>()(withLenses({ filter: filterStoreSlice }));

describe('filterStoreSlice actions', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe('initial state', () => {
    it('has timeLimit type "24H"', () => {
      expect(store.getState().filter.details.timeLimit.type).toBe('24H');
    });

    it('has default limit 25', () => {
      expect(store.getState().filter.details.limit).toBe(25);
    });

    it('has offset 0', () => {
      expect(store.getState().filter.details.offset).toBe(0);
    });

    it('has refreshRate "1m"', () => {
      expect(store.getState().filter.details.refreshRate).toBe('1m');
    });

    it('has default Timestamp desc sorting', () => {
      expect(store.getState().filter.details.sorting).toEqual({
        type: 'Timestamp',
        direction: 'desc',
      });
    });

    it('has undefined config', () => {
      expect(store.getState().filter.config).toBeUndefined();
    });
  });

  describe('updateFilter', () => {
    it('updates limit and resets offset to 0', () => {
      store.getState().filter.updateFilter('offset', 50);
      store.getState().filter.updateFilter('limit', 50);
      expect(store.getState().filter.details.limit).toBe(50);
      expect(store.getState().filter.details.offset).toBe(0);
    });

    it('updates selectedConfig and resets offset to 0', () => {
      store.getState().filter.updateFilter('offset', 50);
      store.getState().filter.updateFilter('selectedConfig', { models: ['gpt-4'] });
      expect(store.getState().filter.details.selectedConfig).toEqual({ models: ['gpt-4'] });
      expect(store.getState().filter.details.offset).toBe(0);
    });

    it('updates sorting and resets offset to 0', () => {
      store.getState().filter.updateFilter('offset', 25);
      store.getState().filter.updateFilter('sorting', { type: 'Cost', direction: 'asc' });
      expect(store.getState().filter.details.sorting).toEqual({ type: 'Cost', direction: 'asc' });
      expect(store.getState().filter.details.offset).toBe(0);
    });

    it('updates offset directly (offset case)', () => {
      store.getState().filter.updateFilter('offset', 25);
      expect(store.getState().filter.details.offset).toBe(25);
    });

    it('updates timeLimit.type, resets selectedConfig and config', () => {
      store.getState().filter.updateConfig({ models: ['gpt-4'] });
      store.getState().filter.updateFilter('selectedConfig', { models: ['gpt-4'] });
      store.getState().filter.updateFilter('timeLimit.type', '7D');
      const { details, config } = store.getState().filter;
      expect(details.timeLimit.type).toBe('7D');
      expect(details.selectedConfig).toEqual({});
      expect(config).toBeUndefined();
    });

    it('page-change resets offset, limit, and sorting to defaults', () => {
      store.getState().filter.updateFilter('limit', 100);
      store.getState().filter.updateFilter('offset', 50);
      store.getState().filter.updateFilter('sorting', { type: 'Cost', direction: 'asc' });
      store.getState().filter.updateFilter('page-change', null);
      const { offset, limit, sorting } = store.getState().filter.details;
      expect(offset).toBe(0);
      expect(limit).toBe(25);
      expect(sorting).toEqual({ type: 'Timestamp', direction: 'desc' });
    });

    it('updates refreshRate (default case — no extra side effects)', () => {
      store.getState().filter.updateFilter('refreshRate', '5m');
      expect(store.getState().filter.details.refreshRate).toBe('5m');
    });

    it('clears selectedConfig when extraParams.clearFilter is true', () => {
      store.getState().filter.updateFilter('selectedConfig', { models: ['gpt-4'] });
      store.getState().filter.updateFilter('refreshRate', '30s', { clearFilter: true });
      expect(store.getState().filter.details.selectedConfig).toEqual({});
    });
  });

  describe('updateConfig', () => {
    it('sets the filter config', () => {
      const config = { models: ['gpt-4'], providers: ['openai'] };
      store.getState().filter.updateConfig(config);
      expect(store.getState().filter.config).toEqual(config);
    });

    it('can overwrite config', () => {
      store.getState().filter.updateConfig({ models: ['gpt-4'] });
      store.getState().filter.updateConfig({ models: ['claude-3'] });
      expect((store.getState().filter.config as any)?.models).toEqual(['claude-3']);
    });
  });

  describe('updateAttributeKeys', () => {
    it('sets attributeKeys in store', () => {
      const attributeKeys = { spanAttributeKeys: ['gen_ai.system', 'gen_ai.request.model'], resourceAttributeKeys: ['service.name'] };
      store.getState().filter.updateAttributeKeys(attributeKeys);
      expect(store.getState().filter.attributeKeys).toEqual(attributeKeys);
    });

    it('can overwrite attributeKeys', () => {
      store.getState().filter.updateAttributeKeys({ spanAttributeKeys: ['a'], resourceAttributeKeys: [] });
      store.getState().filter.updateAttributeKeys({ spanAttributeKeys: ['b', 'c'], resourceAttributeKeys: ['d'] });
      expect(store.getState().filter.attributeKeys).toEqual({ spanAttributeKeys: ['b', 'c'], resourceAttributeKeys: ['d'] });
    });
  });
});
