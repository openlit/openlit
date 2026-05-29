import { create } from 'zustand';
import { withLenses } from '@dhmk/zustand-lens';
import { databaseConfigStoreSlice } from '@/store/database-config';

const createStore = () =>
  create<any>()(withLenses({ databaseConfig: databaseConfigStoreSlice }));

describe('databaseConfigStoreSlice', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe('initial state', () => {
    it('has ping status "pending"', () => {
      expect(store.getState().databaseConfig.ping.status).toBe('pending');
    });

    it('has isLoading false', () => {
      expect(store.getState().databaseConfig.isLoading).toBe(false);
    });

    it('has no list', () => {
      expect(store.getState().databaseConfig.list).toBeUndefined();
    });
  });

  describe('setPing', () => {
    it('sets ping status to success', () => {
      store.getState().databaseConfig.setPing({ status: 'success', error: undefined });
      expect(store.getState().databaseConfig.ping.status).toBe('success');
      expect(store.getState().databaseConfig.ping.error).toBeUndefined();
    });

    it('sets ping status to failure with error', () => {
      store
        .getState()
        .databaseConfig.setPing({ status: 'failure', error: 'Connection refused' });
      expect(store.getState().databaseConfig.ping.status).toBe('failure');
      expect(store.getState().databaseConfig.ping.error).toBe('Connection refused');
    });
  });

  describe('setList', () => {
    it('sets the list and sets isLoading to false', () => {
      const list = [{ id: 'db1', name: 'Primary', isCurrent: true }];
      store.getState().databaseConfig.setList(list);
      expect(store.getState().databaseConfig.list).toEqual(list);
      expect(store.getState().databaseConfig.isLoading).toBe(false);
    });

    it('handles empty list', () => {
      store.getState().databaseConfig.setList([]);
      expect(store.getState().databaseConfig.list).toEqual([]);
    });
  });

  describe('setIsLoading', () => {
    it('sets isLoading to true when called with true', () => {
      store.getState().databaseConfig.setIsLoading(true);
      expect(store.getState().databaseConfig.isLoading).toBe(true);
    });

    it('sets isLoading to false when called with false', () => {
      store.getState().databaseConfig.setIsLoading(true);
      store.getState().databaseConfig.setIsLoading(false);
      expect(store.getState().databaseConfig.isLoading).toBe(false);
    });

    it('sets isLoading to false when called with undefined', () => {
      store.getState().databaseConfig.setIsLoading(undefined);
      expect(store.getState().databaseConfig.isLoading).toBe(false);
    });
  });
});
