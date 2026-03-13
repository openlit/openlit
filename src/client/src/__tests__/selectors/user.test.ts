import {
  getUserDetails,
  getIsUserFetched,
  setUser,
  resetUser,
  getCurrentUserId,
} from '@/selectors/user';

const makeState = (overrides: Record<string, any> = {}) =>
  ({
    user: {
      details: { id: 'u1', email: 'alice@example.com', name: 'Alice' },
      isFetched: true,
      set: jest.fn(),
      reset: jest.fn(),
      ...overrides,
    },
  } as any);

describe('getUserDetails', () => {
  it('returns the user details from state', () => {
    const state = makeState();
    expect(getUserDetails(state)).toEqual(state.user.details);
  });

  it('returns undefined when details are not set', () => {
    const state = makeState({ details: undefined });
    expect(getUserDetails(state)).toBeUndefined();
  });
});

describe('getIsUserFetched', () => {
  it('returns true when user is fetched', () => {
    expect(getIsUserFetched(makeState())).toBe(true);
  });

  it('returns false when user is not fetched', () => {
    expect(getIsUserFetched(makeState({ isFetched: false }))).toBe(false);
  });
});

describe('setUser', () => {
  it('returns the set function from state', () => {
    const state = makeState();
    expect(setUser(state)).toBe(state.user.set);
  });
});

describe('resetUser', () => {
  it('returns the reset function from state', () => {
    const state = makeState();
    expect(resetUser(state)).toBe(state.user.reset);
  });
});

describe('getCurrentUserId', () => {
  it('returns the user id when details exist', () => {
    expect(getCurrentUserId(makeState())).toBe('u1');
  });

  it('returns undefined when details are not set', () => {
    expect(getCurrentUserId(makeState({ details: undefined }))).toBeUndefined();
  });
});
