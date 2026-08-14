import { create } from 'zustand';
import { withLenses } from '@dhmk/zustand-lens';
import { userStoreSlice } from '@/store/user';

const createStore = () => create<any>()(withLenses({ user: userStoreSlice }));

describe('userStoreSlice', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe('initial state', () => {
    it('has undefined details', () => {
      expect(store.getState().user.details).toBeUndefined();
    });

    it('has isFetched false', () => {
      expect(store.getState().user.isFetched).toBe(false);
    });
  });

  describe('set', () => {
    it('sets user details and marks as fetched', () => {
      const user = { id: 'u1', email: 'alice@example.com', name: 'Alice' };
      store.getState().user.set(user);
      expect(store.getState().user.details).toEqual(user);
      expect(store.getState().user.isFetched).toBe(true);
    });

    it('can update user details', () => {
      const user1 = { id: 'u1', email: 'alice@example.com' };
      const user2 = { id: 'u2', email: 'bob@example.com' };
      store.getState().user.set(user1);
      store.getState().user.set(user2);
      expect(store.getState().user.details?.email).toBe('bob@example.com');
    });
  });

  describe('reset', () => {
    it('clears details and sets isFetched to false', () => {
      store.getState().user.set({ id: 'u1', email: 'alice@example.com' });
      store.getState().user.reset();
      expect(store.getState().user.details).toBeUndefined();
      expect(store.getState().user.isFetched).toBe(false);
    });
  });
});
