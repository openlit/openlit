jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    aPIKeys: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock('@/lib/session', () => ({
  getCurrentUser: jest.fn(),
}));
jest.mock('@/lib/db-config', () => ({
  getDBConfigByUser: jest.fn(),
}));
jest.mock('@/utils/asaw', () => jest.fn());
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  }),
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
    DATABASE_CONFIG_NOT_FOUND: 'DB config not found',
  })),
}));

import { generateAPIKey, getAPIKeyInfo, getAllAPIKeys, deleteAPIKey } from '@/lib/platform/api-keys/index';
import { getCurrentUser } from '@/lib/session';
import { getDBConfigByUser } from '@/lib/db-config';
import asaw from '@/utils/asaw';
import prisma from '@/lib/prisma';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('generateAPIKey', () => {
  it('generates a key and saves it to the db', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'u@x.com' });
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'db-1' }]);
    (prisma.aPIKeys.create as jest.Mock).mockResolvedValue({});

    const result = await generateAPIKey('my-key');
    expect(prisma.aPIKeys.create).toHaveBeenCalledTimes(1);
    expect(result.apiKey).toMatch(/^openlit-/);
    expect(result.databaseConfigId).toBe('db-1');
  });

  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(generateAPIKey('key')).rejects.toThrow('Unauthorized');
  });

  it('throws when dbConfig is not found', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (asaw as jest.Mock).mockResolvedValue([null, null]);
    await expect(generateAPIKey('key')).rejects.toThrow('DB config not found');
  });
});

describe('getAPIKeyInfo', () => {
  it('calls prisma findFirst with apiKey filter', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, { id: 'key-1' }]);
    (prisma.aPIKeys.findFirst as jest.Mock).mockResolvedValue({ id: 'key-1' });
    await getAPIKeyInfo({ apiKey: 'openlit-abc123' });
    expect(prisma.aPIKeys.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ AND: expect.any(Array) }) })
    );
  });
});

describe('getAllAPIKeys', () => {
  it('returns API keys for the current db config', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { id: 'db-1' }])
      .mockResolvedValueOnce([null, [{ name: 'key1', apiKey: 'openlit-abc' }]]);
    (prisma.aPIKeys.findMany as jest.Mock).mockResolvedValue([{ name: 'key1' }]);

    const result = await getAllAPIKeys();
    expect(prisma.aPIKeys.findMany).toHaveBeenCalledTimes(1);
  });

  it('throws when dbConfig is not found', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([null, null]);
    await expect(getAllAPIKeys()).rejects.toThrow('DB config not found');
  });
});

describe('deleteAPIKey', () => {
  it('marks API key as deleted', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'u@x.com' });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'db-1' }]);
    (prisma.aPIKeys.findFirst as jest.Mock).mockResolvedValue({ id: 'key-id-1' });
    (prisma.aPIKeys.update as jest.Mock).mockResolvedValue({});

    await deleteAPIKey('key-id-1');
    expect(prisma.aPIKeys.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'key-id-1',
          databaseConfigId: 'db-1',
          isDeleted: false,
        }),
      })
    );
    expect(prisma.aPIKeys.update).toHaveBeenCalledWith({
      where: { id: 'key-id-1' },
      data: { isDeleted: true },
    });
  });

  it('throws when API key not found', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'user-1', email: 'u@x.com' });
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'db-1' }]);
    (prisma.aPIKeys.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(deleteAPIKey('key-id-1')).rejects.toThrow('API key not found');
  });
});
