/**
 * Cross-Language Trace Comparison Tests for PostgreSQL (`pg`) Integration
 *
 * Verifies that the TypeScript SDK generates traces consistent with the Python SDK
 * psycopg instrumentation for PostgreSQL queries.
 *
 * Python SDK reference: sdk/python/src/openlit/instrumentation/psycopg/utils.py
 *
 * Key alignment:
 *   - db.system.name = 'postgresql'
 *   - db.operation.name parsed from the SQL verb (SELECT/INSERT/UPDATE/DELETE/...)
 *   - db.collection.name = target table
 *   - db.namespace = database name
 *   - server.address, server.port (default localhost:5432)
 *   - db.query.text (when captureMessageContent is enabled)
 *   - db.query.parameter.<index> (only when captureDbParameters is enabled)
 *   - db.search.similarity_metric for pgvector operators (<=>, <->, <#>)
 *   - db.query.summary
 *   - db.response.returned_rows from result.rowCount
 */

import PgWrapper from '../pg/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');

describe('PostgreSQL (pg) Cross-Language Trace Comparison', () => {
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
    (OpenlitConfig as any).maxContentLength = null;
    (OpenLitHelper as any).handleException = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Fake `pg` Client instance carrying connection parameters.
  const fakeClient = () => ({
    connectionParameters: { host: 'db.example.com', port: 5433, database: 'app_db' },
  });

  // Invoke the patched query() in promise form and await completion.
  async function invokePromise(
    args: any[],
    result: any = { rowCount: 0 },
    config: { captureDbParameters?: boolean } = {}
  ) {
    const patchFn = PgWrapper._patchQuery(mockTracer, config);
    const original = jest.fn().mockResolvedValue(result);
    const wrapped = patchFn(original);
    await wrapped.apply(fakeClient(), args);
    return original;
  }

  // ── Pure-function parity checks (mirror Python utils) ───────────────────────

  describe('SQL operation parsing (parseSqlOperation)', () => {
    it('detects SELECT', () => {
      expect(PgWrapper.parseSqlOperation('SELECT * FROM users')).toBe(
        SemanticConvention.DB_OPERATION_SELECT
      );
    });
    it('detects INSERT', () => {
      expect(PgWrapper.parseSqlOperation('INSERT INTO users (id) VALUES (1)')).toBe(
        SemanticConvention.DB_OPERATION_INSERT
      );
    });
    it('falls back to QUERY for unknown statements', () => {
      expect(PgWrapper.parseSqlOperation('EXPLAIN ANALYZE foo')).toBe(
        SemanticConvention.DB_OPERATION_QUERY
      );
    });
    it('resolves CTE (WITH ... SELECT) to the inner operation', () => {
      expect(PgWrapper.parseSqlOperation('WITH t AS (...) SELECT * FROM t')).toBe(
        SemanticConvention.DB_OPERATION_SELECT
      );
    });
  });

  describe('table extraction (extractTableName)', () => {
    it('extracts table from SELECT ... FROM', () => {
      expect(PgWrapper.extractTableName('SELECT * FROM items WHERE id = $1')).toBe('items');
    });
    it('extracts table from INSERT INTO', () => {
      expect(PgWrapper.extractTableName('INSERT INTO documents (x) VALUES ($1)')).toBe('documents');
    });
    it('returns unknown when no table matches', () => {
      expect(PgWrapper.extractTableName('COMMIT')).toBe('unknown');
    });
  });

  describe('pgvector similarity detection (detectSimilarityMetric)', () => {
    it('maps <=> to cosine', () => {
      expect(PgWrapper.detectSimilarityMetric('... ORDER BY embedding <=> $1')).toBe('cosine');
    });
    it('maps <-> to l2', () => {
      expect(PgWrapper.detectSimilarityMetric('... ORDER BY embedding <-> $1')).toBe('l2');
    });
    it('maps <#> to inner_product', () => {
      expect(PgWrapper.detectSimilarityMetric('... ORDER BY embedding <#> $1')).toBe(
        'inner_product'
      );
    });
    it('returns undefined when no operator present', () => {
      expect(PgWrapper.detectSimilarityMetric('SELECT 1')).toBeUndefined();
    });
  });

  // ── Common DB span attributes ───────────────────────────────────────────────

  it('sets db.system.name = "postgresql"', async () => {
    await invokePromise(['SELECT * FROM users']);
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.DB_SYSTEM_NAME,
      'postgresql'
    );
  });

  it('sets server.address and server.port from the client connection params', async () => {
    await invokePromise(['SELECT 1']);
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.SERVER_ADDRESS,
      'db.example.com'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 5433);
  });

  it('defaults to localhost:5432 when connection params are missing (Python defaults)', async () => {
    const patchFn = PgWrapper._patchQuery(mockTracer, {});
    const original = jest.fn().mockResolvedValue({ rowCount: 0 });
    const wrapped = patchFn(original);
    await wrapped.apply({}, ['SELECT 1']);
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'localhost');
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 5432);
  });

  it('sets db.namespace from the database name', async () => {
    await invokePromise(['SELECT 1']);
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.DB_NAMESPACE_POSTGRESQL,
      'app_db'
    );
  });

  // ── Basic query span ─────────────────────────────────────────────────────────

  describe('basic query span', () => {
    it('sets db.operation.name and db.collection.name', async () => {
      await invokePromise(['SELECT id, name FROM users WHERE id = $1', [42]]);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_OPERATION_NAME,
        'SELECT'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_COLLECTION_NAME,
        'users'
      );
    });

    it('names the span "<operation> <table>"', async () => {
      await invokePromise(['SELECT * FROM users']);
      expect(mockTracer.startSpan).toHaveBeenCalledWith('SELECT users', expect.anything());
    });

    it('captures query text when captureMessageContent is enabled', async () => {
      await invokePromise(['SELECT * FROM users']);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_QUERY_TEXT,
        'SELECT * FROM users'
      );
    });

    it('sets db.response.returned_rows from result.rowCount', async () => {
      await invokePromise(['SELECT * FROM users'], { rowCount: 7 });
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_RESPONSE_RETURNED_ROWS,
        7
      );
    });

    it('sets db.query.summary', async () => {
      await invokePromise(['SELECT * FROM users']);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_QUERY_SUMMARY,
        'SELECT users'
      );
    });

    it('ends the span and marks status OK', async () => {
      await invokePromise(['SELECT 1']);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
      expect(mockSpan.end).toHaveBeenCalled();
    });
  });

  // ── pgvector query ───────────────────────────────────────────────────────────

  describe('pgvector similarity query', () => {
    it('sets db.search.similarity_metric = cosine for the <=> operator', async () => {
      await invokePromise([
        'SELECT id FROM embeddings ORDER BY vec <=> $1 LIMIT 5',
        ['[0.1,0.2]'],
      ]);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_SEARCH_SIMILARITY_METRIC,
        'cosine'
      );
    });

    it('includes the vector metric in the query summary', async () => {
      await invokePromise(['SELECT id FROM embeddings ORDER BY vec <-> $1']);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_QUERY_SUMMARY,
        'SELECT embeddings (vector l2)'
      );
    });
  });

  // ── captureDbParameters toggle ────────────────────────────────────────────────

  describe('captureDbParameters toggle', () => {
    it('does NOT capture query parameters when disabled (default)', async () => {
      await invokePromise(['SELECT * FROM users WHERE id = $1', [42]], { rowCount: 1 }, {
        captureDbParameters: false,
      });
      const paramCalls = mockSpan.setAttribute.mock.calls.filter((c: any[]) =>
        String(c[0]).startsWith(SemanticConvention.DB_QUERY_PARAMETER)
      );
      expect(paramCalls).toHaveLength(0);
    });

    it('captures query parameters per-index when enabled', async () => {
      await invokePromise(
        ['SELECT * FROM users WHERE id = $1 AND status = $2', [42, 'active']],
        { rowCount: 1 },
        { captureDbParameters: true }
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        `${SemanticConvention.DB_QUERY_PARAMETER}.0`,
        '42'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        `${SemanticConvention.DB_QUERY_PARAMETER}.1`,
        'active'
      );
    });

    it('sanitizes Buffer parameters to <bytes:N> when enabled', async () => {
      await invokePromise(
        ['INSERT INTO files (data) VALUES ($1)', [Buffer.from('abc')]],
        { rowCount: 1 },
        { captureDbParameters: true }
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        `${SemanticConvention.DB_QUERY_PARAMETER}.0`,
        '<bytes:3>'
      );
    });
  });

  // ── Query-config object form ──────────────────────────────────────────────────

  it('supports the { text, values } query-config object form', async () => {
    await invokePromise(
      [{ text: 'UPDATE accounts SET balance = $1 WHERE id = $2', values: [100, 5] }],
      { rowCount: 1 },
      { captureDbParameters: true }
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.DB_OPERATION_NAME,
      'UPDATE'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      SemanticConvention.DB_COLLECTION_NAME,
      'accounts'
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      `${SemanticConvention.DB_QUERY_PARAMETER}.0`,
      '100'
    );
  });

  // ── Callback form ─────────────────────────────────────────────────────────────

  describe('callback form', () => {
    it('finalizes the span and invokes the user callback on success', (done) => {
      const patchFn = PgWrapper._patchQuery(mockTracer, {});
      const original = jest.fn((_text: string, _vals: any, cb: any) =>
        cb(null, { rowCount: 3 })
      );
      const wrapped = patchFn(original);
      wrapped.apply(fakeClient(), [
        'SELECT * FROM logs',
        [],
        (err: any, res: any) => {
          expect(err).toBeNull();
          expect(res.rowCount).toBe(3);
          expect(mockSpan.setAttribute).toHaveBeenCalledWith(
            SemanticConvention.DB_RESPONSE_RETURNED_ROWS,
            3
          );
          expect(mockSpan.end).toHaveBeenCalled();
          done();
        },
      ]);
    });

    it('records an exception and still invokes the callback on error', (done) => {
      const error = new Error('connection refused');
      const patchFn = PgWrapper._patchQuery(mockTracer, {});
      const original = jest.fn((_text: string, cb: any) => cb(error, undefined));
      const wrapped = patchFn(original);
      wrapped.apply(fakeClient(), [
        'SELECT 1',
        (err: any) => {
          expect(err).toBe(error);
          expect(OpenLitHelper.handleException).toHaveBeenCalledWith(mockSpan, error);
          expect(mockSpan.end).toHaveBeenCalled();
          done();
        },
      ]);
    });
  });

  // ── Error handling (promise form) ───────────────────────────────────────────────

  it('records an exception when the promise rejects', async () => {
    const error = new Error('syntax error');
    const patchFn = PgWrapper._patchQuery(mockTracer, {});
    const original = jest.fn().mockRejectedValue(error);
    const wrapped = patchFn(original);
    await expect(wrapped.apply(fakeClient(), ['SELET 1'])).rejects.toThrow('syntax error');
    expect(OpenLitHelper.handleException).toHaveBeenCalledWith(mockSpan, error);
    expect(mockSpan.end).toHaveBeenCalled();
  });

  // ── Submittable / Cursor form (result.on('end' | 'error')) ──────────────────────

  describe('submittable / cursor form', () => {
    // Minimal EventEmitter-like fake submittable (neither a promise nor a callback).
    const makeSubmittable = (extra: Record<string, unknown> = {}) => {
      const listeners: Record<string, Array<(...a: any[]) => void>> = {};
      return {
        ...extra,
        on(event: string, cb: (...a: any[]) => void) {
          (listeners[event] ||= []).push(cb);
          return this;
        },
        emit(event: string, ...args: any[]) {
          (listeners[event] || []).forEach((cb) => cb(...args));
        },
      };
    };

    it('finalizes the span when the submittable emits "end"', () => {
      const submittable = makeSubmittable({ rowCount: 4 });
      const patchFn = PgWrapper._patchQuery(mockTracer, {});
      const original = jest.fn().mockReturnValue(submittable);
      const wrapped = patchFn(original);

      const returned: any = wrapped.apply(fakeClient(), ['SELECT * FROM events']);
      expect(returned).toBe(submittable); // submittable passed through unchanged
      expect(mockSpan.end).not.toHaveBeenCalled(); // not finalized until completion

      returned.emit('end');

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_SYSTEM_NAME,
        'postgresql'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.DB_RESPONSE_RETURNED_ROWS,
        4
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // SpanStatusCode.OK
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('records an exception when the submittable emits "error"', () => {
      const submittable = makeSubmittable();
      const error = new Error('cursor failed');
      const patchFn = PgWrapper._patchQuery(mockTracer, {});
      const original = jest.fn().mockReturnValue(submittable);
      const wrapped = patchFn(original);

      const returned: any = wrapped.apply(fakeClient(), ['SELECT * FROM events']);
      returned.emit('error', error);

      expect(OpenLitHelper.handleException).toHaveBeenCalledWith(mockSpan, error);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('finalizes the span only once even if "end" fires after "error"', () => {
      const submittable = makeSubmittable();
      const error = new Error('boom');
      const patchFn = PgWrapper._patchQuery(mockTracer, {});
      const original = jest.fn().mockReturnValue(submittable);
      const wrapped = patchFn(original);

      const returned: any = wrapped.apply(fakeClient(), ['SELECT 1']);
      returned.emit('error', error);
      returned.emit('end');

      expect(OpenLitHelper.handleException).toHaveBeenCalledTimes(1);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });

  // ── Single-span guarantee ──────────────────────────────────────────────────────

  describe('exactly one span per logical query', () => {
    it('creates exactly one span for a promise-form query', async () => {
      await invokePromise(['SELECT * FROM users'], { rowCount: 1 });
      expect(mockTracer.startSpan).toHaveBeenCalledTimes(1);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('creates exactly one span for a pool.query() that delegates to client.query()', async () => {
      // Model `pg`: Pool.query() checks out a Client and calls client.query().
      // Only Client.query is patched, so a pool query must yield ONE span.
      const patchFn = PgWrapper._patchQuery(mockTracer, {});
      const realClientQuery = jest.fn().mockResolvedValue({ rowCount: 2 });
      const patchedClientQuery = patchFn(realClientQuery);

      const client = { ...fakeClient(), query: patchedClientQuery };
      // Unpatched Pool.query delegating to the patched client query.
      const poolQuery = (...args: any[]) => client.query(...args);

      await poolQuery('SELECT * FROM users WHERE id = $1', [1]);

      expect(mockTracer.startSpan).toHaveBeenCalledTimes(1);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });
});

// ── Instrumentation patching: only Client.query is wrapped, never Pool.query ──────

describe('OpenlitPgInstrumentation patch targets', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PgInstrumentation = require('../pg').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isWrapped } = require('@opentelemetry/instrumentation');

  it('wraps Client.prototype.query but leaves Pool.prototype.query untouched', () => {
    const clientQuery = function () {};
    const poolQuery = function () {};
    const fakePgModule = {
      Client: function () {},
      Pool: function () {},
    } as any;
    fakePgModule.Client.prototype.query = clientQuery;
    fakePgModule.Pool.prototype.query = poolQuery;

    const instr = new PgInstrumentation();
    instr.manualPatch(fakePgModule);

    expect(isWrapped(fakePgModule.Client.prototype.query)).toBe(true);
    expect(isWrapped(fakePgModule.Pool.prototype.query)).toBe(false);
    expect(fakePgModule.Pool.prototype.query).toBe(poolQuery); // unchanged
  });
});
