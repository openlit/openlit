/**
 * Cross-language trace comparison tests for Astra DB integration.
 *
 * Verifies TypeScript SDK trace attributes match the Python SDK's Astra
 * instrumentation behavior for Collection operations.
 */

import AstraWrapper from '../astra/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');

describe('Astra DB Cross-Language Trace Comparison', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      addEvent: jest.fn(),
      end: jest.fn(),
      setStatus: jest.fn(),
    };

    mockTracer = {
      startSpan: jest.fn().mockReturnValue(mockSpan),
    };

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenLitHelper as any).handleException = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  async function invokeAsyncWrapped(
    dbOperation: string,
    args: any[],
    returnValue: any = {},
    instance: any = { name: 'movies' }
  ) {
    const patchFn = AstraWrapper._patchCollectionMethod(mockTracer, dbOperation);
    const originalMethod = jest.fn().mockResolvedValue(returnValue);
    const wrapped = patchFn(originalMethod);
    const response = await wrapped.call(instance, ...args);

    return { originalMethod, response };
  }

  describe('common attributes', () => {
    it('sets Python parity common database and resource attributes', async () => {
      await invokeAsyncWrapped(
        SemanticConvention.DB_OPERATION_INSERT,
        [{ _id: '1', title: 'Dune' }],
        { insertedId: '1' }
      );

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_SYSTEM_NAME, 'astra');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_OPERATION_NAME, 'INSERT');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_COLLECTION_NAME, 'movies');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('telemetry.sdk.name', 'openlit');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OPERATION,
        SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT,
        'openlit-testing'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('service.name', 'openlit-test');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_SDK_VERSION, expect.any(String));
    });

    it('extracts server address and port from a URL endpoint', async () => {
      await invokeAsyncWrapped(
        SemanticConvention.DB_OPERATION_SELECT,
        [{ genre: 'sci-fi' }],
        { _id: '1' },
        { name: 'movies', database: { apiEndpoint: 'https://db.example.apps.astra.datastax.com:8443' } }
      );

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.SERVER_ADDRESS,
        'db.example.apps.astra.datastax.com'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 8443);
    });

    it('extracts server address and port from a host:port endpoint', async () => {
      await invokeAsyncWrapped(
        SemanticConvention.DB_OPERATION_SELECT,
        [{ genre: 'sci-fi' }],
        { _id: '1' },
        { name: 'movies', client: { api_endpoint: 'astra.local:9090' } }
      );

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'astra.local');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 9090);
    });

    it('falls back to the Astra default server when no endpoint is present', async () => {
      await invokeAsyncWrapped(SemanticConvention.DB_OPERATION_SELECT, [{}], null);

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'astra.datastax.com');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 443);
    });
  });

  describe('insert operations', () => {
    it('sets documents count, query text, returned rows, and summary', async () => {
      const documents = [{ _id: '1' }, { _id: '2' }];
      await invokeAsyncWrapped(
        SemanticConvention.DB_OPERATION_INSERT,
        [documents],
        { insertedIds: ['1', '2'] }
      );

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_DOCUMENTS_COUNT, 2);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_QUERY_TEXT, JSON.stringify(documents));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, 2);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_QUERY_SUMMARY,
        'INSERT movies documents_count=2'
      );
    });
  });

  describe('update operations', () => {
    it('sets filter, update query text, returned rows, and summary', async () => {
      const filter = { status: 'draft' };
      const update = { $set: { status: 'published' } };
      await invokeAsyncWrapped(
        SemanticConvention.DB_OPERATION_UPDATE,
        [filter, update],
        { update_info: { nModified: 3 } }
      );

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_FILTER, JSON.stringify(filter));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_QUERY_TEXT, JSON.stringify(update));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, 3);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_QUERY_SUMMARY,
        `UPDATE movies filter=${JSON.stringify(filter)} update=${JSON.stringify(update)}`
      );
    });
  });

  describe('replace operations', () => {
    it('sets replace filter and summary without upsert', async () => {
      const filter = { _id: '1' };
      await invokeAsyncWrapped(
        SemanticConvention.DB_OPERATION_REPLACE,
        [filter, { _id: '1', title: 'Dune Messiah' }, { upsert: false }],
        { modifiedCount: 1 }
      );

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_OPERATION_NAME, 'findAndModify');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_FILTER, JSON.stringify(filter));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_QUERY_TEXT, JSON.stringify(filter));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_QUERY_SUMMARY,
        `findAndModify movies filter=${JSON.stringify(filter)} upsert=false`
      );
    });

    it('detects replace upsert and sets db.operation.name = UPSERT', async () => {
      await invokeAsyncWrapped(
        SemanticConvention.DB_OPERATION_REPLACE,
        [{ _id: 'missing' }, { _id: 'missing' }, { upsert: true }],
        { upsertedId: 'missing' }
      );

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        SemanticConvention.DB_OPERATION_UPSERT
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_QUERY_SUMMARY,
        'UPSERT movies filter={"_id":"missing"} upsert=true'
      );
    });
  });

  describe('select operations', () => {
    it('sets findOne filter, query text, returned rows, and summary', async () => {
      const filter = { genre: 'sci-fi' };
      await invokeAsyncWrapped(SemanticConvention.DB_OPERATION_SELECT, [filter], { _id: '1' });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_FILTER, JSON.stringify(filter));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_QUERY_TEXT, JSON.stringify(filter));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, 1);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_QUERY_SUMMARY,
        `SELECT movies filter=${JSON.stringify(filter)}`
      );
    });

    it('keeps find() synchronous and returns the original cursor', () => {
      const cursor = { toArray: jest.fn() };
      const patchFn = AstraWrapper._patchSyncFindMethod(mockTracer);
      const originalMethod = jest.fn().mockReturnValue(cursor);
      const wrapped = patchFn(originalMethod);
      const result = wrapped.call({ name: 'movies' }, { genre: 'sci-fi' });

      expect(result).toBe(cursor);
      expect((result as any).then).toBeUndefined();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_QUERY_SUMMARY,
        'SELECT movies filter={"genre":"sci-fi"}'
      );
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  describe('delete operations', () => {
    it('sets delete filter, query text, returned rows, and summary', async () => {
      const filter = { expired: true };
      await invokeAsyncWrapped(SemanticConvention.DB_OPERATION_DELETE, [filter], { deletedCount: 4 });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_FILTER, JSON.stringify(filter));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_QUERY_TEXT, JSON.stringify(filter));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, 4);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_QUERY_SUMMARY,
        `DELETE movies filter=${JSON.stringify(filter)}`
      );
    });

    it('sets findOneAndDelete returned rows from the deleted document response', async () => {
      await invokeAsyncWrapped(
        SemanticConvention.DB_OPERATION_FIND_AND_DELETE,
        [{ _id: '1' }],
        { _id: '1' }
      );

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, 1);
    });
  });

  it('does not set db.query.text when captureMessageContent is false', async () => {
    (OpenlitConfig as any).captureMessageContent = false;

    await invokeAsyncWrapped(SemanticConvention.DB_OPERATION_SELECT, [{ genre: 'sci-fi' }], { _id: '1' });

    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      SemanticConvention.DB_QUERY_TEXT,
      expect.anything()
    );
  });

  it('calls handleException and ends the span on error', async () => {
    const error = new Error('Astra request failed');
    const patchFn = AstraWrapper._patchCollectionMethod(mockTracer, SemanticConvention.DB_OPERATION_SELECT);
    const originalMethod = jest.fn().mockRejectedValue(error);
    const wrapped = patchFn(originalMethod);

    await expect(wrapped.call({ name: 'movies' }, { genre: 'sci-fi' })).rejects.toThrow('Astra request failed');
    expect(OpenLitHelper.handleException).toHaveBeenCalledWith(mockSpan, error);
    expect(mockSpan.end).toHaveBeenCalled();
  });
});
