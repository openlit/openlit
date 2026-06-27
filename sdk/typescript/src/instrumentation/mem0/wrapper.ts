import { SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import { SDK_NAME, SDK_VERSION } from '../../constant';
import { applyCustomSpanAttributes } from '../../helpers';
import { SpanStatusCode } from '@opentelemetry/api';

class Mem0Wrapper {
  static dbSystem = SemanticConvention.DB_SYSTEM_MEM0;
  static serverAddress = 'api.mem0.ai';
  static serverPort = 443;

  /**
   * Set common attributes on a Mem0 span.
   */
  static _setCommonAttributes(span: any, dbOperation: string) {
    const applicationName = OpenlitConfig.applicationName || '';
    const environment = OpenlitConfig.environment || '';

    span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
    span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, SDK_VERSION);
    span.setAttribute(SemanticConvention.DB_SYSTEM_NAME, Mem0Wrapper.dbSystem);
    span.setAttribute(SemanticConvention.DB_OPERATION_NAME, dbOperation);
    span.setAttribute(SemanticConvention.SERVER_ADDRESS, Mem0Wrapper.serverAddress);
    span.setAttribute(SemanticConvention.SERVER_PORT, Mem0Wrapper.serverPort);
    span.setAttribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment);
    span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, applicationName);
    span.setAttribute(ATTR_SERVICE_NAME, applicationName);
    span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, environment);
    applyCustomSpanAttributes(span);
  }

  /**
   * Patch a MemoryClient method (add, search, get, etc.).
   *
   * Span name: `<operation> mem0` (e.g. "ADD mem0", "SEARCH mem0")
   *
   * args[0] is typically the payload (messages/query/memory_id/…).
   */
  static _patchMethod(tracer: Tracer, methodName: string, dbOperation: string): any {
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const spanName = `${dbOperation} mem0`;
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            Mem0Wrapper._setCommonAttributes(span, dbOperation);
            span.setAttribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, duration);

            // Operation-specific attributes
            const params: any = args[0] || {};
            switch (methodName) {
              case 'add': {
                // add(messages, { user_id?, agent_id?, run_id?, metadata?, ... })
                const opts: any = args[1] || {};
                if (opts.user_id) span.setAttribute('mem0.user_id', opts.user_id);
                if (opts.agent_id) span.setAttribute('mem0.agent_id', opts.agent_id);
                if (opts.run_id) span.setAttribute('mem0.run_id', opts.run_id);
                const msgCount = Array.isArray(params) ? params.length : (params ? 1 : 0);
                span.setAttribute(SemanticConvention.DB_DOCUMENTS_COUNT, msgCount);
                const returnedCount = Array.isArray(response?.results)
                  ? response.results.length
                  : (response ? 1 : 0);
                span.setAttribute(SemanticConvention.DB_N_RESULTS, returnedCount);
                span.setAttribute(
                  SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} mem0 messages=${msgCount}`
                );
                if (OpenlitConfig.captureMessageContent && params) {
                  span.setAttribute(
                    SemanticConvention.DB_QUERY_TEXT,
                    typeof params === 'string' ? params : JSON.stringify(params)
                  );
                }
                break;
              }
              case 'search': {
                // search(query, { user_id?, agent_id?, run_id?, limit?, filters?, ... })
                const opts: any = args[1] || {};
                const query: string = typeof params === 'string' ? params : JSON.stringify(params);
                span.setAttribute(SemanticConvention.DB_VECTOR_QUERY_TOP_K, opts.limit || 10);
                if (opts.user_id) span.setAttribute('mem0.user_id', opts.user_id);
                if (opts.agent_id) span.setAttribute('mem0.agent_id', opts.agent_id);
                if (opts.run_id) span.setAttribute('mem0.run_id', opts.run_id);
                if (opts.filters) {
                  span.setAttribute(SemanticConvention.DB_FILTER, JSON.stringify(opts.filters));
                }
                const resultCount = Array.isArray(response?.results)
                  ? response.results.length
                  : (Array.isArray(response) ? response.length : 0);
                span.setAttribute(SemanticConvention.DB_N_RESULTS, resultCount);
                if (OpenlitConfig.captureMessageContent) {
                  span.setAttribute(SemanticConvention.DB_QUERY_TEXT, query);
                }
                span.setAttribute(
                  SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} mem0 limit=${opts.limit || 10}`
                );
                break;
              }
              case 'get': {
                // get(memory_id)
                const memoryId: string = typeof params === 'string' ? params : JSON.stringify(params);
                span.setAttribute(SemanticConvention.DB_ID_COUNT, 1);
                span.setAttribute(
                  SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} mem0 id=${memoryId}`
                );
                break;
              }
              case 'getAll': {
                // getAll({ user_id?, agent_id?, run_id?, ... })
                if (params.user_id) span.setAttribute('mem0.user_id', params.user_id);
                if (params.agent_id) span.setAttribute('mem0.agent_id', params.agent_id);
                if (params.run_id) span.setAttribute('mem0.run_id', params.run_id);
                const returnedRows = Array.isArray(response?.results)
                  ? response.results.length
                  : (Array.isArray(response) ? response.length : 0);
                span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, returnedRows);
                span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY, `${dbOperation} mem0`);
                break;
              }
              case 'update': {
                // update(memory_id, data)
                const memoryId: string = typeof params === 'string' ? params : JSON.stringify(params);
                span.setAttribute(SemanticConvention.DB_ID_COUNT, 1);
                span.setAttribute(
                  SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} mem0 id=${memoryId}`
                );
                break;
              }
              case 'delete': {
                // delete(memory_id)
                const memoryId: string = typeof params === 'string' ? params : JSON.stringify(params);
                span.setAttribute(SemanticConvention.DB_ID_COUNT, 1);
                span.setAttribute(
                  SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} mem0 id=${memoryId}`
                );
                break;
              }
              case 'deleteAll':
              case 'reset': {
                // deleteAll({ user_id?, agent_id?, run_id? }) / reset()
                if (params.user_id) span.setAttribute('mem0.user_id', params.user_id);
                if (params.agent_id) span.setAttribute('mem0.agent_id', params.agent_id);
                if (params.run_id) span.setAttribute('mem0.run_id', params.run_id);
                span.setAttribute(SemanticConvention.DB_QUERY_SUMMARY, `${dbOperation} mem0`);
                break;
              }
              case 'history': {
                // history(memory_id)
                const memoryId: string = typeof params === 'string' ? params : JSON.stringify(params);
                span.setAttribute(SemanticConvention.DB_ID_COUNT, 1);
                const returnedRows = Array.isArray(response) ? response.length : 0;
                span.setAttribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, returnedRows);
                span.setAttribute(
                  SemanticConvention.DB_QUERY_SUMMARY,
                  `${dbOperation} mem0 id=${memoryId}`
                );
                break;
              }
            }

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
}

export default Mem0Wrapper;
