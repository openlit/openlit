import { SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

class MilvusWrapper extends BaseWrapper {
  static dbSystem = SemanticConvention.DB_SYSTEM_MILVUS;
  static serverAddress = 'localhost';
  static serverPort = 19530;

  static _setCommonAttributes(span: any, dbOperation: string, collectionName: string) {
    const applicationName = OpenlitConfig.applicationName || '';
    const environment = OpenlitConfig.environment || '';

    span.setAttribute(SemanticConvention.DB_SYSTEM_NAME, MilvusWrapper.dbSystem);
    span.setAttribute(SemanticConvention.DB_OPERATION_NAME, dbOperation);
    span.setAttribute(SemanticConvention.DB_COLLECTION_NAME, collectionName);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, MilvusWrapper.serverAddress);
    span.setAttribute(SemanticConvention.SERVER_PORT, MilvusWrapper.serverPort);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
  }

  // Milvus SDK uses `collection_name` in params for most methods
  static _getCollectionName(params: any): string {
    return params?.collection_name || params?.collectionName || 'unknown';
  }

  static _patchSearch(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_SEARCH;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const params = args[0] || {};
        const collectionName = MilvusWrapper._getCollectionName(params);
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MilvusWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);
            span.setAttribute(SemanticConvention.DB_VECTOR_QUERY_TOP_K, params.topk || params.limit || 10);

            if (params.expr || params.filter) {
              span.setAttribute(SemanticConvention.DB_FILTER, params.expr || params.filter);
            }
            if (params.output_fields) {
              span.setAttribute(SemanticConvention.DB_OUTPUT_FIELDS, JSON.stringify(params.output_fields));
            }

            const resultCount = response?.results?.length || 0;
            span.setAttribute(SemanticConvention.DB_N_RESULTS, resultCount);

            if (OpenlitConfig.captureMessageContent && params.vectors) {
              const vectors = Array.isArray(params.vectors) ? params.vectors : [];
              span.setAttribute(SemanticConvention.DB_QUERY_TEXT,
                JSON.stringify(vectors.slice(0, 1).map((v: number[]) => v?.slice(0, 10))));
            }

            span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${collectionName} topk=${params.topk || params.limit || 10}`);

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

  static _patchInsert(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_INSERT;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const params = args[0] || {};
        const collectionName = MilvusWrapper._getCollectionName(params);
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MilvusWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            const data = params.data || params.fields_data || [];
            const rowCount = Array.isArray(data) ? data.length : 0;
            span.setAttribute(SemanticConvention.DB_VECTOR_COUNT, rowCount);
            span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${collectionName} rows=${rowCount}`);

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
        const params = args[0] || {};
        const collectionName = MilvusWrapper._getCollectionName(params);
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MilvusWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            const data = params.data || params.fields_data || [];
            const rowCount = Array.isArray(data) ? data.length : 0;
            span.setAttribute(SemanticConvention.DB_VECTOR_COUNT, rowCount);
            span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${collectionName} rows=${rowCount}`);

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
        const params = args[0] || {};
        const collectionName = MilvusWrapper._getCollectionName(params);
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MilvusWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            if (params.expr || params.filter) {
              span.setAttribute(SemanticConvention.DB_FILTER, params.expr || params.filter);
            }
            const ids = params.ids || [];
            if (Array.isArray(ids) && ids.length > 0) {
              span.setAttribute(SemanticConvention.DB_ID_COUNT, ids.length);
            }
            span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${collectionName}`);

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

  static _patchQuery(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_QUERY;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const params = args[0] || {};
        const collectionName = MilvusWrapper._getCollectionName(params);
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            MilvusWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            if (params.expr || params.filter) {
              span.setAttribute(SemanticConvention.DB_FILTER, params.expr || params.filter);
            }
            if (params.limit) {
              span.setAttribute(SemanticConvention.DB_QUERY_LIMIT, params.limit);
            }
            if (params.output_fields) {
              span.setAttribute(SemanticConvention.DB_OUTPUT_FIELDS, JSON.stringify(params.output_fields));
            }

            const resultCount = response?.data?.length || 0;
            span.setAttribute(SemanticConvention.DB_N_RESULTS, resultCount);
            span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${collectionName} results=${resultCount}`);

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

export default MilvusWrapper;
