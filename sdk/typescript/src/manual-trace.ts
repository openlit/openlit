import { Span, SpanKind, SpanStatusCode, trace as otelTrace } from '@opentelemetry/api';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from './config';
import SemanticConvention from './semantic-convention';

function getTracer() {
  const provider = OpenlitConfig.tracer as any;
  return provider?.getTracer?.('openlit') ?? otelTrace.getTracer('openlit');
}

function attachAppAttrs(span: Span): void {
  span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName ?? 'default');
  span.setAttribute(
    SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT,
    OpenlitConfig.environment ?? 'default'
  );
}

/**
 * Wrapper for an OpenTelemetry span with helpers to set result and metadata.
 * Mirrors Python's TracedSpan — the span lifecycle is managed by startTrace() /
 * trace(), so you do not call end() yourself (like Python's `with` block).
 */
export class TracedSpan {
  private readonly _span: Span;

  constructor(span: Span) {
    this._span = span;
  }

  /** Record the AI output or function return value on the span. */
  setResult(result: string): void {
    this._span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, result);
  }

  /** Stamp arbitrary key/value attributes onto the span. */
  setMetadata(metadata: Record<string, string | number | boolean>): void {
    this._span.setAttributes(metadata);
  }
}

function runInActiveSpan<T>(
  name: string,
  fn: (span: TracedSpan) => T | Promise<T>
): T | Promise<T> {
  return getTracer().startActiveSpan(
    name,
    { kind: SpanKind.CLIENT },
    (rawSpan: Span) => {
      attachAppAttrs(rawSpan);
      const handle = new TracedSpan(rawSpan);

      const endOk = () => {
        rawSpan.setStatus({ code: SpanStatusCode.OK });
        rawSpan.end();
      };

      const endError = (err: unknown): never => {
        rawSpan.recordException(err as Error);
        rawSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(err),
        });
        rawSpan.end();
        throw err;
      };

      try {
        const result = fn(handle);
        if (result !== null && typeof (result as any)?.then === 'function') {
          return (result as Promise<T>).then(
            (val) => {
              endOk();
              return val;
            },
            (err) => endError(err)
          );
        }
        endOk();
        return result;
      } catch (err) {
        return endError(err);
      }
    }
  );
}

/**
 * Start a named CLIENT span scoped to a callback — the TypeScript equivalent of
 * Python's `with start_trace(name) as span:`.
 *
 * The span is active for the duration of `fn`, so child LLM spans nest correctly.
 *
 * @example
 *   const answer = await openlit.startTrace('my-operation', async (span) => {
 *     const result = await doWork();
 *     span.setResult(String(result));
 *     return result;
 *   });
 */
export function startTrace<T>(
  name: string,
  fn: (span: TracedSpan) => T | Promise<T>
): T | Promise<T> {
  return runInActiveSpan(name, fn);
}

/**
 * Wrap a function call in a CLIENT span — the TypeScript equivalent of
 * Python's `@openlit.trace` decorator.
 *
 * @example
 *   const answer = await openlit.trace('my-chain', async (span) => {
 *     const result = await chain.invoke({ question });
 *     span.setResult(result.content);
 *     return result;
 *   });
 */
export function trace<T>(
  name: string,
  fn: (span: TracedSpan) => T | Promise<T>
): T | Promise<T> {
  return runInActiveSpan(name, fn);
}
