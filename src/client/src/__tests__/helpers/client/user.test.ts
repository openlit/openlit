// Mock external dependencies
jest.mock('@/store', () => ({
  useRootStore: {
    getState: jest.fn(),
  },
}));
jest.mock('@/utils/api', () => ({
  getData: jest.fn(),
}));
jest.mock('@/utils/asaw', () => jest.fn());
jest.mock('next-auth/react', () => ({
  signOut: jest.fn(),
}));

import { fetchAndPopulateCurrentUserStore } from '@/helpers/client/user';
import { useRootStore } from '@/store';
import { getData } from '@/utils/api';
import asaw from '@/utils/asaw';
import { signOut } from 'next-auth/react';

const mockSetUser = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useRootStore.getState as jest.Mock).mockReturnValue({
    user: { set: mockSetUser },
  });
});

describe('fetchAndPopulateCurrentUserStore', () => {
  it('fetches user profile and sets it in the store', async () => {
    const user = { id: 'u1', email: 'alice@example.com' };
    (asaw as jest.Mock).mockResolvedValue([null, user]);

    await fetchAndPopulateCurrentUserStore();

    expect(getData).toHaveBeenCalledWith({ url: '/api/user/profile', method: 'GET' });
    expect(mockSetUser).toHaveBeenCalledWith(user);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('calls signOut when there is an error', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Network error', null]);

    await fetchAndPopulateCurrentUserStore();

    expect(signOut).toHaveBeenCalled();
  });
});
