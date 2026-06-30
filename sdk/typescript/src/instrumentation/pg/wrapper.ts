import { SpanKind, SpanStatusCode, Span, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

/**
 * PostgreSQL (`pg`) instrumentation wrapper.
 *
 * Mirrors the Python SDK psycopg instrumentation
 * (sdk/python/src/openlit/instrumentation/psycopg) for the Node `pg` driver:
 *   - parses the SQL operation (SELECT/INSERT/...) and target table for span naming,
 *   - detects pgvector similarity operators (`<=>`, `<->`, `<#>`),
 *   - honors a `captureDbParameters` toggle to record query parameters
 *     (off by default — parameters can contain PII/secrets),
 *   - sets the same `db.*` semantic-convention attributes the Python SDK sets.
 *
 * The `pg` `query()` method has three call shapes which must all be handled:
 *   1. callback:  client.query(text, values?, (err, res) => {})       → no return value
 *   2. promise:   const res = await client.query(text, values?)        → returns a thenable
 *   3. submittable: client.query(new Query(...)) / cursors             → returns the submittable
 */

// Maximum number of query parameters to capture (matches Python MAX_PARAMS_COUNT).
const MAX_PARAMS_COUNT = 50;
// Maximum captured parameter value length (matches Python MAX_PARAM_LENGTH).
const MAX_PARAM_LENGTH = 256;

// Map of leading SQL keyword → db.operation.name value (mirrors Python SQL_OPERATION_MAP).
const SQL_OPERATION_MAP: Record<string, string> = {
  SELECT: SemanticConvention.DB_OPERATION_SELECT,
  INSERT: SemanticConvention.DB_OPERATION_INSERT,
  UPDATE: SemanticConvention.DB_OPERATION_UPDATE,
  DELETE: SemanticConvention.DB_OPERATION_DELETE,
  COPY: SemanticConvention.DB_OPERATION_COPY,
  CREATE: SemanticConvention.DB_OPERATION_CREATE,
  ALTER: SemanticConvention.DB_OPERATION_ALTER,
  DROP: SemanticConvention.DB_OPERATION_DROP,
  TRUNCATE: SemanticConvention.DB_OPERATION_TRUNCATE,
  COMMIT: SemanticConvention.DB_OPERATION_COMMIT,
  ROLLBACK: SemanticConvention.DB_OPERATION_ROLLBACK,
};

// Table-name extraction patterns (mirrors Python TABLE_PATTERNS).
const TABLE_PATTERNS: RegExp[] = [
  /INSERT\s+INTO\s+["']?(\w+)["']?/i,
  /UPDATE\s+["']?(\w+)["']?/i,
  /DELETE\s+FROM\s+["']?(\w+)["']?/i,
  /FROM\s+["']?(\w+)["']?/i,
  /TRUNCATE\s+(?:TABLE\s+)?["']?(\w+)["']?/i,
  /CREATE\s+(?:TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/i,
  /ALTER\s+TABLE\s+["']?(\w+)["']?/i,
  /DROP\s+(?:TABLE|INDEX)\s+(?:IF\s+EXISTS\s+)?["']?(\w+)["']?/i,
  /COPY\s+["']?(\w+)["']?/i,
];

export interface PgWrapperConfig {
  captureDbParameters?: boolean;
  sdkVersion?: string;
}

class PgWrapper extends BaseWrapper {
  static dbSystem = SemanticConvention.DB_SYSTEM_POSTGRESQL;

  /** Detect the SQL operation verb from a query string (mirrors Python parse_sql_operation). */
  static parseSqlOperation(query: unknown): string {
    if (query === null || query === undefined) {
      return SemanticConvention.DB_OPERATION_QUERY;
    }
    const queryStr = String(query).trim();
    if (!queryStr) {
      return SemanticConvention.DB_OPERATION_QUERY;
    }
    const queryUpper = queryStr.toUpperCase();
    for (const [keyword, operation] of Object.entries(SQL_OPERATION_MAP)) {
      if (queryUpper.startsWith(keyword)) {
        return operation;
      }
    }
    // Handle WITH ... SELECT/INSERT/UPDATE/DELETE (CTEs).
    if (queryUpper.startsWith('WITH')) {
      for (const [keyword, operation] of Object.entries(SQL_OPERATION_MAP)) {
        if (queryUpper.includes(keyword)) {
          return operation;
        }
      }
    }
    return SemanticConvention.DB_OPERATION_QUERY;
  }

  /** Extract the target table name for span naming (mirrors Python extract_table_name). */
  static extractTableName(query: unknown): string {
    if (query === null || query === undefined) {
      return 'unknown';
    }
    const queryStr = String(query);
    for (const pattern of TABLE_PATTERNS) {
      const match = pattern.exec(queryStr);
      if (match) {
        return match[1];
      }
    }
    return 'unknown';
  }

  /** Detect pgvector similarity operator → metric name (mirrors Python detect_special_features). */
  static detectSimilarityMetric(query: unknown): string | undefined {
    if (query === null || query === undefined) {
      return undefined;
    }
    const queryStr = String(query);
    if (queryStr.includes('<=>')) return 'cosine';
    if (queryStr.includes('<->')) return 'l2';
    if (queryStr.includes('<#>')) return 'inner_product';
    return undefined;
  }

  /** Build the human-readable query summary (mirrors Python get_query_summary). */
  static getQuerySummary(dbOperation: string, tableName: string, query: unknown): string {
    let summary = `${dbOperation} ${tableName}`;
    const metric = PgWrapper.detectSimilarityMetric(query);
    if (metric) {
      summary += ` (vector ${metric})`;
    }
    return summary;
  }

  /** Sanitize a parameter value for safe inclusion in a span (mirrors Python sanitize_parameter). */
  static sanitizeParameter(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
      return `<bytes:${(value as Uint8Array).length}>`;
    }
    let strValue: string;
    try {
      strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    } catch {
      return '<unrepresentable>';
    }
    if (strValue.length > MAX_PARAM_LENGTH) {
      return `${strValue.slice(0, MAX_PARAM_LENGTH)}...<truncated:${strValue.length}>`;
    }
    return strValue;
  }

  /**
   * Extract { host, port, database } from a `pg` Client / Pool instance.
   * `pg` stores connection params on the instance (and Pool on `options`).
   * Defaults mirror the Python psycopg instrumentation (localhost:5432).
   */
  static extractConnectionInfo(instance: any): { host: string; port: number; database?: string } {
    const defaults = { host: 'localhost', port: 5432 };
    try {
      const params = instance?.connectionParameters || instance?.options || instance || {};
      const host = params.host || defaults.host;
      const port = params.port ? Number(params.port) : defaults.port;
      const database = params.database;
      return { host, port: Number.isFinite(port) ? port : defaults.port, database };
    } catch {
      return defaults;
    }
  }

  /**
   * Resolve the SQL text and the parameter values from the `pg` query() arguments.
   * Supports: (text, values?, cb?), ({ text, values, name }, cb?), and submittables.
   */
  static resolveQuery(args: any[]): { queryText: unknown; values: unknown } {
    const first = args[0];
    if (typeof first === 'string') {
      return { queryText: first, values: Array.isArray(args[1]) ? args[1] : undefined };
    }
    if (first && typeof first === 'object') {
      // Query config object or a Submittable (Query/Cursor) — both may carry `text`/`values`.
      const queryText = 'text' in first ? first.text : undefined;
      const values = 'values' in first ? first.values : undefined;
      return { queryText, values };
    }
    return { queryText: undefined, values: undefined };
  }

  /** Pull the last argument if it is a node-style callback. */
  static extractCallback(args: any[]): ((...cbArgs: any[]) => void) | undefined {
    const last = args[args.length - 1];
    return typeof last === 'function' ? last : undefined;
  }

  /** Stamp all span attributes (mirrors Python common_psycopg_logic). */
  static setSpanAttributes(
    span: Span,
    {
      dbOperation,
      tableName,
      queryText,
      values,
      connInfo,
      durationSeconds,
      rowCount,
      captureDbParameters,
      sdkVersion,
    }: {
      dbOperation: string;
      tableName: string;
      queryText: unknown;
      values: unknown;
      connInfo: { host: string; port: number; database?: string };
      durationSeconds: number;
      rowCount?: number | null;
      captureDbParameters: boolean;
      sdkVersion?: string;
    }
  ): void {
    const applicationName = OpenlitConfig.applicationName || '';
    const environment = OpenlitConfig.environment || '';

    span.setAttribute(SemanticConvention.DB_SYSTEM_NAME, PgWrapper.dbSystem);
    span.setAttribute(SemanticConvention.DB_OPERATION_NAME, dbOperation);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, connInfo.host);
    span.setAttribute(SemanticConvention.SERVER_PORT, connInfo.port);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
    span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, durationSeconds);
    if (sdkVersion) {
      span.setAttribute(SemanticConvention.DB_SDK_VERSION, sdkVersion);
    }

    if (connInfo.database && connInfo.database !== 'unknown') {
      span.setAttribute(SemanticConvention.DB_NAMESPACE_POSTGRESQL, connInfo.database);
    }
    if (tableName && tableName !== 'unknown') {
      span.setAttribute(SemanticConvention.DB_COLLECTION_NAME, tableName);
    }

    // Capture query text when message-content capture is enabled (parity w/ Python).
    if (OpenlitConfig.captureMessageContent && queryText) {
      let queryStr = String(queryText);
      const maxLen = OpenlitConfig.maxContentLength;
      if (typeof maxLen === 'number' && maxLen > 0 && queryStr.length > maxLen) {
        queryStr = queryStr.slice(0, maxLen);
      }
      span.setAttribute(SemanticConvention.DB_QUERY_TEXT, queryStr);
    }

    // Capture query parameters (OTel per-index convention) only when explicitly enabled.
    if (captureDbParameters && values !== null && values !== undefined) {
      if (Array.isArray(values)) {
        values.slice(0, MAX_PARAMS_COUNT).forEach((value, idx) => {
          span.setAttribute(
            `${SemanticConvention.DB_QUERY_PARAMETER}.${idx}`,
            PgWrapper.sanitizeParameter(value)
          );
        });
      } else if (typeof values === 'object') {
        Object.entries(values as Record<string, unknown>)
          .slice(0, MAX_PARAMS_COUNT)
          .forEach(([key, value]) => {
            span.setAttribute(
              `${SemanticConvention.DB_QUERY_PARAMETER}.${key}`,
              PgWrapper.sanitizeParameter(value)
            );
          });
      }
    }

    span.setAttribute(
      SemanticConvention.DB_QUERY_SUMMARY,
      PgWrapper.getQuerySummary(dbOperation, tableName, queryText)
    );

    if (typeof rowCount === 'number' && rowCount >= 0) {
      span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, rowCount);
    }

    // pgvector similarity metric.
    const metric = PgWrapper.detectSimilarityMetric(queryText);
    if (metric) {
      span.setAttribute(SemanticConvention.DB_SEARCH_SIMILARITY_METRIC, metric);
    }

    span.setStatus({ code: SpanStatusCode.OK });
  }

  /**
   * Build the patched `query()` replacement. Handles callback, promise, and
   * submittable forms while always producing a single CLIENT span.
   */
  static _patchQuery(tracer: Tracer, config: PgWrapperConfig = {}): any {
    const captureDbParameters = Boolean(config.captureDbParameters);
    const sdkVersion = config.sdkVersion;

    return (originalQuery: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        if (context.active() === undefined) {
          // Defensive — should not happen, but never break the driver.
          return originalQuery.apply(this, args);
        }

        const { queryText, values } = PgWrapper.resolveQuery(args);
        const dbOperation = PgWrapper.parseSqlOperation(queryText);
        const tableName = PgWrapper.extractTableName(queryText);
        const connInfo = PgWrapper.extractConnectionInfo(this);
        const spanName = `${dbOperation} ${tableName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        const finalize = (result: any) => {
          try {
            const durationSeconds = (Date.now() - startTime) / 1000;
            const rowCount =
              result && typeof result.rowCount === 'number' ? result.rowCount : undefined;
            PgWrapper.setSpanAttributes(span, {
              dbOperation,
              tableName,
              queryText,
              values,
              connInfo,
              durationSeconds,
              rowCount,
              captureDbParameters,
              sdkVersion,
            });
          } catch (attrErr: any) {
            OpenLitHelper.handleException(span, attrErr);
          } finally {
            span.end();
          }
        };

        const fail = (error: any) => {
          OpenLitHelper.handleException(span, error);
          span.end();
        };

        return context.with(trace.setSpan(context.active(), span), () => {
          const callback = PgWrapper.extractCallback(args);

          // ── Callback form ────────────────────────────────────────────────
          if (callback) {
            const wrappedCallback = function (this: any, err: any, res: any) {
              if (err) {
                fail(err);
              } else {
                finalize(res);
              }
              return callback.apply(this, [err, res]);
            };
            const newArgs = args.slice(0, -1).concat(wrappedCallback);
            try {
              return originalQuery.apply(this, newArgs);
            } catch (syncErr: any) {
              fail(syncErr);
              throw syncErr;
            }
          }

          // ── Promise / submittable form ───────────────────────────────────
          let result: any;
          try {
            result = originalQuery.apply(this, args);
          } catch (syncErr: any) {
            fail(syncErr);
            throw syncErr;
          }

          if (result && typeof result.then === 'function') {
            return result.then(
              (res: any) => {
                finalize(res);
                return res;
              },
              (err: any) => {
                fail(err);
                throw err;
              }
            );
          }

          // Submittable (Query/Cursor) — no promise, no callback. Listen for completion.
          if (result && typeof result.on === 'function') {
            let settled = false;
            result.on('end', () => {
              if (settled) return;
              settled = true;
              finalize(result);
            });
            result.on('error', (err: any) => {
              if (settled) return;
              settled = true;
              fail(err);
            });
            return result;
          }

          // Unknown shape — close the span without a row count.
          finalize(result);
          return result;
        });
      };
    };
  }
}

export default PgWrapper;
