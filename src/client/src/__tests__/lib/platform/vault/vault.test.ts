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
jest.mock('@/utils/crypto', () => ({
  encryptValue: jest.fn((value: string) => `enc:v1:${value}`),
  decryptValue: jest.fn((value: string) => value.replace(/^enc:v1:/, '')),
  isEncrypted: jest.fn((value: string) => value.startsWith('enc:v1:')),
}));

import { getSecretByName, checkNameValidity, deleteSecret, getSecrets, getSecretById, upsertSecret, getSecretsFromDatabaseId } from '@/lib/platform/vault/index';
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
	    expect(query).toContain("created_by = 'user@example.com'");
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
	    expect(query).toContain("v.created_by = 'user@example.com'");
	  });

  it('adds WHERE clause when key filter is provided', async () => {
    await getSecrets({ key: 'my-key' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("v.key = 'my-key'");
  });

  it('adds hasAny tags filter when tags are provided (covers lines 133-135)', async () => {
    await getSecrets({ tags: ['tagA', 'tagB'] });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('hasAny');
    expect(query).toContain('tagA');
    expect(query).toContain('tagB');
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

	  it('does not add session ownership filters for databaseConfigId API-key reads', async () => {
	    await getSecrets({ databaseConfigId: 'db-1' });
	    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
	    expect(query).not.toContain('created_by');
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

import { verifySecretInput, normalizeSecretDataForSDK } from '@/helpers/server/vault';

describe('upsertSecret', () => {
  describe('INSERT path (no id provided)', () => {
    it('inserts a new secret and returns success message', async () => {
      // dataCollector: 1st call for checkNameValidity (getSecretByName), 2nd for insert
      (dataCollector as jest.Mock)
        .mockResolvedValueOnce({ data: [], err: null })   // checkNameValidity -> not taken
        .mockResolvedValueOnce({ err: null });             // insert
      const result = await upsertSecret({ key: 'MY_SECRET', value: 'abc123', tags: [] });
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(dataCollector).toHaveBeenCalledTimes(2);
      // Second call must be the insert
      const [insertParams, insertMode] = (dataCollector as jest.Mock).mock.calls[1];
      expect(insertMode).toBe('insert');
      expect(insertParams.table).toBe('openlit_vault');
      expect(insertParams.values[0]).toMatchObject({ key: 'MY_SECRET', value: 'enc:v1:abc123' });
      expect(result).toEqual({ data: {}, message: 'Secret saved!' });
    });

    it('throws UNAUTHORIZED_USER when no user', async () => {
      (getCurrentUser as jest.Mock).mockResolvedValue(null);
      await expect(upsertSecret({ key: 'k', value: 'v' })).rejects.toThrow('Unauthorized');
      expect(dataCollector).not.toHaveBeenCalled();
    });

    it('throws when verifySecretInput fails', async () => {
      (verifySecretInput as jest.Mock).mockReturnValueOnce({ success: false, err: 'Key required' });
      await expect(upsertSecret({ key: '', value: 'v' })).rejects.toThrow('Key required');
      expect(dataCollector).not.toHaveBeenCalled();
    });

    it('throws SECRET_NAME_TAKEN when name is already taken', async () => {
      // checkNameValidity returns existing record
      (dataCollector as jest.Mock).mockResolvedValueOnce({ data: [{ id: 'existing-1', key: 'MY_SECRET' }] });
      await expect(upsertSecret({ key: 'MY_SECRET', value: 'v' })).rejects.toThrow('Secret name taken');
    });

    it('throws when insert dataCollector returns an error', async () => {
      (dataCollector as jest.Mock)
        .mockResolvedValueOnce({ data: [], err: null })         // checkNameValidity -> available
        .mockResolvedValueOnce({ err: 'Insert failed' });       // insert fails
      await expect(upsertSecret({ key: 'k', value: 'v' })).rejects.toThrow('Insert failed');
    });

    it('includes tags in insert values when provided', async () => {
      (dataCollector as jest.Mock)
        .mockResolvedValueOnce({ data: [], err: null })
        .mockResolvedValueOnce({ err: null });
      await upsertSecret({ key: 'k', value: 'v', tags: ['tagA', 'tagB'] });
      const [insertParams] = (dataCollector as jest.Mock).mock.calls[1];
      expect(insertParams.values[0].tags).toEqual(['tagA', 'tagB']);
    });

    it('records created_by as the current user email', async () => {
      (dataCollector as jest.Mock)
        .mockResolvedValueOnce({ data: [], err: null })
        .mockResolvedValueOnce({ err: null });
      await upsertSecret({ key: 'k', value: 'v' });
      const [insertParams] = (dataCollector as jest.Mock).mock.calls[1];
      expect(insertParams.values[0].created_by).toBe('user@example.com');
    });
  });

  describe('UPDATE path (id provided)', () => {
    it('updates an existing secret and returns success string', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({
        err: null,
        data: { query_id: 'qid-upd-1' },
      });
      const result = await upsertSecret({ id: 'secret-id-1', key: 'NEW_KEY', value: 'new-val', tags: ['t1'] });
      expect(dataCollector).toHaveBeenCalledTimes(1);
      const [{ query }, mode] = (dataCollector as jest.Mock).mock.calls[0];
      expect(mode).toBe('exec');
	      expect(query).toContain('ALTER TABLE');
	      expect(query).toContain('openlit_vault');
	      expect(query).toContain("WHERE id = 'secret-id-1' AND created_by = 'user@example.com'");
	      expect(query).toContain("updated_by = 'user@example.com'");
	      expect(result).toBe('Secret saved!');
	    });

    it('includes key in UPDATE set clause when key is provided', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'qid-1' } });
      await upsertSecret({ id: 'sid', key: 'UPDATED_KEY' });
      const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
      expect(query).toContain("key = 'UPDATED_KEY'");
    });

    it('includes value in UPDATE set clause when value is provided', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'qid-1' } });
      await upsertSecret({ id: 'sid', value: 'new-value' });
      const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
      expect(query).toContain("value = 'enc:v1:new-value'");
    });

    it('includes tags in UPDATE set clause when tags are provided', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'qid-1' } });
      await upsertSecret({ id: 'sid', tags: ['a', 'b'] });
      const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
      expect(query).toContain('tags =');
    });

    it('skips checkNameValidity when id is provided', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'qid-1' } });
      await upsertSecret({ id: 'sid', key: 'k' });
      // Only one dataCollector call: the exec update (no name-validity check)
      expect(dataCollector).toHaveBeenCalledTimes(1);
    });

    it('throws UNAUTHORIZED_USER when no user', async () => {
      (getCurrentUser as jest.Mock).mockResolvedValue(null);
      await expect(upsertSecret({ id: 'sid', key: 'k' })).rejects.toThrow('Unauthorized');
    });

    it('throws SECRET_NOT_SAVED when dataCollector returns an error', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB write error', data: null });
      await expect(upsertSecret({ id: 'sid', key: 'k' })).rejects.toThrow('DB write error');
    });

    it('throws SECRET_NOT_SAVED when query_id is missing from response', async () => {
      (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: null });
      await expect(upsertSecret({ id: 'sid', key: 'k' })).rejects.toThrow('Secret not saved');
    });
  });
});

describe('getSecretsFromDatabaseId', () => {
  it('returns normalized secrets for a valid API key', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: 'db-1', id: 'key-1' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ key: 'MY_SECRET', value: 'abc' }], err: null });
    (normalizeSecretDataForSDK as jest.Mock).mockReturnValue({ MY_SECRET: 'abc' });

    const result = await getSecretsFromDatabaseId({ apiKey: 'openlit-xyz' });

    expect(getAPIKeyInfo).toHaveBeenCalledWith({ apiKey: 'openlit-xyz' });
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('SELECT');
    // selectValue=true so no EXCEPT value
    expect(query).not.toContain('EXCEPT value');
    expect(normalizeSecretDataForSDK).toHaveBeenCalledWith([{ key: 'MY_SECRET', value: 'abc' }]);
    expect(result).toEqual({ MY_SECRET: 'abc' });
  });

  it('throws NO_API_KEY when getAPIKeyInfo returns an error', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue(['Invalid key', null]);
    await expect(getSecretsFromDatabaseId({ apiKey: 'bad-key' })).rejects.toThrow('Invalid key');
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('throws NO_API_KEY when apiInfo has no databaseConfigId', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { id: 'key-1' }]);
    await expect(getSecretsFromDatabaseId({ apiKey: 'some-key' })).rejects.toThrow('No API key');
    expect(dataCollector).not.toHaveBeenCalled();
  });

  it('throws NO_API_KEY when apiInfo is null', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, null]);
    await expect(getSecretsFromDatabaseId({ apiKey: 'some-key' })).rejects.toThrow('No API key');
  });

  it('throws NO_PROMPT when getSecrets returns an error', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: 'Query failed' });
    await expect(getSecretsFromDatabaseId({ apiKey: 'valid-key' })).rejects.toThrow('Query failed');
  });

  it('throws NO_PROMPT when getSecrets returns no data', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: 'db-1' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: null, err: null });
    await expect(getSecretsFromDatabaseId({ apiKey: 'valid-key' })).rejects.toThrow('No prompt');
  });

  it('passes through filters (key, tags) to getSecrets query', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: 'db-2' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ key: 'X', value: '1' }], err: null });
    (normalizeSecretDataForSDK as jest.Mock).mockReturnValue({ X: '1' });

    await getSecretsFromDatabaseId({ apiKey: 'valid-key', key: 'X' });

    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("v.key = 'X'");
  });

  it('forwards databaseConfigId from apiInfo to getSecrets', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: 'db-99' }]);
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ key: 'K', value: 'V' }], err: null });
    (normalizeSecretDataForSDK as jest.Mock).mockReturnValue({ K: 'V' });

    await getSecretsFromDatabaseId({ apiKey: 'valid-key' });

    // dataCollector third arg is databaseConfigId
    const [,, dbConfigId] = (dataCollector as jest.Mock).mock.calls[0];
    expect(dbConfigId).toBe('db-99');
  });
});
