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
