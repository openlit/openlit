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
} from '@/helpers/client/database-config';
import { useRootStore } from '@/store';
import { getData, deleteData } from '@/utils/api';
import asaw from '@/utils/asaw';
import { toast } from 'sonner';

const mockSetIsLoading = jest.fn();
const mockSetList = jest.fn();
const mockSetPing = jest.fn();

const makeGetState = (list: any[] = []) => ({
  databaseConfig: {
    setIsLoading: mockSetIsLoading,
    setList: mockSetList,
    setPing: mockSetPing,
    list,
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

  it('calls successCb with empty array on error', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, null]);
    const successCb = jest.fn();
    await fetchDatabaseConfigList(successCb);
    expect(successCb).toHaveBeenCalledWith([]);
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
});
