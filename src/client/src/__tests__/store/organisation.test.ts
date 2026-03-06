import { create } from 'zustand';
import { withLenses } from '@dhmk/zustand-lens';
import { organisationStoreSlice } from '@/store/organisation';

const createStore = () => create<any>()(withLenses({ organisation: organisationStoreSlice }));

describe('organisationStoreSlice', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe('initial state', () => {
    it('has undefined list', () => {
      expect(store.getState().organisation.list).toBeUndefined();
    });

    it('has undefined current', () => {
      expect(store.getState().organisation.current).toBeUndefined();
    });

    it('has empty pendingInvitations', () => {
      expect(store.getState().organisation.pendingInvitations).toEqual([]);
    });

    it('has isLoading false', () => {
      expect(store.getState().organisation.isLoading).toBe(false);
    });
  });

  describe('setList', () => {
    it('sets the list and derives current from isCurrent flag', () => {
      const orgs = [
        { id: 'org1', name: 'Acme', isCurrent: true },
        { id: 'org2', name: 'Globex', isCurrent: false },
      ];
      store.getState().organisation.setList(orgs);
      const { list, current, isLoading } = store.getState().organisation;
      expect(list).toEqual(orgs);
      expect(current?.id).toBe('org1');
      expect(isLoading).toBe(false);
    });

    it('sets current to undefined when no org has isCurrent true', () => {
      const orgs = [
        { id: 'org1', name: 'Acme', isCurrent: false },
        { id: 'org2', name: 'Globex', isCurrent: false },
      ];
      store.getState().organisation.setList(orgs);
      expect(store.getState().organisation.current).toBeUndefined();
    });

    it('handles empty list', () => {
      store.getState().organisation.setList([]);
      expect(store.getState().organisation.list).toEqual([]);
      expect(store.getState().organisation.current).toBeUndefined();
    });
  });

  describe('setCurrent', () => {
    it('updates list to mark the selected org as isCurrent', () => {
      const orgs = [
        { id: 'org1', name: 'Acme', isCurrent: true },
        { id: 'org2', name: 'Globex', isCurrent: false },
      ];
      store.getState().organisation.setList(orgs);
      store.getState().organisation.setCurrent({ id: 'org2', name: 'Globex', isCurrent: false });
      const { list, current } = store.getState().organisation;
      expect(list?.find((o: any) => o.id === 'org1')?.isCurrent).toBe(false);
      expect(list?.find((o: any) => o.id === 'org2')?.isCurrent).toBe(true);
      expect(current?.id).toBe('org2');
    });

    it('works when list is empty (no crash)', () => {
      expect(() => {
        store.getState().organisation.setCurrent({ id: 'org1' });
      }).not.toThrow();
    });
  });

  describe('setPendingInvitations', () => {
    it('updates pending invitations', () => {
      const invites = [{ id: 'inv1' }, { id: 'inv2' }];
      store.getState().organisation.setPendingInvitations(invites);
      expect(store.getState().organisation.pendingInvitations).toEqual(invites);
    });

    it('can clear pending invitations', () => {
      store.getState().organisation.setPendingInvitations([{ id: 'inv1' }]);
      store.getState().organisation.setPendingInvitations([]);
      expect(store.getState().organisation.pendingInvitations).toEqual([]);
    });
  });

  describe('setIsLoading', () => {
    it('sets isLoading to true', () => {
      store.getState().organisation.setIsLoading(true);
      expect(store.getState().organisation.isLoading).toBe(true);
    });

    it('sets isLoading back to false', () => {
      store.getState().organisation.setIsLoading(true);
      store.getState().organisation.setIsLoading(false);
      expect(store.getState().organisation.isLoading).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets all fields to initial state', () => {
      store.getState().organisation.setList([{ id: 'org1', name: 'Acme', isCurrent: true }]);
      store.getState().organisation.setPendingInvitations([{ id: 'inv1' }]);
      store.getState().organisation.setIsLoading(true);
      store.getState().organisation.reset();
      const { list, current, pendingInvitations, isLoading } = store.getState().organisation;
      expect(list).toBeUndefined();
      expect(current).toBeUndefined();
      expect(pendingInvitations).toEqual([]);
      expect(isLoading).toBe(false);
    });
  });
});
