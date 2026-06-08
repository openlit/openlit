import { SpanKind, SpanStatusCode, Tracer, context, trace } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import { SDK_NAME } from '../../constant';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

type ServerAddressAndPort = {
  serverAddress: string;
  serverPort: number;
};

type AstraOperationContext = {
  dbOperation: string;
  collectionName: string;
  args: any[];
  response?: any;
};

const DEFAULT_SERVER: ServerAddressAndPort = {
  serverAddress: 'astra.datastax.com',
  serverPort: 443,
};

let astraDbSdkVersion = 'unknown';

try {
  // Optional runtime dependency: keep this guarded so OpenLIT can load without Astra installed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  astraDbSdkVersion = require('@datastax/astra-db-ts/package.json')?.version || 'unknown';
} catch {
  astraDbSdkVersion = 'unknown';
}

class AstraWrapper extends BaseWrapper {
  static dbSystem = SemanticConvention.DB_SYSTEM_ASTRA;
  static serverAddress = DEFAULT_SERVER.serverAddress;
  static serverPort = DEFAULT_SERVER.serverPort;

  static _setCommonAttributes(span: any, dbOperation: string, collectionName: string, instance?: any) {
    const applicationName = OpenlitConfig.applicationName || '';
    const environment = OpenlitConfig.environment || '';
    const { serverAddress, serverPort } = AstraWrapper._getServerAddressAndPort(instance);

    span.setAttribute(SemanticConvention.DB_SYSTEM_NAME, AstraWrapper.dbSystem);
    span.setAttribute(SemanticConvention.DB_OPERATION_NAME, dbOperation);
    span.setAttribute(SemanticConvention.DB_COLLECTION_NAME, collectionName);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, serverAddress);
    span.setAttribute(SemanticConvention.SERVER_PORT, serverPort);
    span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB);
    span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, environment);
    span.setAttribute(ATTR_SERVICE_NAME, applicationName);
    span.setAttribute(SemanticConvention.DB_SDK_VERSION, astraDbSdkVersion);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
  }

  /**
   * Async wrapper for methods that return Promises (all Collection CRUD methods except `find`).
   */
  static _patchCollectionMethod(tracer: Tracer, dbOperation: string): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const collectionName: string = this?.name || 'unknown';
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;
            const actualDbOperation = AstraWrapper._getActualDbOperation(dbOperation, args);

            AstraWrapper._setCommonAttributes(span, actualDbOperation, collectionName, this);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);
            AstraWrapper._setOperationAttributes(span, {
              dbOperation: actualDbOperation,
              collectionName,
              args,
              response,
            });

            span.setStatus({ code: SpanStatusCode.OK });
            return response;
          } catch (e: any) {
            OpenLitHelper.handleException(span, e);
            throw e;
          } finally {
            span.end();
          }
        });
      };
    };
  }

  /**
   * Synchronous wrapper for `find()` which returns a cursor synchronously.
   * Wrapping it as async would break the cursor API (e.g. `collection.find({}).toArray()`).
   */
  static _patchSyncFindMethod(tracer: Tracer): any {
    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        const collectionName: string = this?.name || 'unknown';
        const spanName = `${SemanticConvention.DB_OPERATION_SELECT} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        try {
          const cursor = originalMethod.apply(this, args);
          const duration = (Date.now() - startTime) / 1000;

          AstraWrapper._setCommonAttributes(span, SemanticConvention.DB_OPERATION_SELECT, collectionName, this);
          span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);
          AstraWrapper._setOperationAttributes(span, {
            dbOperation: SemanticConvention.DB_OPERATION_SELECT,
            collectionName,
            args,
            response: cursor,
          });

          span.setStatus({ code: SpanStatusCode.OK });
          return cursor;
        } catch (e: any) {
          OpenLitHelper.handleException(span, e);
          throw e;
        } finally {
          span.end();
        }
      };
    };
  }

  private static _setOperationAttributes(span: any, context: AstraOperationContext) {
    switch (context.dbOperation) {
      case SemanticConvention.DB_OPERATION_INSERT:
        AstraWrapper._setInsertAttributes(span, context);
        break;
      case SemanticConvention.DB_OPERATION_UPDATE:
        AstraWrapper._setUpdateAttributes(span, context);
        break;
      case SemanticConvention.DB_OPERATION_REPLACE:
      case SemanticConvention.DB_OPERATION_UPSERT:
        AstraWrapper._setReplaceAttributes(span, context);
        break;
      case SemanticConvention.DB_OPERATION_SELECT:
        AstraWrapper._setSelectAttributes(span, context);
        break;
      case SemanticConvention.DB_OPERATION_DELETE:
      case SemanticConvention.DB_OPERATION_FIND_AND_DELETE:
        AstraWrapper._setDeleteAttributes(span, context);
        break;
      default:
        span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY, `${context.dbOperation} ${context.collectionName}`);
    }
  }

  private static _setInsertAttributes(span: any, { dbOperation, collectionName, args, response }: AstraOperationContext) {
    const documents = args[0];
    const documentsCount = AstraWrapper._objectCount(documents);

    span.setAttribute(SemanticConvention.DB_DOCUMENTS_COUNT, documentsCount);
    if (OpenlitConfig.captureMessageContent) {
      span.setAttribute(SemanticConvention.DB_QUERY_TEXT, AstraWrapper._safeStringify(documents));
    }

    const returnedRows = AstraWrapper._getInsertReturnedRows(response);
    if (returnedRows !== undefined) {
      span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, returnedRows);
    }

    span.setAttribute(
      SemanticConvention.DB_QUERY_SUMMARY,
      `${dbOperation} ${collectionName} documents_count=${documentsCount}`
    );
  }

  private static _setUpdateAttributes(span: any, { dbOperation, collectionName, args, response }: AstraOperationContext) {
    const filter = args[0] || {};
    const update = args[1] || {};

    AstraWrapper._setFilterAttribute(span, filter);
    if (OpenlitConfig.captureMessageContent) {
      span.setAttribute(SemanticConvention.DB_QUERY_TEXT, AstraWrapper._safeStringify(update));
    }

    const returnedRows = AstraWrapper._getUpdateReturnedRows(response);
    if (returnedRows !== undefined) {
      span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, returnedRows);
    }

    span.setAttribute(
      SemanticConvention.DB_QUERY_SUMMARY,
      `${dbOperation} ${collectionName} filter=${AstraWrapper._summaryValue(filter)} update=${AstraWrapper._summaryValue(update)}`
    );
  }

  private static _setReplaceAttributes(span: any, { dbOperation, collectionName, args }: AstraOperationContext) {
    const filter = args[0] || {};
    const upsert = AstraWrapper._hasUpsertOption(args);

    AstraWrapper._setFilterAttribute(span, filter);
    if (OpenlitConfig.captureMessageContent) {
      span.setAttribute(SemanticConvention.DB_QUERY_TEXT, AstraWrapper._safeStringify(filter));
    }

    span.setAttribute(
      SemanticConvention.DB_QUERY_SUMMARY,
      `${dbOperation} ${collectionName} filter=${AstraWrapper._summaryValue(filter)} upsert=${upsert}`
    );
  }

  private static _setSelectAttributes(span: any, { dbOperation, collectionName, args, response }: AstraOperationContext) {
    const filter = args[0] || {};

    AstraWrapper._setFilterAttribute(span, filter);
    if (OpenlitConfig.captureMessageContent) {
      span.setAttribute(SemanticConvention.DB_QUERY_TEXT, AstraWrapper._safeStringify(filter));
    }

    const returnedRows = AstraWrapper._getSelectReturnedRows(response);
    if (returnedRows !== undefined) {
      span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, returnedRows);
    }

    span.setAttribute(
      SemanticConvention.DB_QUERY_SUMMARY,
      `${dbOperation} ${collectionName} filter=${AstraWrapper._summaryValue(filter)}`
    );
  }

  private static _setDeleteAttributes(span: any, { dbOperation, collectionName, args, response }: AstraOperationContext) {
    const filter = args[0] || {};

    AstraWrapper._setFilterAttribute(span, filter);
    if (OpenlitConfig.captureMessageContent) {
      span.setAttribute(SemanticConvention.DB_QUERY_TEXT, AstraWrapper._safeStringify(filter));
    }

    const returnedRows = AstraWrapper._getDeleteReturnedRows(response, dbOperation);
    if (returnedRows !== undefined) {
      span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, returnedRows);
    }

    span.setAttribute(
      SemanticConvention.DB_QUERY_SUMMARY,
      `${dbOperation} ${collectionName} filter=${AstraWrapper._summaryValue(filter)}`
    );
  }

  private static _getActualDbOperation(dbOperation: string, args: any[]) {
    if (dbOperation === SemanticConvention.DB_OPERATION_REPLACE && AstraWrapper._hasUpsertOption(args)) {
      return SemanticConvention.DB_OPERATION_UPSERT;
    }
    return dbOperation;
  }

  private static _hasUpsertOption(args: any[]) {
    return args.slice(2).some((arg) => arg && typeof arg === 'object' && arg.upsert === true);
  }

  private static _setFilterAttribute(span: any, filter: any) {
    if (filter && typeof filter === 'object' && Object.keys(filter).length > 0) {
      span.setAttribute(SemanticConvention.DB_FILTER, AstraWrapper._safeStringify(filter));
    }
  }

  private static _getInsertReturnedRows(response: any): number | undefined {
    if (!response) return undefined;
    if (typeof response.insertedCount === 'number') return response.insertedCount;
    if (typeof response.inserted_count === 'number') return response.inserted_count;
    if (Array.isArray(response.insertedIds)) return response.insertedIds.length;
    if (Array.isArray(response.inserted_ids)) return response.inserted_ids.length;
    if (response.insertedIds && typeof response.insertedIds === 'object') return Object.keys(response.insertedIds).length;
    if (response.inserted_ids && typeof response.inserted_ids === 'object') return Object.keys(response.inserted_ids).length;
    if (response.insertedId || response.inserted_id) return 1;
    return undefined;
  }

  private static _getUpdateReturnedRows(response: any): number | undefined {
    if (!response) return undefined;
    if (typeof response.modifiedCount === 'number') return response.modifiedCount;
    if (typeof response.modified_count === 'number') return response.modified_count;
    if (typeof response.matchedCount === 'number') return response.matchedCount;
    if (typeof response.matched_count === 'number') return response.matched_count;
    if (typeof response.update_info?.nModified === 'number') return response.update_info.nModified;
    if (typeof response.updateInfo?.nModified === 'number') return response.updateInfo.nModified;
    return undefined;
  }

  private static _getSelectReturnedRows(response: any): number | undefined {
    if (!response || AstraWrapper._isCursorLike(response)) return undefined;
    if (Array.isArray(response)) return response.length;
    if (typeof response.length === 'number') return response.length;
    return 1;
  }

  private static _getDeleteReturnedRows(response: any, dbOperation: string): number | undefined {
    if (!response) return dbOperation === SemanticConvention.DB_OPERATION_FIND_AND_DELETE ? 0 : undefined;
    if (typeof response.deletedCount === 'number') return response.deletedCount;
    if (typeof response.deleted_count === 'number') return response.deleted_count;
    if (dbOperation === SemanticConvention.DB_OPERATION_FIND_AND_DELETE) return 1;
    return undefined;
  }

  private static _objectCount(obj: any): number {
    if (Array.isArray(obj)) return obj.length;
    if (obj !== undefined && obj !== null) return 1;
    return 0;
  }

  private static _isCursorLike(response: any): boolean {
    return !!response && (
      typeof response[Symbol.asyncIterator] === 'function'
      || typeof response[Symbol.iterator] === 'function'
      || typeof response.toArray === 'function'
      || typeof response.next === 'function'
    );
  }

  private static _summaryValue(value: any): string {
    return AstraWrapper._truncate(AstraWrapper._safeStringify(value));
  }

  private static _safeStringify(value: any): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private static _truncate(value: string, maxLength = 200): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  private static _getServerAddressAndPort(instance: any): ServerAddressAndPort {
    const endpoint = AstraWrapper._findEndpoint(instance);
    if (!endpoint) return DEFAULT_SERVER;

    return AstraWrapper._parseEndpoint(endpoint);
  }

  private static _findEndpoint(instance: any): string | undefined {
    const candidates = [
      instance,
      instance?.database,
      instance?.db,
      instance?.client,
      instance?._client,
      instance?.database?.client,
      instance?.db?.client,
    ];
    const keys = ['apiEndpoint', 'api_endpoint', 'endpoint', 'baseUrl', 'base_url'];

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      for (const key of keys) {
        const value = candidate[key];
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }

    return undefined;
  }

  private static _parseEndpoint(endpoint: string): ServerAddressAndPort {
    const fallbackPort = endpoint.startsWith('http://') ? 80 : DEFAULT_SERVER.serverPort;

    try {
      if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
        const parsed = new URL(endpoint);
        return {
          serverAddress: parsed.hostname || DEFAULT_SERVER.serverAddress,
          serverPort: parsed.port ? Number(parsed.port) : fallbackPort,
        };
      }
    } catch {
      return DEFAULT_SERVER;
    }

    const [serverAddress, port] = endpoint.split(':');
    return {
      serverAddress: serverAddress || DEFAULT_SERVER.serverAddress,
      serverPort: port ? Number(port) || DEFAULT_SERVER.serverPort : DEFAULT_SERVER.serverPort,
    };
  }
}

export default AstraWrapper;
