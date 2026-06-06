import { SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

class AstraWrapper extends BaseWrapper {
  static dbSystem = SemanticConvention.DB_SYSTEM_ASTRA;
  static serverAddress = 'astra.datastax.com';
  static serverPort = 443;

  static _setCommonAttributes(span: any, dbOperation: string, collectionName: string) {
    const applicationName = OpenlitConfig.applicationName || '';
    const environment = OpenlitConfig.environment || '';

    span.setAttribute(SemanticConvention.DB_SYSTEM_NAME, AstraWrapper.dbSystem);
    span.setAttribute(SemanticConvention.DB_OPERATION_NAME, dbOperation);
    span.setAttribute(SemanticConvention.DB_COLLECTION_NAME, collectionName);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, AstraWrapper.serverAddress);
    span.setAttribute(SemanticConvention.SERVER_PORT, AstraWrapper.serverPort);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
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

            AstraWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);
            AstraWrapper._setSelectAttributes(span, dbOperation, collectionName, args, response);

            span.setStatus({ code: 1 }); // SpanStatusCode.OK
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

          AstraWrapper._setCommonAttributes(span, SemanticConvention.DB_OPERATION_SELECT, collectionName);
          span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

          const filter = args[0] || {};
          if (filter && typeof filter === 'object' && Object.keys(filter).length > 0) {
            span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(filter));
          }
          if (OpenlitConfig.captureMessageContent && filter) {
            span.setAttribute(SemanticConvention.DB_QUERY_TEXT, JSON.stringify(filter));
          }
          span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
            `${SemanticConvention.DB_OPERATION_SELECT} ${collectionName}`);
          span.setStatus({ code: 1 }); // SpanStatusCode.OK
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

  /**
   * Shared SELECT-case attribute logic for both async (findOne) and sync (find) paths.
   */
  private static _setSelectAttributes(
    span: any, dbOperation: string, collectionName: string, args: any[], response: any,
  ) {
    if (dbOperation !== SemanticConvention.DB_OPERATION_SELECT) return;

    const params = args[0] || {};
    if (params && typeof params === 'object' && Object.keys(params).length > 0) {
      span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(params));
    }
    if (OpenlitConfig.captureMessageContent && params) {
      span.setAttribute(SemanticConvention.DB_QUERY_TEXT, JSON.stringify(params));
    }
    if (response && typeof response[Symbol.asyncIterator] === 'function') {
      span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
        `${dbOperation} ${collectionName}`);
    } else {
      const returnedRows = response ? 1 : 0;
      span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, returnedRows);
      span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
        `${dbOperation} ${collectionName}`);
    }
  }
}

export default AstraWrapper;
