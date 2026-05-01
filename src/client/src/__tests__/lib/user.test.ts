jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock('@/lib/session', () => ({
  getCurrentUser: jest.fn(),
}));
jest.mock('@/utils/asaw', () => jest.fn());
jest.mock('@/lib/db-config', () => ({
  moveSharedDBConfigToDBUser: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/organisation', () => ({
  moveInvitationsToMembership: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
  })),
}));
jest.mock('bcrypt-ts', () => ({
  compare: jest.fn(),
  genSaltSync: jest.fn(() => '$2b$10$salt'),
  hashSync: jest.fn((pw: string) => `hashed:${pw}`),
}));

import {
  getUserByEmail,
  getUserById,
  createNewUser,
  updateUser,
  updateUserProfile,
  doesPasswordMatches,
} from '@/lib/user';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import asaw from '@/utils/asaw';
import { compare } from 'bcrypt-ts';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getUserByEmail', () => {
  it('returns user (without password) for valid email', async () => {
    const user = { id: 'u1', email: 'alice@example.com', password: 'hashed' };
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);

    const result = await getUserByEmail({ email: 'ALICE@EXAMPLE.COM' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' }, // lowercase normalized
    });
    expect((result as any).password).toBeUndefined();
    expect(result.email).toBe('alice@example.com');
  });

  it('throws when user not found', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(getUserByEmail({ email: 'nobody@x.com' })).rejects.toThrow(
      'Invalid email or password'
    );
  });

  it('throws when no email provided', async () => {
    await expect(getUserByEmail({ email: undefined })).rejects.toThrow(
      'No email Provided'
    );
  });

  it('includes password when selectPassword=true', async () => {
    const user = { id: 'u1', email: 'alice@example.com', password: 'hashed' };
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    const result = await getUserByEmail({ email: 'alice@example.com', selectPassword: true });
    expect((result as any).password).toBe('hashed');
  });
});

describe('getUserById', () => {
  it('returns null when no id provided', async () => {
    const result = await getUserById({ id: undefined });
    expect(result).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when user not found', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const result = await getUserById({ id: 'nonexistent' });
    expect(result).toBeNull();
  });

  it('returns user without password', async () => {
    const user = { id: 'u1', email: 'a@b.com', password: 'hashed' };
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    const result = await getUserById({ id: 'u1' });
    expect((result as any).password).toBeUndefined();
  });
});

describe('createNewUser', () => {
  it('creates user when email is not taken', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, null]); // getUserByEmail not found
    const createdUser = { id: 'u1', email: 'new@example.com', password: 'hashed' };
    (prisma.user.create as jest.Mock).mockResolvedValue(createdUser);

    const result = await createNewUser({ email: 'NEW@EXAMPLE.COM', password: 'Pass1234' });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@example.com',
          hasCompletedOnboarding: false,
        }),
      })
    );
    expect((result as any).password).toBeUndefined();
  });

  it('throws when user already exists', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'u1', email: 'existing@x.com' }]);
    await expect(
      createNewUser({ email: 'existing@x.com', password: 'Pass1234' })
    ).rejects.toThrow('User already exists');
  });

  it('throws when prisma.user.create returns no id', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, null]);
    (prisma.user.create as jest.Mock).mockResolvedValue({ id: null });
    await expect(createNewUser({ email: 'a@b.com', password: 'Pass1234' })).rejects.toThrow(
      'Cannot create a user!'
    );
  });
});

describe('updateUser', () => {
  it('calls prisma.user.update with provided where/data', async () => {
    (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u1' });
    await updateUser({ data: { name: 'Alice' }, where: { id: 'u1' } });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Alice' },
    });
  });

  it('throws when where is empty', async () => {
    await expect(updateUser({ data: { name: 'Alice' }, where: {} })).rejects.toThrow(
      'No where clause defined'
    );
  });
});

describe('updateUserProfile', () => {
  it('updates name without password change', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'a@b.com', password: 'hashed' });
    (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Bob' });

    await updateUserProfile({ name: 'Bob' });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Bob' }) })
    );
  });

  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(updateUserProfile({ name: 'Bob' })).rejects.toThrow('Unauthorized');
  });

  it('throws when nothing to update', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'a@b.com', password: 'hashed' });
    await expect(updateUserProfile({})).rejects.toThrow('Nothing to update!');
  });

  it('updates password when passwords match', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'a@b.com', password: '$hashed' });
    (compare as jest.Mock).mockResolvedValue(true);
    (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u1' });

    await updateUserProfile({ currentPassword: 'old', newPassword: 'Newpass1' });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ password: expect.any(String) }) })
    );
  });

  it('throws when current password is wrong', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'a@b.com', password: '$hashed' });
    (compare as jest.Mock).mockResolvedValue(false);

    await expect(
      updateUserProfile({ currentPassword: 'wrong', newPassword: 'Newpass1' })
    ).rejects.toThrow('Wrong current password!');
  });
});

describe('doesPasswordMatches', () => {
  it('returns true when passwords match', async () => {
    (compare as jest.Mock).mockResolvedValue(true);
    const result = await doesPasswordMatches('password', '$hashed');
    expect(result).toBe(true);
  });

  it('returns false when passwords do not match', async () => {
    (compare as jest.Mock).mockResolvedValue(false);
    const result = await doesPasswordMatches('wrong', '$hashed');
    expect(result).toBe(false);
  });
});
