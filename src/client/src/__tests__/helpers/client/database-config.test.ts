jest.mock('@/store', () => ({
  useRootStore: { getState: jest.fn() },
}));
jest.mock('@/utils/api', () => ({
  getData: jest.fn(),
  deleteData: jest.fn(),
}));
jest.mock('@/utils/asaw', () => jest.fn());
jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

import {
  fetchDatabaseConfigList,
  pingActiveDatabaseConfig,
  changeActiveDatabaseConfig,
  deleteDatabaseConfig,
  projectHasDatabaseConfig,
} from '@/helpers/client/database-config';
import { useRootStore } from '@/store';
import { getData, deleteData } from '@/utils/api';
import asaw from '@/utils/asaw';
import { toast } from 'sonner';

const mockSetIsLoading = jest.fn();
const mockSetList = jest.fn();
const mockSetPing = jest.fn();

const makeGetState = (list: any[] = [], currentProjectId: string | null = 'proj-1') => ({
  databaseConfig: {
    setIsLoading: mockSetIsLoading,
    setList: mockSetList,
    setPing: mockSetPing,
    list,
  },
  project: {
    current: currentProjectId ? { id: currentProjectId } : undefined,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  (useRootStore.getState as jest.Mock).mockReturnValue(makeGetState());
});

describe('fetchDatabaseConfigList', () => {
  it('sets loading, fetches list, calls successCb, and updates store', async () => {
    const data = [{ id: 'db1', name: 'Primary' }];
    (asaw as jest.Mock).mockResolvedValue([null, data]);
    const successCb = jest.fn();

    await fetchDatabaseConfigList(successCb);

    expect(mockSetIsLoading).toHaveBeenCalledWith(true);
    expect(getData).toHaveBeenCalledWith({ method: 'GET', url: '/api/db-config' });
    expect(successCb).toHaveBeenCalledWith(data);
    expect(mockSetList).toHaveBeenCalledWith(data);
  });

  it('treats a fetch error as an empty list and surfaces it', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Unauthorized']);
    const successCb = jest.fn();
    await fetchDatabaseConfigList(successCb);
    expect(successCb).toHaveBeenCalledWith([]);
    expect(mockSetList).toHaveBeenCalledWith([]);
    expect(toast.error).toHaveBeenCalled();
  });

  it('does not treat a non-array payload as a successful list', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, '<html>login</html>']);
    const successCb = jest.fn();
    await fetchDatabaseConfigList(successCb);
    expect(successCb).toHaveBeenCalledWith([]);
    expect(mockSetList).toHaveBeenCalledWith([]);
    expect(toast.error).toHaveBeenCalled();
  });

  it('ignores a response after the current project has changed', async () => {
    let resolveAsaw: (value: unknown) => void = () => {};
    (asaw as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveAsaw = resolve;
      })
    );
    const successCb = jest.fn();

    const pending = fetchDatabaseConfigList(successCb, { projectId: 'proj-1' });
    (useRootStore.getState as jest.Mock).mockReturnValue(makeGetState([], 'proj-2'));
    resolveAsaw([null, [{ id: 'db1' }]]);
    await pending;

    expect(successCb).not.toHaveBeenCalled();
    expect(mockSetList).not.toHaveBeenCalled();
  });

  it('still applies the list when the current project has not been set yet', async () => {
    (useRootStore.getState as jest.Mock).mockReturnValue(makeGetState([], null));
    (asaw as jest.Mock).mockResolvedValue([null, [{ id: 'db1' }]]);
    const successCb = jest.fn();

    await fetchDatabaseConfigList(successCb, { projectId: 'proj-1' });

    expect(successCb).toHaveBeenCalledWith([{ id: 'db1' }]);
    expect(mockSetList).toHaveBeenCalledWith([{ id: 'db1' }]);
  });
});

describe('pingActiveDatabaseConfig', () => {
  it('sets ping to pending then success on ok response', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, null]);

    await pingActiveDatabaseConfig();

    expect(mockSetPing).toHaveBeenNthCalledWith(1, { error: undefined, status: 'pending' });
    expect(mockSetPing).toHaveBeenNthCalledWith(2, { error: undefined, status: 'success' });
  });

  it('sets ping to failure when there is an error', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Connection refused', null]);

    await pingActiveDatabaseConfig();

    expect(mockSetPing).toHaveBeenLastCalledWith({
      error: 'Connection refused',
      status: 'failure',
    });
  });

  it('uses data.err as error when no top-level err', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, { err: 'DB error' }]);

    await pingActiveDatabaseConfig();

    expect(mockSetPing).toHaveBeenLastCalledWith({
      error: 'DB error',
      status: 'failure',
    });
  });
});

describe('changeActiveDatabaseConfig', () => {
  it('calls successCb and updates list on success', async () => {
    const list = [
      { id: 'db1', isCurrent: false },
      { id: 'db2', isCurrent: false },
    ];
    (useRootStore.getState as jest.Mock).mockReturnValue(makeGetState(list));
    (asaw as jest.Mock).mockResolvedValue([null, {}]);
    const successCb = jest.fn();

    await changeActiveDatabaseConfig('db1', successCb);

    expect(successCb).toHaveBeenCalled();
    expect(mockSetList).toHaveBeenCalledWith([
      { id: 'db1', isCurrent: true },
      { id: 'db2', isCurrent: false },
    ]);
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows error toast and returns early on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Error', null]);
    const successCb = jest.fn();

    await changeActiveDatabaseConfig('db1', successCb);

    expect(toast.error).toHaveBeenCalled();
    expect(successCb).not.toHaveBeenCalled();
  });

  it('shows error toast when data.err is set (err is null)', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, { err: 'Db config error from response' }]);
    const successCb = jest.fn();

    await changeActiveDatabaseConfig('db1', successCb);

    expect(toast.error).toHaveBeenCalled();
    expect(successCb).not.toHaveBeenCalled();
  });

  it('defaults to an empty list when the store has no existing list', async () => {
    (useRootStore.getState as jest.Mock).mockReturnValue({
      databaseConfig: {
        setIsLoading: mockSetIsLoading,
        setList: mockSetList,
        setPing: mockSetPing,
        list: undefined,
      },
    });
    (asaw as jest.Mock).mockResolvedValue([null, {}]);
    const successCb = jest.fn();

    await changeActiveDatabaseConfig('db1', successCb);

    expect(mockSetList).toHaveBeenCalledWith([]);
  });

  it('skips the success toast when called with silent: true', async () => {
    const list = [{ id: 'db1', isCurrent: false }];
    (useRootStore.getState as jest.Mock).mockReturnValue(makeGetState(list));
    (asaw as jest.Mock).mockResolvedValue([null, {}]);
    const successCb = jest.fn();

    await changeActiveDatabaseConfig('db1', successCb, { silent: true });

    expect(successCb).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('deleteDatabaseConfig', () => {
  it('removes the deleted config from store list', async () => {
    const list = [{ id: 'db1' }, { id: 'db2' }];
    (useRootStore.getState as jest.Mock).mockReturnValue(makeGetState(list));
    (asaw as jest.Mock).mockResolvedValue([null, {}]);

    await deleteDatabaseConfig('db1');

    expect(mockSetList).toHaveBeenCalledWith([{ id: 'db2' }]);
  });

  it('shows error toast on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Delete failed', null]);

    await deleteDatabaseConfig('db1');

    expect(toast.error).toHaveBeenCalled();
    expect(mockSetList).not.toHaveBeenCalled();
  });

  it('shows error toast when data.err is set (err is null)', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, { err: 'Delete conflict' }]);

    await deleteDatabaseConfig('db1');

    expect(toast.error).toHaveBeenCalled();
    expect(mockSetList).not.toHaveBeenCalled();
  });

  it('defaults to an empty list when the store has no existing list', async () => {
    (useRootStore.getState as jest.Mock).mockReturnValue({
      databaseConfig: {
        setIsLoading: mockSetIsLoading,
        setList: mockSetList,
        setPing: mockSetPing,
        list: undefined,
      },
    });
    (asaw as jest.Mock).mockResolvedValue([null, {}]);

    await deleteDatabaseConfig('db1');

    expect(mockSetList).toHaveBeenCalledWith([]);
  });
});

describe('projectHasDatabaseConfig', () => {
  it('is false for missing or empty lists', () => {
    expect(projectHasDatabaseConfig(undefined)).toBe(false);
    expect(projectHasDatabaseConfig(null)).toBe(false);
    expect(projectHasDatabaseConfig([])).toBe(false);
  });

  it('is true when the project has at least one database config', () => {
    expect(projectHasDatabaseConfig([{ id: 'db1' }])).toBe(true);
  });
});
