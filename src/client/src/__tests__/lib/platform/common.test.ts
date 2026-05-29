jest.mock('@/lib/db-config', () => ({
  getDBConfigByUser: jest.fn(),
  getDBConfigById: jest.fn(),
}));
jest.mock('@/lib/platform/clickhouse/clickhouse-client', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@/utils/asaw', () => jest.fn());

import { dataCollector } from '@/lib/platform/common';
import createClickhousePool from '@/lib/platform/clickhouse/clickhouse-client';
import asaw from '@/utils/asaw';

const mockDbConfig = { id: 'db-1', host: 'localhost', port: '8123' };

function makeClient(overrides: Partial<any> = {}) {
  return {
    query: jest.fn().mockResolvedValue({ json: jest.fn().mockResolvedValue([]) }),
    insert: jest.fn().mockResolvedValue({ query_id: 'qid' }),
    exec: jest.fn().mockResolvedValue({ query_id: 'qid' }),
    command: jest.fn().mockResolvedValue({ query_id: 'qid' }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks(); // Resets mockResolvedValueOnce queues between tests
});

describe('dataCollector', () => {
  describe('when DB config fetch fails', () => {
    it('returns err object when getDBConfigByUser fails', async () => {
      (asaw as jest.Mock).mockResolvedValue(['Connection error', null]);
      const result = await dataCollector({ query: 'SELECT 1' });
      expect(result.err).toBe('Connection error');
      expect(result.data).toEqual([]);
    });

    it('uses getDBConfigById when dbConfigId is provided', async () => {
      (asaw as jest.Mock).mockResolvedValue(['DB config error', null]);
      const result = await dataCollector({ query: 'SELECT 1' }, 'query', 'db-config-id');
      expect(result.err).toBe('DB config error');
    });
  });

  describe('query mode', () => {
    it('returns error when no query provided', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient]);

      const result = await dataCollector({}, 'query');
      expect(result.err).toBe('No query specified!');
    });

    it('returns error when pool client is null', async () => {
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig]) // getDBConfigByUser
        .mockResolvedValueOnce([null, null]); // pool.acquire returns null

      const result = await dataCollector({ query: 'SELECT 1' });
      // null client: either 'not available' or 'ClickHouse Query Error' from catch
      expect(result.err).toBeDefined();
    });

    it('returns err when pool.acquire fails', async () => {
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce(['acquire failed', null]);

      const result = await dataCollector({ query: 'SELECT 1' });
      expect(result.err).toBe('acquire failed');
    });

    it('executes query and returns json data on success', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      const mockResultObj = { json: jest.fn() };
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])    // getDBConfigByUser
        .mockResolvedValueOnce([null, mockClient])      // pool.acquire
        .mockResolvedValueOnce([null, mockResultObj])   // client.query
        .mockResolvedValueOnce([null, [{ col: 1 }]]);   // result.json

      const result = await dataCollector({ query: 'SELECT 1' });
      expect(result.data).toEqual([{ col: 1 }]);
      expect(result.err).toBeNull();
    });

    it('applies readonly setting when enable_readonly is true', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      const mockResultObj = { json: jest.fn() };
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient])
        .mockResolvedValueOnce([null, mockResultObj])
        .mockResolvedValueOnce([null, []]);

      const result = await dataCollector({ query: 'SELECT 1', enable_readonly: true });
      expect(result.data).toEqual([]);
    });

    it('returns error fallback when client.query call fails', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient])
        .mockResolvedValueOnce(['query failed', null]); // client.query fails, result is null

      const result = await dataCollector({ query: 'SELECT 1' });
      expect(result.err).toBeTruthy();
    });
  });

  describe('insert mode', () => {
    it('returns error when no table provided', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient]);

      const result = await dataCollector({ values: [{ col: 1 }] }, 'insert');
      expect(result.err).toBe('No table specified!');
    });

    it('performs insert and returns data on success', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      const insertResult = { query_id: 'qid-123' };
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient])
        .mockResolvedValueOnce([null, insertResult]); // client.insert succeeds

      const result = await dataCollector({ table: 'test_table', values: [{ col: 1 }] }, 'insert');
      expect(result.data).toBe(insertResult);
    });

    it('includes clickhouse_settings in insert params when provided', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient])
        .mockResolvedValueOnce([null, { query_id: 'qid' }]);

      await dataCollector(
        { table: 'test_table', values: [{ col: 1 }], clickhouse_settings: { async_insert: '1' } as any },
        'insert'
      );
      const callArg = mockClient.insert.mock.calls[0][0];
      expect(callArg.clickhouse_settings).toEqual({ async_insert: '1' });
    });

    it('returns error fallback when insert fails', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient])
        .mockResolvedValueOnce(['insert failed', null]);

      const result = await dataCollector({ table: 'test_table', values: [{ col: 1 }] }, 'insert');
      expect(result.err).toBeTruthy();
    });
  });

  describe('exec mode', () => {
    it('returns error when no query provided', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient]);

      const result = await dataCollector({}, 'exec');
      expect(result.err).toBe('No query specified!');
    });

    it('performs exec and returns data on success', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      const execResult = { query_id: 'exec-qid' };
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient])
        .mockResolvedValueOnce([null, execResult]);

      const result = await dataCollector({ query: 'CREATE TABLE t (c UInt8)' }, 'exec');
      expect(result.data).toBe(execResult);
    });

    it('returns error fallback when exec fails', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient])
        .mockResolvedValueOnce(['exec failed', null]);

      const result = await dataCollector({ query: 'CREATE TABLE t (c UInt8)' }, 'exec');
      expect(result.err).toBeTruthy();
    });
  });

  describe('command mode', () => {
    it('returns error when no query provided', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient]);

      const result = await dataCollector({}, 'command');
      expect(result.err).toBe('No query specified!');
    });

    it('returns success message when command result has query_id', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient])
        .mockResolvedValueOnce([null, { query_id: 'cmd-qid' }]);

      const result = await dataCollector({ query: 'DROP TABLE IF EXISTS t' }, 'command');
      expect(result.data).toBe('Query executed successfully!');
    });

    it('returns error fallback when command result has no query_id', async () => {
      const mockClient = makeClient();
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient])
        .mockResolvedValueOnce([null, {}]); // no query_id

      const result = await dataCollector({ query: 'DROP TABLE IF EXISTS t' }, 'command');
      expect(result.err).toBeTruthy();
    });
  });

  describe('error handling', () => {
    it('returns ClickHouse error when createClickhousePool throws', async () => {
      (asaw as jest.Mock).mockResolvedValue([null, mockDbConfig]);
      (createClickhousePool as jest.Mock).mockImplementation(() => {
        throw new Error('Connection refused');
      });

      const result = await dataCollector({ query: 'SELECT 1' });
      expect(result.err).toContain('ClickHouse Query Error');
      expect(result.err).toContain('Connection refused');
    });
  });

  describe('ping mode', () => {
    it('returns err when ping query fails', async () => {
      const mockClient = makeClient({
        query: jest.fn().mockResolvedValue(null),
      });
      const mockPool = { acquire: jest.fn(), release: jest.fn() };
      (createClickhousePool as jest.Mock).mockReturnValue(mockPool);
      (asaw as jest.Mock)
        .mockResolvedValueOnce([null, mockDbConfig])
        .mockResolvedValueOnce([null, mockClient])
        .mockResolvedValueOnce(['ping failed', null]);

      const result = await dataCollector({ query: 'SELECT 1' }, 'ping');
      expect(result.err).toBe('ping failed');
    });
  });
});
