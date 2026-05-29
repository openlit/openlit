import { SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

class ChromaWrapper extends BaseWrapper {
  static dbSystem = SemanticConvention.DB_SYSTEM_CHROMA;
  static serverAddress = 'localhost';
  static serverPort = 8000;

  static _setCommonAttributes(span: any, dbOperation: string, collectionName: string) {
    const applicationName = OpenlitConfig.applicationName || '';
    const environment = OpenlitConfig.environment || '';

    span.setAttribute(SemanticConvention.DB_SYSTEM_NAME, ChromaWrapper.dbSystem);
    span.setAttribute(SemanticConvention.DB_OPERATION_NAME, dbOperation);
    span.setAttribute(SemanticConvention.DB_COLLECTION_NAME, collectionName);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, ChromaWrapper.serverAddress);
    span.setAttribute(SemanticConvention.SERVER_PORT, ChromaWrapper.serverPort);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
  }

  static _patchCollectionMethod(tracer: Tracer, dbOperation: string): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        // `this` is a Collection instance; name is stored as this.name
        const collectionName: string = this?.name || 'unknown';
        const spanName = `${dbOperation} ${collectionName}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;
            const params = args[0] || {};

            ChromaWrapper._setCommonAttributes(span, dbOperation, collectionName);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            // Operation-specific attributes
            switch (dbOperation) {
              case SemanticConvention.DB_OPERATION_QUERY: {
                const nResults = params.nResults || params.n_results || 10;
                span.setAttribute(SemanticConvention.DB_VECTOR_QUERY_TOP_K, nResults);
                if (params.where) span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(params.where));
                if (params.whereDocument) span.setAttribute(SemanticConvention.DB_WHERE_DOCUMENT, JSON.stringify(params.whereDocument));
                const returnedCount = response?.ids?.[0]?.length || 0;
                span.setAttribute(SemanticConvention.DB_N_RESULTS, returnedCount);
                if (OpenlitConfig.captureMessageContent && params.queryTexts) {
                  span.setAttribute(SemanticConvention.DB_QUERY_TEXT, JSON.stringify(params.queryTexts));
                }
                span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} ${collectionName} n_results=${nResults}`);
                break;
              }
              case SemanticConvention.DB_OPERATION_INSERT:
              case SemanticConvention.DB_OPERATION_UPSERT: {
                const count = Array.isArray(params.ids) ? params.ids.length : (params.ids ? 1 : 0);
                span.setAttribute(SemanticConvention.DB_ID_COUNT, count);
                span.setAttribute(SemanticConvention.DB_VECTOR_COUNT, count);
                if (Array.isArray(params.documents)) {
                  span.setAttribute(SemanticConvention.DB_DOCUMENTS_COUNT, params.documents.length);
                }
                if (Array.isArray(params.metadatas)) {
                  span.setAttribute(SemanticConvention.DB_METADATA_COUNT, params.metadatas.length);
                }
                span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} ${collectionName} count=${count}`);
                break;
              }
              case SemanticConvention.DB_OPERATION_GET: {
                const ids = params.ids;
                const idCount = Array.isArray(ids) ? ids.length : (ids ? 1 : 0);
                if (idCount > 0) span.setAttribute(SemanticConvention.DB_ID_COUNT, idCount);
                if (params.where) span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(params.where));
                const returnedRows = response?.ids?.length || 0;
                span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, returnedRows);
                span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} ${collectionName} ids=${idCount}`);
                break;
              }
              case SemanticConvention.DB_OPERATION_DELETE: {
                const ids = params.ids;
                const idCount = Array.isArray(ids) ? ids.length : (ids ? 1 : 0);
                if (idCount > 0) span.setAttribute(SemanticConvention.DB_ID_COUNT, idCount);
                if (params.where) span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(params.where));
                span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} ${collectionName} ids=${idCount}`);
                break;
              }
              case SemanticConvention.DB_OPERATION_PEEK: {
                const limit = params.limit || params || 10;
                span.setAttribute(SemanticConvention.DB_QUERY_LIMIT, typeof limit === 'number' ? limit : 10);
                const returnedRows = response?.ids?.length || 0;
                span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, returnedRows);
                span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} ${collectionName}`);
                break;
              }
              case SemanticConvention.DB_OPERATION_UPDATE: {
                const ids = params.ids;
                const idCount = Array.isArray(ids) ? ids.length : (ids ? 1 : 0);
                if (idCount > 0) span.setAttribute(SemanticConvention.DB_ID_COUNT, idCount);
                span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} ${collectionName} ids=${idCount}`);
                break;
              }
            }

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
}

export default ChromaWrapper;
