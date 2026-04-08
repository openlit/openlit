jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    databaseConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    databaseConfigUser: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    databaseConfigInvitedUser: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  },
}));
jest.mock('@/lib/session', () => ({
  getCurrentUser: jest.fn(),
}));
jest.mock('@/lib/organisation', () => ({
  getCurrentOrganisation: jest.fn(),
}));
jest.mock('@/utils/asaw', () => jest.fn());
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
  })),
}));
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  }),
}));
jest.mock('@/clickhouse/migrations', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@/utils/log', () => ({
  consoleLog: jest.fn(),
}));
jest.mock('@/utils/validation', () => ({
  validateDatabaseHost: jest.fn(() => ({ valid: true })),
}));

import {
  getDBConfigByUser,
  getDBConfigById,
  upsertDBConfig,
  deleteDBConfig,
  setCurrentDBConfig,
  shareDBConfig,
  moveSharedDBConfigToDBUser,
} from '@/lib/db-config';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { getCurrentOrganisation } from '@/lib/organisation';
import asaw from '@/utils/asaw';

const mockUser = { id: 'u1', email: 'user@example.com' };
const mockOrg = { id: 'org1', name: 'Test Org' };
const mockDbConfig = {
  id: 'db1',
  name: 'Test DB',
  host: 'localhost',
  port: '8123',
  username: 'admin',
  password: 'pass',
  database: 'default',
  organisationId: 'org1',
  createdByUserId: 'u1',
  createdAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (getCurrentUser as jest.Mock).mockResolvedValue(mockUser);
  (getCurrentOrganisation as jest.Mock).mockResolvedValue(mockOrg);
  (prisma.databaseConfigUser.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.databaseConfigUser.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.databaseConfig.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.databaseConfig.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.databaseConfigUser.count as jest.Mock).mockResolvedValue(0);
});

describe('getDBConfigByUser', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getDBConfigByUser()).rejects.toThrow('Unauthorized');
  });

  it('returns empty array when no db configs', async () => {
    const result = await getDBConfigByUser();
    expect(result).toEqual([]);
  });

  it('returns configs with permissions and isCurrent flag', async () => {
    const mockUserConfig = {
      databaseConfigId: 'db1',
      isCurrent: true,
      databaseConfig: mockDbConfig,
      canEdit: true,
      canDelete: true,
      canShare: false,
    };
    (prisma.databaseConfigUser.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // orphaned configs query
      .mockResolvedValueOnce([mockUserConfig]); // user configs query
    const result = await getDBConfigByUser();
    expect(result).toHaveLength(1);
    expect(result[0].isCurrent).toBe(true);
    expect(result[0].permissions.canEdit).toBe(true);
    expect(result[0].permissions.canShare).toBe(false);
  });

  it('returns currentOnly config when currentOnly=true', async () => {
    (prisma.databaseConfigUser.findFirst as jest.Mock).mockResolvedValue({
      databaseConfig: mockDbConfig,
    });
    const result = await getDBConfigByUser(true);
    expect(result).toEqual(mockDbConfig);
  });

  it('returns undefined when no current config (currentOnly=true)', async () => {
    const result = await getDBConfigByUser(true);
    expect(result).toBeUndefined();
  });

  it('auto-migrates orphaned configs when org exists', async () => {
    (prisma.databaseConfigUser.findMany as jest.Mock)
      .mockResolvedValueOnce([{ databaseConfigId: 'db-orphan' }]) // orphaned
      .mockResolvedValueOnce([]); // user configs
    (prisma.databaseConfig.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    await getDBConfigByUser();
    expect(prisma.databaseConfig.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { organisationId: 'org1' } })
    );
  });

  it('does not auto-migrate when no current org', async () => {
    (getCurrentOrganisation as jest.Mock).mockResolvedValue(null);
    await getDBConfigByUser();
    expect(prisma.databaseConfig.updateMany).not.toHaveBeenCalled();
  });
});

describe('getDBConfigById', () => {
  it('returns the db config by id', async () => {
    (prisma.databaseConfig.findUnique as jest.Mock).mockResolvedValue(mockDbConfig);
    const result = await getDBConfigById({ id: 'db1' });
    expect(result).toEqual(mockDbConfig);
    expect(prisma.databaseConfig.findUnique).toHaveBeenCalledWith({ where: { id: 'db1' } });
  });

  it('returns null when not found', async () => {
    const result = await getDBConfigById({ id: 'nonexistent' });
    expect(result).toBeNull();
  });
});

describe('upsertDBConfig', () => {
  const validConfig = {
    name: 'My DB',
    username: 'admin',
    host: 'localhost',
    port: '8123',
    database: 'default',
  };

  it('throws when name is missing', async () => {
    await expect(
      upsertDBConfig({ username: 'a', host: 'b', port: '1', database: 'd' })
    ).rejects.toThrow('No name provided');
  });

  it('throws when username is missing', async () => {
    await expect(
      upsertDBConfig({ name: 'a', host: 'b', port: '1', database: 'd' })
    ).rejects.toThrow('No username provided');
  });

  it('throws when host is missing', async () => {
    await expect(
      upsertDBConfig({ name: 'a', username: 'b', port: '1', database: 'd' })
    ).rejects.toThrow('No host provided');
  });

  it('throws when port is missing', async () => {
    await expect(
      upsertDBConfig({ name: 'a', username: 'b', host: 'c', database: 'd' })
    ).rejects.toThrow('No port provided');
  });

  it('throws when database is missing', async () => {
    await expect(
      upsertDBConfig({ name: 'a', username: 'b', host: 'c', port: '1' })
    ).rejects.toThrow('No database provided');
  });

  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(upsertDBConfig(validConfig)).rejects.toThrow('Unauthorized');
  });

  it('throws when db name already exists', async () => {
    (prisma.databaseConfig.findFirst as jest.Mock).mockResolvedValue({ id: 'other-db' });
    await expect(upsertDBConfig(validConfig)).rejects.toThrow('DB config Name already exists');
  });

  it('creates new config with org (org upsert path)', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([null, { id: 'new-db', organisationId: 'org1' }]);
    (prisma.databaseConfig.findUnique as jest.Mock).mockResolvedValue({ organisationId: 'org1' });
    (prisma.databaseConfigUser.create as jest.Mock).mockResolvedValue({});

    const result = await upsertDBConfig(validConfig);
    expect(result).toBe('Added db details successfully');
  });

  it('creates config without org (no-org create path)', async () => {
    (getCurrentOrganisation as jest.Mock).mockResolvedValue(null);
    (prisma.databaseConfig.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // name uniqueness check
      .mockResolvedValueOnce(null); // check if existing (no-org path)
    (prisma.databaseConfig.create as jest.Mock).mockResolvedValue({ id: 'new-db' });
    (prisma.databaseConfig.findUnique as jest.Mock).mockResolvedValue({ organisationId: null });
    (prisma.databaseConfigUser.create as jest.Mock).mockResolvedValue({});

    const result = await upsertDBConfig(validConfig);
    expect(result).toBe('Added db details successfully');
    expect(prisma.databaseConfig.create).toHaveBeenCalled();
  });

  it('updates existing config without org (no-org update path)', async () => {
    (getCurrentOrganisation as jest.Mock).mockResolvedValue(null);
    (prisma.databaseConfig.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // name uniqueness check
      .mockResolvedValueOnce({ id: 'existing-db' }); // existing no-org config
    (prisma.databaseConfig.update as jest.Mock).mockResolvedValue({ id: 'existing-db' });
    (prisma.databaseConfig.findUnique as jest.Mock).mockResolvedValue({ organisationId: null });
    (prisma.databaseConfigUser.create as jest.Mock).mockResolvedValue({});

    const result = await upsertDBConfig(validConfig);
    expect(result).toBe('Added db details successfully');
    expect(prisma.databaseConfig.update).toHaveBeenCalled();
  });

  it('updates config when id is provided', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { canEdit: true, canDelete: true, canShare: true }]) // checkPermissionForDbAction
      .mockResolvedValueOnce([null, { id: 'db1' }]); // upsert with id

    const result = await upsertDBConfig(validConfig, 'db1');
    expect(result).toBe('Updated db details successfully');
  });

  it('throws when upsert fails', async () => {
    (asaw as jest.Mock).mockResolvedValueOnce([new Error('DB error'), null]);
    await expect(upsertDBConfig(validConfig)).rejects.toThrow('DB error');
  });

  it('throws when user lacks edit permission (covers line 509 in checkPermissionForDbAction)', async () => {
    // checkPermissionForDbAction(userId, id, "EDIT") internally calls asaw(prisma.findFirst)
    // mock that inner asaw to return a config with canEdit=false
    (asaw as jest.Mock).mockResolvedValueOnce([null, { canEdit: false, canDelete: true, canShare: true }]);
    await expect(upsertDBConfig(validConfig, 'db1')).rejects.toThrow(
      "User doesn't have permission to edit the database config"
    );
  });
});

describe('deleteDBConfig', () => {
  beforeEach(() => {
    (asaw as jest.Mock).mockResolvedValue([null, { canDelete: true }]);
    (prisma.databaseConfigUser.delete as jest.Mock).mockResolvedValue({});
    (prisma.databaseConfig.delete as jest.Mock).mockResolvedValue({});
  });

  it('deletes the db config and user link', async () => {
    const result = await deleteDBConfig('db1');
    expect(result).toBe('Deleted successfully!');
    expect(prisma.databaseConfig.delete).toHaveBeenCalledWith({ where: { id: 'db1' } });
  });

  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(deleteDBConfig('db1')).rejects.toThrow('Unauthorized');
  });

  it('throws when user lacks delete permission', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, { canDelete: false }]);
    await expect(deleteDBConfig('db1')).rejects.toThrow(
      "User doesn't have permission to delete the database config"
    );
  });

  it('throws when db config not found', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, null]);
    await expect(deleteDBConfig('nonexistent')).rejects.toThrow(
      "Database config doesn't exist"
    );
  });

  it('throws when checkPermission returns error', async () => {
    (asaw as jest.Mock).mockResolvedValue(['Permission error', null]);
    await expect(deleteDBConfig('db1')).rejects.toThrow('Permission error');
  });
});

describe('setCurrentDBConfig', () => {
  it('sets a new current db config (unsets old current)', async () => {
    (prisma.databaseConfigUser.findFirst as jest.Mock).mockResolvedValue({
      databaseConfig: { id: 'old-db' },
    });
    (prisma.databaseConfigUser.update as jest.Mock).mockResolvedValue({});

    const result = await setCurrentDBConfig('new-db');
    expect(result).toBe('Current DB config set successfully!');
    expect(prisma.databaseConfigUser.update).toHaveBeenCalledTimes(2);
  });

  it('sets current db config when no existing current', async () => {
    (prisma.databaseConfigUser.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.databaseConfigUser.update as jest.Mock).mockResolvedValue({});

    const result = await setCurrentDBConfig('new-db');
    expect(result).toBe('Current DB config set successfully!');
    expect(prisma.databaseConfigUser.update).toHaveBeenCalledTimes(1);
  });

  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(setCurrentDBConfig('db1')).rejects.toThrow('Unauthorized');
  });
});

describe('shareDBConfig', () => {
  it('throws when no id or empty shareArray', async () => {
    await expect(shareDBConfig({ id: '', shareArray: [] })).rejects.toThrow(
      'No user to share!'
    );
  });

  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(
      shareDBConfig({ id: 'db1', shareArray: [{ email: 'a@b.com' }] })
    ).rejects.toThrow('Unauthorized');
  });

  it('shares with existing user who has no access', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { canShare: true, canEdit: true, canDelete: true }]) // checkPermissionForDbAction
      .mockResolvedValueOnce([null, { id: 'u2', email: 'other@example.com' }]) // user.findUnique
      .mockResolvedValueOnce([null, null]); // databaseConfigUser.findFirst (no existing)
    (prisma.databaseConfig.findUnique as jest.Mock).mockResolvedValue({ organisationId: null });
    (prisma.databaseConfigUser.create as jest.Mock).mockResolvedValue({});

    const result = await shareDBConfig({
      id: 'db1',
      shareArray: [{ email: 'other@example.com' }],
    });
    expect(result).toHaveLength(1);
    expect(result[0][1]).toEqual({ success: true });
  });

  it('returns error when user already has access', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { canShare: true }]) // checkPermissionForDbAction
      .mockResolvedValueOnce([null, { id: 'u2' }]) // user.findUnique
      .mockResolvedValueOnce([null, { id: 'existing-link' }]); // already has access

    const result = await shareDBConfig({
      id: 'db1',
      shareArray: [{ email: 'other@example.com' }],
    });
    expect(result[0][0]).toContain('Already shared');
    expect(result[0][1]).toEqual({ success: false });
  });

  it('creates invitation for non-existing user', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { canShare: true, canEdit: true, canDelete: true }]) // checkPermissionForDbAction
      .mockResolvedValueOnce([null, null]) // user.findUnique (not found)
      .mockResolvedValueOnce([null, {}]); // databaseConfigInvitedUser.create

    const result = await shareDBConfig({
      id: 'db1',
      shareArray: [{ email: 'new@example.com' }],
    });
    expect(result[0][1]).toEqual({ success: true });
  });

  it('returns failure when invitation create fails', async () => {
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, { canShare: true, canEdit: false, canDelete: false }])
      .mockResolvedValueOnce([null, null]) // user not found
      .mockResolvedValueOnce(['Create failed', null]); // invitation create error

    const result = await shareDBConfig({
      id: 'db1',
      shareArray: [{ email: 'new@example.com' }],
    });
    expect(result[0][1]).toEqual({ success: false });
  });
});

describe('moveSharedDBConfigToDBUser', () => {
  it('returns early when error from findMany', async () => {
    (asaw as jest.Mock).mockResolvedValue(['DB error', null]);
    const result = await moveSharedDBConfigToDBUser('user@example.com', 'u1');
    expect(result).toBeUndefined();
  });

  it('returns early when no shared configs', async () => {
    (asaw as jest.Mock).mockResolvedValue([null, []]);
    const result = await moveSharedDBConfigToDBUser('user@example.com', 'u1');
    expect(result).toBeUndefined();
  });

  it('creates user entries from shared configs (has current config)', async () => {
    const sharedConfigs = [
      { databaseConfigId: 'db1', canDelete: false, canEdit: false, canShare: false },
    ];
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, sharedConfigs])
      .mockResolvedValueOnce([null, {}]); // createMany
    (prisma.databaseConfigUser.count as jest.Mock).mockResolvedValue(1); // has current

    await moveSharedDBConfigToDBUser('user@example.com', 'u1');
    expect(asaw).toHaveBeenCalledTimes(2);
  });

  it('sets first db config as current when user has no current', async () => {
    const sharedConfigs = [
      { databaseConfigId: 'db1', canDelete: false, canEdit: false, canShare: false },
    ];
    (asaw as jest.Mock)
      .mockResolvedValueOnce([null, sharedConfigs])
      .mockResolvedValueOnce([null, {}]); // createMany
    (prisma.databaseConfigUser.count as jest.Mock).mockResolvedValue(0); // no current
    (prisma.databaseConfigUser.findFirst as jest.Mock).mockResolvedValue({
      databaseConfigId: 'db1',
    });
    (prisma.databaseConfigUser.update as jest.Mock).mockResolvedValue({});

    await moveSharedDBConfigToDBUser('user@example.com', 'u1');
    expect(prisma.databaseConfigUser.update).toHaveBeenCalled();
  });
});
