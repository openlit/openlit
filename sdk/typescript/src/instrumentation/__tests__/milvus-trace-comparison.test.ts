/**
 * Cross-Language Trace Comparison Tests for Milvus Integration
 *
 * Verifies TypeScript SDK trace attributes match Python SDK.
 *
 * Python SDK reference: sdk/python/src/openlit/instrumentation/milvus/milvus.py
 *
 * Key alignment:
 *   - db.system.name = 'milvus'
 *   - db.operation.name: SEARCH, INSERT, UPSERT, DELETE, QUERY
 *   - server.address, server.port (default localhost:19530)
 *   - db.vector.query.top_k for search
 *   - db.filter for expr/filter params
 *   - db.vector.count for insert/upsert
 *   - db.query.summary
 */

import MilvusWrapper from '../milvus/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');

describe('Milvus Cross-Language Trace Comparison', () => {
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
    (OpenlitConfig as any).traceContent = true;
    (OpenLitHelper as any).handleException = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Common attributes ────────────────────────────────────────────────────

  it('should set db.system.name = "milvus" matching Python DB_SYSTEM_MILVUS', async () => {
    const patchFn = MilvusWrapper._patchSearch(mockTracer);
    const originalMethod = jest.fn().mockResolvedValue({ results: [] });
    const wrapped = patchFn(originalMethod);
    await wrapped.call({}, { collection_name: 'test', vectors: [[0.1]], topk: 5 });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_SYSTEM_NAME, 'milvus');
  });

  it('should set server.address = localhost and server.port = 19530', async () => {
    const patchFn = MilvusWrapper._patchSearch(mockTracer);
    const originalMethod = jest.fn().mockResolvedValue({ results: [] });
    const wrapped = patchFn(originalMethod);
    await wrapped.call({}, { collection_name: 'test', vectors: [[0.1]], topk: 5 });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'localhost');
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 19530);
  });

  // ── search → SEARCH ───────────────────────────────────────────────────────

  describe('search() → SEARCH', () => {
    async function runSearch(params: any, returnValue: any = { results: [] }) {
      const patchFn = MilvusWrapper._patchSearch(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue(returnValue);
      const wrapped = patchFn(originalMethod);
      await wrapped.call({}, params);
    }

    it('should set db.operation.name = "SEARCH"', async () => {
      await runSearch({ collection_name: 'embeddings', vectors: [[0.1]], topk: 10 });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'SEARCH'
      );
    });

    it('should set db.collection.name from collection_name param', async () => {
      await runSearch({ collection_name: 'my_embeddings', vectors: [[0.1]], topk: 5 });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_COLLECTION_NAME,
        'my_embeddings'
      );
    });

    it('should set db.vector.query.top_k from topk param', async () => {
      await runSearch({ collection_name: 'col', vectors: [[0.1]], topk: 20 });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_VECTOR_QUERY_TOP_K, 20);
    });

    it('should also accept "limit" as top_k param', async () => {
      await runSearch({ collection_name: 'col', vectors: [[0.1]], limit: 15 });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_VECTOR_QUERY_TOP_K, 15);
    });

    it('should set db.filter when expr provided', async () => {
      await runSearch({
        collection_name: 'col',
        vectors: [[0.1]],
        topk: 5,
        expr: 'category == "books"',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_FILTER,
        'category == "books"'
      );
    });

    it('should set db.n_results from results length', async () => {
      await runSearch(
        { collection_name: 'col', vectors: [[0.1]], topk: 5 },
        { results: [{ id: 1 }, { id: 2 }] }
      );

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_N_RESULTS, 2);
    });
  });

  // ── insert → INSERT ───────────────────────────────────────────────────────

  describe('insert() → INSERT (matches Python DB_OPERATION_INSERT)', () => {
    async function runInsert(params: any) {
      const patchFn = MilvusWrapper._patchInsert(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue({ insert_cnt: params.data?.length ?? 0 });
      const wrapped = patchFn(originalMethod);
      await wrapped.call({}, params);
    }

    it('should set db.operation.name = "INSERT"', async () => {
      await runInsert({ collection_name: 'col', data: [{ id: 1, vector: [0.1] }] });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'INSERT'
      );
    });

    it('should set db.vector.count from data length', async () => {
      await runInsert({
        collection_name: 'col',
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_VECTOR_COUNT, 3);
    });

    it('should also work with collectionName (camelCase) param', async () => {
      const patchFn = MilvusWrapper._patchInsert(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue({});
      const wrapped = patchFn(originalMethod);
      await wrapped.call({}, { collectionName: 'camelCase', data: [{ id: 1 }] });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_COLLECTION_NAME,
        'camelCase'
      );
    });
  });

  // ── upsert → UPSERT ───────────────────────────────────────────────────────

  describe('upsert() → UPSERT', () => {
    it('should set db.operation.name = "UPSERT" and db.vector.count', async () => {
      const patchFn = MilvusWrapper._patchUpsert(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue({});
      const wrapped = patchFn(originalMethod);
      await wrapped.call({}, {
        collection_name: 'col',
        data: [{ id: 1, vector: [0.1] }, { id: 2, vector: [0.2] }],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'UPSERT'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_VECTOR_COUNT, 2);
    });
  });

  // ── delete → DELETE ───────────────────────────────────────────────────────

  describe('delete() → DELETE', () => {
    it('should set db.operation.name = "DELETE"', async () => {
      const patchFn = MilvusWrapper._patchDelete(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue({ delete_cnt: 2 });
      const wrapped = patchFn(originalMethod);
      await wrapped.call({}, {
        collection_name: 'col',
        ids: [1, 2],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'DELETE'
      );
    });

    it('should set db.filter when expr provided', async () => {
      const patchFn = MilvusWrapper._patchDelete(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue({});
      const wrapped = patchFn(originalMethod);
      await wrapped.call({}, {
        collection_name: 'col',
        expr: 'id in [1, 2, 3]',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_FILTER,
        'id in [1, 2, 3]'
      );
    });

    it('should set db.ids_count when ids provided', async () => {
      const patchFn = MilvusWrapper._patchDelete(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue({});
      const wrapped = patchFn(originalMethod);
      await wrapped.call({}, { collection_name: 'col', ids: [10, 20, 30] });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_ID_COUNT, 3);
    });
  });

  // ── query → QUERY ─────────────────────────────────────────────────────────

  describe('query() → QUERY (scalar filter query)', () => {
    it('should set db.operation.name = "QUERY"', async () => {
      const patchFn = MilvusWrapper._patchQuery(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue({ data: [{ id: 1 }, { id: 2 }] });
      const wrapped = patchFn(originalMethod);
      await wrapped.call({}, {
        collection_name: 'col',
        expr: 'category == "books"',
        limit: 50,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'QUERY'
      );
    });

    it('should set db.n_results from data length', async () => {
      const patchFn = MilvusWrapper._patchQuery(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue({ data: [{ id: 1 }, { id: 2 }, { id: 3 }] });
      const wrapped = patchFn(originalMethod);
      await wrapped.call({}, { collection_name: 'col', expr: 'id > 0' });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_N_RESULTS, 3);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('should call handleException and end span on error', async () => {
    const patchFn = MilvusWrapper._patchSearch(mockTracer);
    const error = new Error('Milvus not available');
    const originalMethod = jest.fn().mockRejectedValue(error);
    const wrapped = patchFn(originalMethod);

    await expect(wrapped.call({}, { collection_name: 'col', vectors: [[0.1]], topk: 5 })).rejects.toThrow();
    expect(OpenLitHelper.handleException).toHaveBeenCalledWith(mockSpan, error);
    expect(mockSpan.end).toHaveBeenCalled();
  });
});
