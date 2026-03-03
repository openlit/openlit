import { SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

class QdrantWrapper extends BaseWrapper {
  static dbSystem = SemanticConvention.DB_SYSTEM_QDRANT;
  static serverAddress = 'localhost';
  static serverPort = 6333;

  static _setCommonAttributes(span: any, dbOperation: string, collectionName: string) {
    const applicationName = OpenlitConfig.applicationName || '';
    const environment = OpenlitConfig.environment || '';

    span.setAttribute(SemanticConvention.DB_SYSTEM_NAME, QdrantWrapper.dbSystem);
    span.setAttribute(SemanticConvention.DB_OPERATION_NAME, dbOperation);
    span.setAttribute(SemanticConvention.DB_COLLECTION_NAME, collectionName);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, QdrantWrapper.serverAddress);
    span.setAttribute(SemanticConvention.SERVER_PORT, QdrantWrapper.serverPort);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
  }

  static _patchSearch(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_SEARCH;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        // args[0] = collectionName, args[1] = searchParams
        const collectionName: string = typeof args[0] === 'string' ? args[0] : 'unknown';
        const params = args[1] || {};
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            QdrantWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);
            span.setAttribute(SemanticConvention.DB_VECTOR_QUERY_TOP_K, params.limit || 10);

            if (params.filter) {
              span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(params.filter));
            }
            if (params.with_payload !== undefined) {
              span.setAttribute(SemanticConvention.DB_WITH_PAYLOAD, String(params.with_payload));
            }

            const resultCount = Array.isArray(response) ? response.length : 0;
            span.setAttribute(SemanticConvention.DB_N_RESULTS, resultCount);

            if (OpenlitConfig.traceContent && params.vector) {
              const vectorPreview = Array.isArray(params.vector)
                ? JSON.stringify(params.vector.slice(0, 10))
                : String(params.vector);
              span.setAttribute(SemanticConvention.DB_QUERY_TEXT, vectorPreview);
            }

            span.setAttribute(
              SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${collectionName} limit=${params.limit || 10} filtered=${params.filter ? 'true' : 'false'}`
            );

            span.setStatus({ code: 1 });
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

  static _patchUpsert(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_UPSERT;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const collectionName: string = typeof args[0] === 'string' ? args[0] : 'unknown';
        const params = args[1] || {};
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;
            const points = params.points || [];

            QdrantWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);
            span.setAttribute(SemanticConvention.DB_VECTOR_COUNT, points.length);
            span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${collectionName} points=${points.length}`);

            span.setStatus({ code: 1 });
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

  static _patchDelete(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_DELETE;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const collectionName: string = typeof args[0] === 'string' ? args[0] : 'unknown';
        const params = args[1] || {};
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            QdrantWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            const points = params.points || [];
            if (points.length > 0) {
              span.setAttribute(SemanticConvention.DB_ID_COUNT, points.length);
            }
            if (params.filter) {
              span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(params.filter));
            }
            span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${collectionName} points=${points.length}`);

            span.setStatus({ code: 1 });
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

  static _patchRetrieve(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_GET;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const collectionName: string = typeof args[0] === 'string' ? args[0] : 'unknown';
        const params = args[1] || {};
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            QdrantWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            const ids = Array.isArray(params.ids) ? params.ids : [];
            span.setAttribute(SemanticConvention.DB_ID_COUNT, ids.length);
            const resultCount = Array.isArray(response) ? response.length : 0;
            span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, resultCount);
            span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${collectionName} ids=${ids.length}`);

            span.setStatus({ code: 1 });
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

  static _patchScroll(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_GET;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const collectionName: string = typeof args[0] === 'string' ? args[0] : 'unknown';
        const params = args[1] || {};
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            QdrantWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);
            span.setAttribute(SemanticConvention.DB_QUERY_LIMIT, params.limit || 10);

            if (params.filter) {
              span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(params.filter));
            }

            const resultCount = response?.points?.length || 0;
            span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, resultCount);
            span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${collectionName} limit=${params.limit || 10}`);

            span.setStatus({ code: 1 });
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
}

export default QdrantWrapper;
