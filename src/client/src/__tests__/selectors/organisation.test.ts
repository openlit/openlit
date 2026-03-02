import {
  getOrganisationList,
  getCurrentOrganisation,
  getOrganisationPendingInvitations,
  getOrganisationIsLoading,
  getPendingInvitationsCount,
} from '@/selectors/organisation';

const makeState = (overrides: Record<string, any> = {}) =>
  ({
    organisation: {
      list: [
        { id: 'org1', name: 'Acme', isCurrent: true },
        { id: 'org2', name: 'Globex', isCurrent: false },
      ],
      current: { id: 'org1', name: 'Acme', isCurrent: true },
      pendingInvitations: [{ id: 'inv1' }, { id: 'inv2' }],
      isLoading: false,
      ...overrides,
    },
  } as any);

describe('getOrganisationList', () => {
  it('returns all organisations', () => {
    const state = makeState();
    expect(getOrganisationList(state)).toHaveLength(2);
  });

  it('returns undefined when list is not loaded', () => {
    const state = makeState({ list: undefined });
    expect(getOrganisationList(state)).toBeUndefined();
  });
});

describe('getCurrentOrganisation', () => {
  it('returns the current organisation', () => {
    const state = makeState();
    expect(getCurrentOrganisation(state)).toEqual({ id: 'org1', name: 'Acme', isCurrent: true });
  });

  it('returns undefined when no current org', () => {
    const state = makeState({ current: undefined });
    expect(getCurrentOrganisation(state)).toBeUndefined();
  });
});

describe('getOrganisationPendingInvitations', () => {
  it('returns pending invitations array', () => {
    const state = makeState();
    expect(getOrganisationPendingInvitations(state)).toHaveLength(2);
  });

  it('returns empty array when no invitations', () => {
    const state = makeState({ pendingInvitations: [] });
    expect(getOrganisationPendingInvitations(state)).toEqual([]);
  });
});

describe('getOrganisationIsLoading', () => {
  it('returns false when not loading', () => {
    expect(getOrganisationIsLoading(makeState())).toBe(false);
  });

  it('returns true when loading', () => {
    expect(getOrganisationIsLoading(makeState({ isLoading: true }))).toBe(true);
  });
});

describe('getPendingInvitationsCount', () => {
  it('returns the count of pending invitations', () => {
    expect(getPendingInvitationsCount(makeState())).toBe(2);
  });

  it('returns 0 when there are no pending invitations', () => {
    const state = makeState({ pendingInvitations: [] });
    expect(getPendingInvitationsCount(state)).toBe(0);
  });
});
