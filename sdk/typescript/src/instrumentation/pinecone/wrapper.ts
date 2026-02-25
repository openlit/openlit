import { SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

class PineconeWrapper extends BaseWrapper {
  static dbSystem = SemanticConvention.DB_SYSTEM_PINECONE;
  static serverAddress = 'pinecone.io';
  static serverPort = 443;

  // Safely resolve the namespace string from the Index instance.
  // `this.namespace` on a Pinecone Index is a METHOD that creates namespace-scoped
  // sub-indices, not a string property. The actual namespace string may be stored
  // internally in `this.target.namespace` depending on the SDK version.
  static _resolveNamespace(indexInstance: any, paramsNamespace?: string): string {
    if (paramsNamespace && typeof paramsNamespace === 'string') return paramsNamespace;
    const ns = indexInstance?.target?.namespace ?? indexInstance?._namespace ?? '';
    return typeof ns === 'string' && ns ? ns : 'default';
  }

  static _setCommonAttributes(span: any, dbOperation: string, namespace: string) {
    const applicationName = OpenlitConfig.applicationName || '';
    const environment = OpenlitConfig.environment || '';

    span.setAttribute(SemanticConvention.DB_SYSTEM_NAME, PineconeWrapper.dbSystem);
    span.setAttribute(SemanticConvention.DB_OPERATION_NAME, dbOperation);
    span.setAttribute(SemanticConvention.DB_NAMESPACE, namespace);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, PineconeWrapper.serverAddress);
    span.setAttribute(SemanticConvention.SERVER_PORT, PineconeWrapper.serverPort);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
  }

  static _patchQuery(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_QUERY;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const params = args[0] || {};
        const namespace = PineconeWrapper._resolveNamespace(this, params.namespace);
        const spanName = `${dbOperation} ${namespace}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            PineconeWrapper._setCommonAttributes(span, dbOperation, namespace);
            span.setAttribute(SemanticConvention.DB_VECTOR_QUERY_TOP_K, params.topK || 0);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            if (params.filter) {
              span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(params.filter));
            }

            const matchCount = response?.matches?.length || 0;
            span.setAttribute(SemanticConvention.DB_N_RESULTS, matchCount);

            if (OpenlitConfig.traceContent && params.vector) {
              span.setAttribute(SemanticConvention.DB_QUERY_TEXT, JSON.stringify(params.vector?.slice(0, 10)));
            }

            span.setAttribute(
              SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${namespace} top_k=${params.topK || 0} filtered=${params.filter ? 'true' : 'false'}`
            );

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

  static _patchUpsert(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_UPSERT;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const namespace = PineconeWrapper._resolveNamespace(this);
        const spanName = `${dbOperation} ${namespace}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const records = Array.isArray(args[0]) ? args[0] : [];
            const duration = (Date.now() - startTime) / 1000;

            PineconeWrapper._setCommonAttributes(span, dbOperation, namespace);
            span.setAttribute(SemanticConvention.DB_VECTOR_COUNT, records.length);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);
            span.setAttribute(
              SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${namespace} vectors_count=${records.length}`
            );

            if (OpenlitConfig.traceContent && records.length > 0) {
              span.setAttribute(SemanticConvention.DB_QUERY_TEXT, JSON.stringify(records.map((r: any) => r.id)));
            }

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

  static _patchDelete(tracer: Tracer, operationName: string): any {
    const dbOperation = SemanticConvention.DB_OPERATION_DELETE;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const namespace = PineconeWrapper._resolveNamespace(this);
        const spanName = `${dbOperation} ${namespace}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const params = args[0] || {};
            const duration = (Date.now() - startTime) / 1000;

            PineconeWrapper._setCommonAttributes(span, `${dbOperation}.${operationName}`, namespace);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            // deleteOne passes an id string; deleteMany passes an array of ids
            let ids: string[] = [];
            if (typeof params === 'string') {
              ids = [params];
              span.setAttribute(SemanticConvention.DB_ID_COUNT, 1);
            } else if (Array.isArray(params)) {
              ids = params;
              span.setAttribute(SemanticConvention.DB_ID_COUNT, params.length);
            } else if (params.ids) {
              ids = Array.isArray(params.ids) ? params.ids : [params.ids];
              span.setAttribute(SemanticConvention.DB_ID_COUNT, ids.length);
            }
            if (params.deleteAll) {
              span.setAttribute(SemanticConvention.DB_DELETE_ALL, true);
            }
            if (params.filter) {
              span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(params.filter));
            }

            span.setAttribute(
              SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${namespace} ids=${JSON.stringify(ids)} delete_all=${params.deleteAll || false}`
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

  static _patchUpdate(tracer: Tracer): any {
    const dbOperation = SemanticConvention.DB_OPERATION_UPDATE;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const namespace = PineconeWrapper._resolveNamespace(this);
        const spanName = `${dbOperation} ${namespace}`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const params = args[0] || {};
            const duration = (Date.now() - startTime) / 1000;

            PineconeWrapper._setCommonAttributes(span, dbOperation, namespace);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            if (params.id) span.setAttribute(SemanticConvention.DB_UPDATE_ID, params.id);
            if (params.values) span.setAttribute(SemanticConvention.DB_UPDATE_VALUES, String(params.values?.length || 0));
            if (params.metadata) {
              span.setAttribute(SemanticConvention.DB_UPDATE_METADATA, JSON.stringify(params.metadata));
            }

            span.setAttribute(
              SemanticConvention.DB_QUERY_SUMMARY,
              `${dbOperation} ${namespace} id=${params.id || ''} values=${params.values?.length || 0} set_metadata=${params.metadata ? JSON.stringify(params.metadata) : ''}`
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
}

export default PineconeWrapper;
