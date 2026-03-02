jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
}));
jest.mock('@/lib/platform/vault/table-details', () => ({
  OPENLIT_VAULT_TABLE_NAME: 'openlit_vault',
}));
jest.mock('@/lib/session', () => ({
  getCurrentUser: jest.fn(),
}));
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((condition: boolean, msg: string) => {
    if (condition) throw new Error(msg);
  }),
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
    SECRET_NAME_TAKEN: 'Secret name taken',
    SECRET_SAVED: 'Secret saved!',
    SECRET_NOT_SAVED: 'Secret not saved',
    SECRET_DELETED: 'Secret deleted!',
    SECRET_NOT_DELETED: 'Secret not deleted',
    NO_API_KEY: 'No API key',
    NO_PROMPT: 'No prompt',
  })),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: {
    sanitizeValue: jest.fn((v: string) => v),
    sanitizeObject: jest.fn((o: object) => o),
  },
}));
jest.mock('@/helpers/server/vault', () => ({
  verifySecretInput: jest.fn(() => ({ success: true })),
  normalizeSecretDataForSDK: jest.fn((data: any[]) => data),
}));
jest.mock('@/utils/json', () => ({
  jsonStringify: jest.fn((v: unknown) => JSON.stringify(v)),
}));
jest.mock('@/lib/platform/api-keys', () => ({
  getAPIKeyInfo: jest.fn(),
}));

import { getSecretByName, checkNameValidity, deleteSecret, getSecrets, getSecretById } from '@/lib/platform/vault/index';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';
import { getAPIKeyInfo } from '@/lib/platform/api-keys';

beforeEach(() => {
  jest.clearAllMocks();
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'user@example.com' });
});

describe('getSecretByName', () => {
  it('calls dataCollector with SELECT query and returns first record', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ id: 'v1', key: 'my-secret' }] });
    const result = await getSecretByName({ key: 'my-secret' });
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const { query } = (dataCollector as jest.Mock).mock.calls[0][0];
    expect(query).toContain("key='my-secret'");
    expect(result).toEqual({ id: 'v1', key: 'my-secret' });
  });

  it('returns undefined when no secret found', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [] });
    const result = await getSecretByName({ key: 'unknown' });
    expect(result).toBeUndefined();
  });
});

describe('checkNameValidity', () => {
  it('returns isValid=true when no existing secret', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [] });
    const result = await checkNameValidity({ key: 'new-key' });
    expect(result.isValid).toBe(true);
  });

  it('returns isValid=false when secret name already exists', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ id: 'v1', key: 'taken' }] });
    const result = await checkNameValidity({ key: 'taken' });
    expect(result.isValid).toBe(false);
  });
});

describe('deleteSecret', () => {
  it('returns success message when delete succeeds', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    const result = await deleteSecret('secret-id-1');
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('DELETE FROM');
    expect(query).toContain('secret-id-1');
    expect(result[0]).toBeUndefined(); // no error
  });

  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(deleteSecret('secret-id-1')).rejects.toThrow('Unauthorized');
  });

  it('returns error message when delete fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB error' });
    const result = await deleteSecret('secret-id-1');
    expect(result[0]).toBeDefined(); // error message
  });
});

describe('getSecrets', () => {
  it('calls dataCollector with SELECT query', async () => {
    await getSecrets({});
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('SELECT');
    expect(query).toContain('openlit_vault');
  });

  it('adds WHERE clause when key filter is provided', async () => {
    await getSecrets({ key: 'my-key' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("v.key = 'my-key'");
  });

  it('includes value in SELECT when selectValue is true', async () => {
    await getSecrets({}, { selectValue: true });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).not.toContain('EXCEPT value');
  });

  it('excludes value in SELECT by default', async () => {
    await getSecrets({});
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('EXCEPT value');
  });

  it('throws when user not authenticated (no databaseConfigId)', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getSecrets({ key: 'my-key' })).rejects.toThrow('Unauthorized');
  });

  it('bypasses auth check when databaseConfigId is provided', async () => {
    await expect(getSecrets({ databaseConfigId: 'db-1' })).resolves.toBeDefined();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });
});

describe('getSecretById', () => {
  it('calls dataCollector with id filter', async () => {
    await getSecretById('v1');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("v.id = 'v1'");
    expect(query).toContain('EXCEPT value');
  });

  it('includes value when excludeVaultValue is false', async () => {
    await getSecretById('v1', undefined, false);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).not.toContain('EXCEPT value');
  });
});
