import { SpanKind, SpanStatusCode, Tracer, context, trace } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME, ATTR_TELEMETRY_SDK_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../../config';
import { SDK_NAME } from '../../constant';
import OpenLitHelper, { applyCustomSpanAttributes } from '../../helpers';
import SemanticConvention from '../../semantic-convention';

// `gen_ai.sdk.version` reports the *instrumented* package version (mem0ai), matching
// the Python SDK (importlib.metadata.version("mem0ai")) rather than OpenLIT's version.
// The reliable source is the version OTel passes to the patch hook, threaded in as the
// `version` arg of _patchMemoryOperation. This module-level require is only a fallback
// for manualPatch — and note mem0ai's "exports" map blocks `mem0ai/package.json`, so it
// resolves to 'unknown' for mem0ai itself; that's fine, the OTel-provided version wins.
let mem0SdkVersion = 'unknown';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mem0SdkVersion = require('mem0ai/package.json')?.version || 'unknown';
} catch {
  mem0SdkVersion = 'unknown';
}

/**
 * Wrapper for mem0 memory-layer operations. mem0 exposes the same method surface on
 * the hosted `MemoryClient` (`mem0ai`) and the self-hosted `Memory` (`mem0ai/oss`):
 * add / search / get / getAll / update / delete / deleteAll / history. Every method
 * returns a Promise, so a single async wrapper handles them all. The emitted spans
 * mirror the Python reference (sdk/python/src/openlit/instrumentation/mem0): one
 * CLIENT span per call named `memory <op>`, with `gen_ai.*` attributes. No tokens,
 * model, cost, or metrics are involved (matching Python) so this does not use the
 * chat-oriented BaseWrapper.
 */
class Mem0Wrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_MEM0;

  /**
   * Returns a wrapper (over an original Promise-returning method) that emits one
   * `memory <op>` CLIENT span. `spanName` is the Python endpoint string, e.g.
   * `memory add` or `memory get_all`.
   */
  static _patchMemoryOperation(tracer: Tracer, spanName: string, version?: string): any {
    const sdkVersion = version || mem0SdkVersion;
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(spanName, { kind: SpanKind.CLIENT });
        const startTime = Date.now();

        return context.with(trace.setSpan(context.active(), span), async () => {
          try {
            const response = await originalMethod.apply(this, args);
            const duration = (Date.now() - startTime) / 1000;

            Mem0Wrapper._setSpanAttributes(span, spanName, args, response, sdkVersion);
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
            Mem0Wrapper._setContentAttributes(span, spanName, args, response);

            span.setStatus({ code: SpanStatusCode.OK });
            return response;
          } catch (e: any) {
            const duration = (Date.now() - startTime) / 1000;
            span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);
            try {
              Mem0Wrapper._setSpanAttributes(span, spanName, args, undefined, sdkVersion);
            } catch {
              /* best-effort attributes on the error path */
            }
            OpenLitHelper.handleException(span, e);
            throw e;
          } finally {
            span.end();
          }
        });
      };
    };
  }

  /** Sets every non-content attribute (core + scope + memory + operation + response). */
  static _setSpanAttributes(
    span: any,
    spanName: string,
    args: any[],
    response?: any,
    sdkVersion: string = mem0SdkVersion
  ) {
    const applicationName = OpenlitConfig.applicationName || '';
    const environment = OpenlitConfig.environment || '';

    // Core attributes (set on every memory span).
    span.setAttribute(ATTR_TELEMETRY_SDK_NAME, SDK_NAME);
    // Set both provider-name keys to 'mem0': gen_ai.system (the key Python mem0 uses)
    // and gen_ai.provider.name (the OTel framework convention). Same value either way.
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, Mem0Wrapper.aiSystem);
    span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, Mem0Wrapper.aiSystem);
    span.setAttribute(SemanticConvention.GEN_AI_ENDPOINT, spanName);
    span.setAttribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_MEMORY);
    span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, environment);
    span.setAttribute(ATTR_SERVICE_NAME, applicationName);
    span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, sdkVersion);

    const config = Mem0Wrapper._extractConfig(spanName, args);

    // Session scope — present either at the top level of the config object or inside a
    // nested `filters` object, in camelCase (v3 SDK) or snake_case (filters / hosted API).
    const userId = Mem0Wrapper._scopeValue(config, 'userId', 'user_id');
    const agentId = Mem0Wrapper._scopeValue(config, 'agentId', 'agent_id');
    const runId = Mem0Wrapper._scopeValue(config, 'runId', 'run_id');
    if (userId !== undefined) span.setAttribute(SemanticConvention.GEN_AI_USER_ID, userId);
    if (agentId !== undefined) span.setAttribute(SemanticConvention.GEN_AI_AGENT_ID, agentId);
    if (runId !== undefined) span.setAttribute(SemanticConvention.GEN_AI_RUN_ID, runId);

    // Memory type / metadata.
    const memoryType = config?.memoryType ?? config?.memory_type;
    if (memoryType !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_MEMORY_TYPE, memoryType);
    }
    if (config?.metadata !== undefined && config?.metadata !== null) {
      span.setAttribute(
        SemanticConvention.GEN_AI_MEMORY_METADATA,
        Mem0Wrapper._safeStringify(config.metadata)
      );
    }

    Mem0Wrapper._setOperationAttributes(span, spanName, args, config);
    Mem0Wrapper._setResponseAttributes(span, response);

    applyCustomSpanAttributes(span);
  }

  private static _setOperationAttributes(span: any, spanName: string, args: any[], config: any) {
    switch (spanName) {
      case 'memory add': {
        const messages = args[0];
        if (config && Object.prototype.hasOwnProperty.call(config, 'infer')) {
          span.setAttribute(SemanticConvention.GEN_AI_MEMORY_INFER, config.infer);
        }
        if (Mem0Wrapper._hasMessages(messages)) {
          const count = Array.isArray(messages) ? messages.length : 1;
          span.setAttribute(SemanticConvention.GEN_AI_MEMORY_COUNT, count);
        }
        break;
      }
      case 'memory search': {
        const query = args[0];
        if (query !== undefined) {
          span.setAttribute(SemanticConvention.GEN_AI_MEMORY_SEARCH_QUERY, query);
        }
        // v3 SDK uses `topK`; older / hosted shapes use `limit`.
        const limit = config?.topK ?? config?.limit;
        if (limit !== undefined) {
          span.setAttribute(SemanticConvention.GEN_AI_MEMORY_SEARCH_LIMIT, limit);
        }
        if (config?.threshold !== undefined) {
          span.setAttribute(SemanticConvention.GEN_AI_MEMORY_SEARCH_THRESHOLD, config.threshold);
        }
        break;
      }
      case 'memory update': {
        const memoryId = args[0];
        if (memoryId !== undefined) span.setAttribute(SemanticConvention.DB_UPDATE_ID, memoryId);
        break;
      }
      case 'memory delete': {
        const memoryId = args[0];
        if (memoryId !== undefined) span.setAttribute(SemanticConvention.DB_DELETE_ID, memoryId);
        break;
      }
      case 'memory get': {
        const memoryId = args[0];
        if (memoryId !== undefined) span.setAttribute(SemanticConvention.DB_OPERATION_ID, memoryId);
        break;
      }
      default:
        // get_all, delete_all, history: no extra operation-specific id attribute.
        break;
    }
  }

  private static _setResponseAttributes(span: any, response: any) {
    if (!response) return;

    let count: number;
    if (Array.isArray(response)) {
      count = response.length;
    } else if (typeof response === 'object') {
      // A results array reflects the true count — an empty list is 0; a single-object
      // response (e.g. get / update) counts as 1. NOTE: the Python reference reports 1
      // for an empty results list (its `if results` is falsy on []); we intentionally
      // report the accurate 0 here (per a Sourcery review; Python sync tracked separately).
      count = Array.isArray(response.results) ? response.results.length : 1;
    } else {
      count = 1;
    }

    span.setAttribute(SemanticConvention.GEN_AI_MEMORY_OPERATION_RESULT_COUNT, count);
    span.setAttribute(SemanticConvention.GEN_AI_DATA_SOURCES, count);
  }

  /** Captures input (add) / output (search) content when capture is enabled. */
  static _setContentAttributes(span: any, spanName: string, args: any[], response: any) {
    if (!OpenlitConfig.captureMessageContent) return;

    try {
      if (spanName === 'memory add') {
        const messages = args[0];
        if (Mem0Wrapper._hasMessages(messages)) {
          const content =
            typeof messages === 'object' ? Mem0Wrapper._safeStringify(messages) : String(messages);
          span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, content);
        }
      }
      if (spanName === 'memory search' && response) {
        const content =
          typeof response === 'object' ? Mem0Wrapper._safeStringify(response) : String(response);
        span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, content);
      }
    } catch {
      /* best-effort content capture */
    }
  }

  /**
   * Returns the options/config object for an operation, accounting for the fact that
   * its argument position differs by method: add/search take it as the 2nd arg, while
   * getAll/deleteAll take it as the 1st. get/update/history take a positional id and
   * carry no scope config.
   */
  private static _extractConfig(spanName: string, args: any[]): any {
    switch (spanName) {
      case 'memory add':
      case 'memory search':
      case 'memory delete':
        return args[1] && typeof args[1] === 'object' ? args[1] : {};
      case 'memory get_all':
      case 'memory delete_all':
        return args[0] && typeof args[0] === 'object' ? args[0] : {};
      default:
        return {};
    }
  }

  private static _scopeValue(config: any, camelKey: string, snakeKey: string): any {
    if (!config || typeof config !== 'object') return undefined;
    if (config[camelKey] !== undefined) return config[camelKey];
    if (config[snakeKey] !== undefined) return config[snakeKey];
    const filters = config.filters;
    if (filters && typeof filters === 'object') {
      if (filters[camelKey] !== undefined) return filters[camelKey];
      if (filters[snakeKey] !== undefined) return filters[snakeKey];
    }
    return undefined;
  }

  private static _hasMessages(messages: any): boolean {
    if (messages === undefined || messages === null) return false;
    if (Array.isArray(messages)) return messages.length > 0;
    if (typeof messages === 'string') return messages.length > 0;
    return true;
  }

  private static _safeStringify(value: any): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}

export default Mem0Wrapper;
