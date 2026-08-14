import {
  getPingDetails,
  getPingStatus,
  getDatabaseConfigList,
  getDatabaseConfigListIsLoading,
  setPing,
  setDatabaseConfigList,
  setDatabaseConfigListIsLoading,
} from '@/selectors/database-config';

const makeState = (overrides: Record<string, any> = {}) =>
  ({
    databaseConfig: {
      ping: { status: 'success', error: undefined },
      isLoading: false,
      list: [{ id: 'db1', name: 'Primary' }],
      setPing: jest.fn(),
      setList: jest.fn(),
      setIsLoading: jest.fn(),
      ...overrides,
    },
  } as any);

describe('getPingDetails', () => {
  it('returns the ping object', () => {
    const state = makeState();
    expect(getPingDetails(state)).toEqual({ status: 'success', error: undefined });
  });
});

describe('getPingStatus', () => {
  it('returns the ping status string', () => {
    expect(getPingStatus(makeState())).toBe('success');
  });

  it('returns pending status', () => {
    const state = makeState({ ping: { status: 'pending' } });
    expect(getPingStatus(state)).toBe('pending');
  });

  it('returns failure status', () => {
    const state = makeState({ ping: { status: 'failure', error: 'Connection refused' } });
    expect(getPingStatus(state)).toBe('failure');
  });
});

describe('getDatabaseConfigList', () => {
  it('returns the list of database configs', () => {
    const state = makeState();
    expect(getDatabaseConfigList(state)).toEqual([{ id: 'db1', name: 'Primary' }]);
  });

  it('returns undefined when list is not loaded', () => {
    const state = makeState({ list: undefined });
    expect(getDatabaseConfigList(state)).toBeUndefined();
  });
});

describe('getDatabaseConfigListIsLoading', () => {
  it('returns false when not loading', () => {
    expect(getDatabaseConfigListIsLoading(makeState())).toBe(false);
  });

  it('returns true when loading', () => {
    expect(getDatabaseConfigListIsLoading(makeState({ isLoading: true }))).toBe(true);
  });
});

describe('setPing', () => {
  it('returns the setPing function', () => {
    const state = makeState();
    expect(setPing(state)).toBe(state.databaseConfig.setPing);
  });
});

describe('setDatabaseConfigList', () => {
  it('returns the setList function', () => {
    const state = makeState();
    expect(setDatabaseConfigList(state)).toBe(state.databaseConfig.setList);
  });
});

describe('setDatabaseConfigListIsLoading', () => {
  it('returns the setIsLoading function', () => {
    const state = makeState();
    expect(setDatabaseConfigListIsLoading(state)).toBe(state.databaseConfig.setIsLoading);
  });
});
