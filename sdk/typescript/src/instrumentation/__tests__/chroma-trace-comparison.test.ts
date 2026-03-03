/**
 * Cross-Language Trace Comparison Tests for ChromaDB Integration
 *
 * Verifies that TypeScript SDK generates traces consistent with the Python SDK
 * for ChromaDB Collection operations.
 *
 * Python SDK reference: sdk/python/src/openlit/instrumentation/chroma/utils.py
 *
 * Key alignment:
 *   - db.system.name = 'chroma'
 *   - db.operation.name: INSERT (add), QUERY (query), GET (get), DELETE, PEEK, UPDATE, UPSERT
 *   - db.collection.name
 *   - server.address, server.port (default localhost:8000)
 *   - db.vector.query.top_k for query
 *   - db.filter for where-clause filtering
 *   - db.query.summary
 */

import ChromaWrapper from '../chroma/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');

describe('ChromaDB Cross-Language Trace Comparison', () => {
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

  // ── Helper: invoke wrapper ────────────────────────────────────────────────

  async function invokeWrapped(
    method: string,
    dbOperation: string,
    collectionName: string,
    params: any,
    returnValue: any = {}
  ) {
    const patchFn = ChromaWrapper._patchCollectionMethod(mockTracer, dbOperation);
    const originalMethod = jest.fn().mockResolvedValue(returnValue);
    const fakeCollectionInstance = { name: collectionName };
    const wrapped = patchFn(originalMethod);
    await wrapped.call(fakeCollectionInstance, params);
  }

  // ── Common DB attributes ──────────────────────────────────────────────────

  it('should set db.system.name = "chroma" matching Python DB_SYSTEM_CHROMA', async () => {
    await invokeWrapped('add', SemanticConvention.DB_OPERATION_INSERT, 'test_col', {
      ids: ['id1'],
      embeddings: [[0.1, 0.2]],
    });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.DB_SYSTEM_NAME,
      'chroma'
    );
  });

  it('should set server.address = localhost and server.port = 8000 (Python defaults)', async () => {
    await invokeWrapped('add', SemanticConvention.DB_OPERATION_INSERT, 'test_col', {
      ids: ['id1'],
    });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'localhost');
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 8000);
  });

  it('should set db.collection.name from collection instance', async () => {
    await invokeWrapped('add', SemanticConvention.DB_OPERATION_INSERT, 'my_collection', {
      ids: ['id1'],
    });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.DB_COLLECTION_NAME,
      'my_collection'
    );
  });

  // ── add → INSERT ──────────────────────────────────────────────────────────

  describe('add() → INSERT (matches Python DB_OPERATION_INSERT)', () => {
    it('should set db.operation.name = "INSERT"', async () => {
      await invokeWrapped('add', SemanticConvention.DB_OPERATION_INSERT, 'col', {
        ids: ['id1', 'id2'],
        embeddings: [[0.1], [0.2]],
        documents: ['doc1', 'doc2'],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'INSERT'
      );
    });

    it('should set db.vector.count = number of ids', async () => {
      await invokeWrapped('add', SemanticConvention.DB_OPERATION_INSERT, 'col', {
        ids: ['id1', 'id2', 'id3'],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_VECTOR_COUNT, 3);
    });

    it('should set db.documents_count when documents provided', async () => {
      await invokeWrapped('add', SemanticConvention.DB_OPERATION_INSERT, 'col', {
        ids: ['id1'],
        documents: ['doc1'],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_DOCUMENTS_COUNT, 1);
    });
  });

  // ── query → QUERY ─────────────────────────────────────────────────────────

  describe('query() → QUERY (vector similarity search)', () => {
    it('should set db.operation.name = "QUERY"', async () => {
      await invokeWrapped('query', SemanticConvention.DB_OPERATION_QUERY, 'col', {
        queryEmbeddings: [[0.1, 0.2]],
        nResults: 5,
      }, { ids: [['id1', 'id2']] });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'QUERY'
      );
    });

    it('should set db.vector.query.top_k from nResults', async () => {
      await invokeWrapped('query', SemanticConvention.DB_OPERATION_QUERY, 'col', {
        queryEmbeddings: [[0.1]],
        nResults: 10,
      }, { ids: [['id1']] });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_VECTOR_QUERY_TOP_K, 10);
    });

    it('should set db.filter when where clause provided (matching Python DB_FILTER)', async () => {
      const where = { source: 'test' };
      await invokeWrapped('query', SemanticConvention.DB_OPERATION_QUERY, 'col', {
        queryEmbeddings: [[0.1]],
        nResults: 5,
        where,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_FILTER,
        JSON.stringify(where)
      );
    });

    it('should set db.n_results to number of matched results', async () => {
      await invokeWrapped('query', SemanticConvention.DB_OPERATION_QUERY, 'col', {
        queryEmbeddings: [[0.1]],
        nResults: 5,
      }, { ids: [['r1', 'r2', 'r3']] });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_N_RESULTS, 3);
    });
  });

  // ── get → GET ────────────────────────────────────────────────────────────

  describe('get() → GET (retrieve by IDs)', () => {
    it('should set db.operation.name = "GET"', async () => {
      await invokeWrapped('get', SemanticConvention.DB_OPERATION_GET, 'col', {
        ids: ['id1', 'id2'],
      }, { ids: ['id1', 'id2'] });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'GET'
      );
    });

    it('should set db.ids_count from ids array length', async () => {
      await invokeWrapped('get', SemanticConvention.DB_OPERATION_GET, 'col', {
        ids: ['id1', 'id2'],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_ID_COUNT, 2);
    });
  });

  // ── delete → DELETE ───────────────────────────────────────────────────────

  describe('delete() → DELETE', () => {
    it('should set db.operation.name = "DELETE"', async () => {
      await invokeWrapped('delete', SemanticConvention.DB_OPERATION_DELETE, 'col', {
        ids: ['id1'],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'DELETE'
      );
    });

    it('should set db.filter when where clause provided', async () => {
      const where = { category: 'old' };
      await invokeWrapped('delete', SemanticConvention.DB_OPERATION_DELETE, 'col', {
        where,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_FILTER,
        JSON.stringify(where)
      );
    });
  });

  // ── peek → PEEK ───────────────────────────────────────────────────────────

  describe('peek() → PEEK', () => {
    it('should set db.operation.name = "PEEK"', async () => {
      await invokeWrapped('peek', SemanticConvention.DB_OPERATION_PEEK, 'col', 5, {
        ids: ['id1', 'id2', 'id3', 'id4', 'id5'],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'PEEK'
      );
    });
  });

  // ── upsert → UPSERT ───────────────────────────────────────────────────────

  describe('upsert() → UPSERT', () => {
    it('should set db.operation.name = "UPSERT" and db.vector.count', async () => {
      await invokeWrapped('upsert', SemanticConvention.DB_OPERATION_UPSERT, 'col', {
        ids: ['id1', 'id2'],
        embeddings: [[0.1], [0.2]],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'UPSERT'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.DB_VECTOR_COUNT, 2);
    });
  });

  // ── update → UPDATE ───────────────────────────────────────────────────────

  describe('update() → UPDATE', () => {
    it('should set db.operation.name = "UPDATE"', async () => {
      await invokeWrapped('update', SemanticConvention.DB_OPERATION_UPDATE, 'col', {
        ids: ['id1'],
        documents: ['new content'],
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'UPDATE'
      );
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('should call handleException on error', async () => {
    const patchFn = ChromaWrapper._patchCollectionMethod(mockTracer, SemanticConvention.DB_OPERATION_QUERY);
    const error = new Error('Collection not found');
    const originalMethod = jest.fn().mockRejectedValue(error);
    const fakeInstance = { name: 'missing_col' };
    const wrapped = patchFn(originalMethod);

    await expect(wrapped.call(fakeInstance, {})).rejects.toThrow('Collection not found');
    expect(OpenLitHelper.handleException).toHaveBeenCalledWith(mockSpan, error);
    expect(mockSpan.end).toHaveBeenCalled();
  });
});
