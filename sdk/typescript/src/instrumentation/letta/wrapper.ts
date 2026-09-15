import { Span, SpanKind, SpanStatusCode, Tracer, context, trace } from '@opentelemetry/api';
import { isTracingSuppressed } from '@opentelemetry/core';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import { getOperationType, getSpanName, processLettaResponse } from './utils';

let lettaSdkVersion = 'unknown';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  lettaSdkVersion = require('@letta-ai/letta-client/version').VERSION || 'unknown';
} catch {
  lettaSdkVersion = 'unknown';
}

/**
 * Splits Letta method arguments into the request body and, for agent-scoped
 * resources, the leading agent id. A leading string on a top-level resource is
 * that resource's own id, so it is never treated as an agent id.
 */
function resolveArgs(args: any[], agentScoped: boolean): { body: any; agentId?: string } {
  const agentId = agentScoped && typeof args[0] === 'string' ? args[0] : undefined;
  const body = args.find((arg) => arg && typeof arg === 'object' && !Array.isArray(arg));
  return { body, agentId };
}

function isAsyncIterable(value: any): boolean {
  return value != null && typeof value[Symbol.asyncIterator] === 'function';
}

/**
 * Instrumentation for the Letta agent platform (`@letta-ai/letta-client`). Each
 * patched resource method becomes one CLIENT span whose name and operation type
 * mirror the Python reference (sdk/python/src/openlit/instrumentation/letta): the
 * method suffix drives the operation type via OPERATION_TYPE_MAP, and chat
 * (message) operations stream their response through a traced async iterator.
 */
class LettaWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_LETTA;

  /**
   * Wraps a Letta resource method. `endpoint` is the Python-style endpoint id
   * (e.g. `letta.create`, `letta.create_message`) that drives the operation type
   * and span name.
   */
  static _patchOperation(
    tracer: Tracer,
    endpoint: string,
    agentScoped: boolean,
    version?: string
  ): any {
    const sdkVersion = version || lettaSdkVersion;
    const operationType = getOperationType(endpoint);

    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        if (isTracingSuppressed(context.active())) {
          return originalMethod.apply(this, args);
        }

        const { body, agentId } = resolveArgs(args, agentScoped);
        const spanBody =
          agentId && (!body || body.agent_id == null) ? { ...(body || {}), agent_id: agentId } : body;
        const spanName = getSpanName(operationType, endpoint, this, spanBody);

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operationType,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: LettaWrapper.aiSystem,
          },
        });
        const startTime = Date.now();

        if (operationType === SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT) {
          return LettaWrapper._handleChat(
            originalMethod,
            this,
            args,
            span,
            startTime,
            body,
            operationType,
            sdkVersion,
            agentId
          );
        }

        return LettaWrapper._handleOperation(
          originalMethod,
          this,
          args,
          span,
          startTime,
          body,
          operationType,
          sdkVersion,
          agentId
        );
      };
    };
  }

  /**
   * Non-chat operations return the SDK's own promise untouched. `list` yields a
   * PagePromise whose async iterator drives auto-pagination, so flattening it here
   * would break paging; the span is finalized from a completion callback instead.
   */
  private static _handleOperation(
    originalMethod: (...args: any[]) => any,
    instance: any,
    args: any[],
    span: Span,
    startTime: number,
    body: any,
    operationType: string,
    sdkVersion: string,
    agentId?: string
  ): any {
    return context.with(trace.setSpan(context.active(), span), () => {
      let result: any;
      try {
        result = originalMethod.apply(instance, args);
      } catch (e: any) {
        LettaWrapper._finalizeError(span, e, body, operationType, instance, startTime, sdkVersion, agentId);
        throw e;
      }

      Promise.resolve(result).then(
        (response) => {
          processLettaResponse(
            span,
            response,
            body,
            operationType,
            instance,
            (Date.now() - startTime) / 1000,
            sdkVersion,
            agentId
          );
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
        },
        (e) => {
          LettaWrapper._finalizeError(span, e, body, operationType, instance, startTime, sdkVersion, agentId);
        }
      );

      return result;
    });
  }

  /**
   * Chat (message) operations may resolve to a streaming iterator. The resolved
   * value is awaited so a stream can be wrapped in a traced async iterator; a
   * non-streaming response is processed inline.
   */
  private static async _handleChat(
    originalMethod: (...args: any[]) => any,
    instance: any,
    args: any[],
    span: Span,
    startTime: number,
    body: any,
    operationType: string,
    sdkVersion: string,
    agentId?: string
  ): Promise<any> {
    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const resolved = await originalMethod.apply(instance, args);

        if (isAsyncIterable(resolved)) {
          return LettaWrapper._traceStream(
            resolved,
            span,
            startTime,
            body,
            operationType,
            instance,
            sdkVersion,
            agentId
          );
        }

        processLettaResponse(
          span,
          resolved,
          body,
          operationType,
          instance,
          (Date.now() - startTime) / 1000,
          sdkVersion,
          agentId
        );
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return resolved;
      } catch (e: any) {
        LettaWrapper._finalizeError(span, e, body, operationType, instance, startTime, sdkVersion, agentId);
        throw e;
      }
    });
  }

  /**
   * Wraps a Letta message stream so chunks flow through untouched while the span
   * accumulates chunk count, TTFT, and the collected messages. Mirrors
   * TracedLettaStream in the Python reference.
   */
  private static _traceStream(
    stream: any,
    span: Span,
    startTime: number,
    body: any,
    operationType: string,
    instance: any,
    sdkVersion: string,
    agentId?: string
  ): Promise<any> {
    async function* traced() {
      let chunkCount = 0;
      let ttft = 0;
      const messages: any[] = [];

      try {
        for await (const chunk of stream) {
          chunkCount += 1;
          if (chunkCount === 1) {
            ttft = (Date.now() - startTime) / 1000;
          }
          messages.push(chunk);
          if (span.isRecording()) {
            span.setAttribute(SemanticConvention.GEN_AI_STREAMING_CHUNK_COUNT, chunkCount);
            if (ttft > 0) span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
          }
          yield chunk;
        }

        const synthetic: any = { messages };
        for (const msg of messages) {
          if (msg?.message_type === 'usage_statistics') {
            synthetic.usage = msg;
            break;
          }
        }

        processLettaResponse(
          span,
          synthetic,
          body,
          operationType,
          instance,
          (Date.now() - startTime) / 1000,
          sdkVersion,
          agentId
        );
        span.setAttribute(SemanticConvention.GEN_AI_STREAMING_CHUNK_COUNT, chunkCount);
        span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
        span.setAttribute(SemanticConvention.GEN_AI_STREAMING_RESPONSE_COUNT, messages.length);
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (e: any) {
        OpenLitHelper.handleException(span, e);
        throw e;
      } finally {
        span.end();
      }
    }

    return OpenLitHelper.createStreamProxy(stream, traced());
  }

  private static _finalizeError(
    span: Span,
    error: any,
    body: any,
    operationType: string,
    instance: any,
    startTime: number,
    sdkVersion: string,
    agentId?: string
  ): void {
    try {
      processLettaResponse(
        span,
        undefined,
        body,
        operationType,
        instance,
        (Date.now() - startTime) / 1000,
        sdkVersion,
        agentId
      );
    } catch {
      /* best-effort attributes on the error path */
    }
    OpenLitHelper.handleException(span, error);
    span.end();
  }
}

export default LettaWrapper;
