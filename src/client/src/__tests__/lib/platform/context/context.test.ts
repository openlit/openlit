jest.mock('@/lib/platform/common', () => ({ dataCollector: jest.fn() }));
jest.mock('@/lib/platform/context/table-details', () => ({
  OPENLIT_CONTEXTS_TABLE_NAME: 'openlit_contexts',
}));
jest.mock('@/lib/session', () => ({ getCurrentUser: jest.fn() }));
jest.mock('@/utils/error', () => ({
  throwIfError: jest.fn((cond: boolean, msg: string) => { if (cond) throw new Error(msg); }),
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    UNAUTHORIZED_USER: 'Unauthorized',
    CONTEXT_NOT_CREATED: 'Context not created',
    CONTEXT_CREATED: 'Context created!',
    CONTEXT_NOT_UPDATED: 'Context not updated',
    CONTEXT_UPDATED: 'Context updated!',
    CONTEXT_NOT_DELETED: 'Context not deleted',
    CONTEXT_DELETED: 'Context deleted!',
  })),
}));
jest.mock('@/utils/sanitizer', () => ({
  __esModule: true,
  default: {
    sanitizeValue: jest.fn((v: string) => v),
    sanitizeObject: jest.fn((o: object) => o),
  },
}));
jest.mock('@/helpers/server/context', () => ({
  verifyContextInput: jest.fn(() => ({ success: true })),
}));

import { getContexts, getContextById, createContext, updateContext, deleteContext } from '@/lib/platform/context/index';
import { dataCollector } from '@/lib/platform/common';
import { getCurrentUser } from '@/lib/session';
import { verifyContextInput } from '@/helpers/server/context';

beforeEach(() => {
  jest.clearAllMocks();
  (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'user@example.com' });
  (verifyContextInput as jest.Mock).mockReturnValue({ success: true });
});

describe('getContexts', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getContexts()).rejects.toThrow('Unauthorized');
  });

  it('calls dataCollector with SELECT query', async () => {
    await getContexts();
    expect(dataCollector).toHaveBeenCalledTimes(1);
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('SELECT');
    expect(query).toContain('openlit_contexts');
  });

  it('passes databaseConfigId to dataCollector', async () => {
    await getContexts('db-99');
    expect(dataCollector).toHaveBeenCalledWith(expect.any(Object), 'query', 'db-99');
  });

  it('returns dataCollector result', async () => {
    const ctx = { id: 'c1', name: 'My Context' };
    (dataCollector as jest.Mock).mockResolvedValue({ data: [ctx], err: null });
    const result = await getContexts();
    expect(result).toEqual({ data: [ctx], err: null });
  });
});

describe('getContextById', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(getContextById('ctx-1')).rejects.toThrow('Unauthorized');
  });

  it('calls dataCollector with id in WHERE clause', async () => {
    await getContextById('ctx-123');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain("ctx-123");
    expect(query).toContain('openlit_contexts');
  });

  it('passes databaseConfigId', async () => {
    await getContextById('c1', 'db-1');
    expect(dataCollector).toHaveBeenCalledWith(expect.any(Object), 'query', 'db-1');
  });
});

describe('createContext', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(createContext({ name: 'ctx', content: 'text' })).rejects.toThrow('Unauthorized');
  });

  it('throws when verifyContextInput fails', async () => {
    (verifyContextInput as jest.Mock).mockReturnValue({ success: false, err: 'Name required' });
    await expect(createContext({ content: 'text' })).rejects.toThrow('Name required');
  });

  it('throws when dataCollector insert fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'Insert failed', data: null });
    await expect(createContext({ name: 'ctx', content: 'text' })).rejects.toThrow();
  });

  it('returns message and id on success', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: {} });
    const result = await createContext({ name: 'ctx', content: 'text' });
    expect(result).toMatchObject({ message: 'Context created!', id: expect.any(String) });
  });

  it('inserts into openlit_contexts table', async () => {
    await createContext({ name: 'My Ctx', content: 'body' });
    const [{ table }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(table).toBe('openlit_contexts');
  });
});

describe('updateContext', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(updateContext('c1', { name: 'x', content: 'y' })).rejects.toThrow('Unauthorized');
  });

  it('throws when verifyContextInput fails', async () => {
    (verifyContextInput as jest.Mock).mockReturnValue({ success: false, err: 'Content required' });
    await expect(updateContext('c1', { name: 'x' })).rejects.toThrow('Content required');
  });

  it('throws when dataCollector exec fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'DB error', data: null });
    await expect(updateContext('c1', { name: 'x', content: 'y' })).rejects.toThrow();
  });

  it('returns CONTEXT_UPDATED message on success', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'q1' } });
    const result = await updateContext('c1', { name: 'x', content: 'y' });
    expect(result).toEqual({ message: 'Context updated!' });
  });

  it('includes context id in the query', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null, data: { query_id: 'q1' } });
    await updateContext('ctx-abc', { name: 'x', content: 'y' });
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('ctx-abc');
  });
});

describe('deleteContext', () => {
  it('throws when user is not authenticated', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(deleteContext('c1')).rejects.toThrow('Unauthorized');
  });

  it('returns error message array when delete fails', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: 'Delete failed' });
    const result = await deleteContext('c1');
    expect(result).toEqual(['Context not deleted']);
  });

  it('returns [undefined, success message] on success', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    const result = await deleteContext('c1');
    expect(result).toEqual([undefined, 'Context deleted!']);
  });

  it('includes context id in the delete query', async () => {
    (dataCollector as jest.Mock).mockResolvedValue({ err: null });
    await deleteContext('ctx-xyz');
    const [{ query }] = (dataCollector as jest.Mock).mock.calls[0];
    expect(query).toContain('ctx-xyz');
    expect(query).toContain('DELETE');
  });
});
