import {
  Span,
  SpanKind,
  SpanStatusCode,
  trace as otelTrace,
} from '@opentelemetry/api';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import SemanticConvention from './semantic-convention';
import OpenlitConfig from './config';

/**
 * Manual tracing helpers for the OpenLIT TypeScript SDK.
 *
 * These mirror the Python SDK's `openlit.trace` decorator and
 * `openlit.start_trace()` context manager, giving TypeScript users a way to
 * manually create spans around custom business logic, multi-step chains, and
 * non-instrumented code. Any auto-instrumented LLM/vector-DB span created
 * inside the wrapped function is automatically nested under the manual span
 * (they share one trace ID) because the manual span is set as the active
 * OpenTelemetry context.
 */

const TRACER_NAME = 'openlit';

function getTracer() {
  return otelTrace.getTracer(TRACER_NAME);
}

/**
 * A thin wrapper around an OpenTelemetry {@link Span} that provides ergonomic
 * helpers for recording a manual trace's result and metadata.
 *
 * Mirrors Python's `TracedSpan`.
 */
export class TracedSpan {
  private readonly _span: Span;

  constructor(span: Span) {
    this._span = span;
  }

  /**
   * The underlying OpenTelemetry span, exposed for advanced use cases
   * (e.g. adding events or links directly).
   */
  get span(): Span {
    return this._span;
  }

  /**
   * Record the final result of the trace on `gen_ai.output.messages`.
   * Mirrors Python's `TracedSpan.set_result()`.
   */
  setResult(result: unknown): this {
    const value =
      typeof result === 'string' ? result : JSON.stringify(result ?? '');
    this._span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, value);
    return this;
  }

  /**
   * Attach arbitrary custom attributes to the span.
   * Mirrors Python's `TracedSpan.set_metadata()`.
   */
  setMetadata(metadata: Record<string, any>): this {
    if (metadata) {
      this._span.setAttributes(metadata);
    }
    return this;
  }

  /**
   * End the underlying span. Only required when the span was created with
   * {@link startActiveSpan}; {@link startTrace} ends the span automatically.
   */
  end(): void {
    this._span.end();
  }
}

function stampCommonAttributes(span: Span): void {
  try {
    if (OpenlitConfig.applicationName) {
      span.setAttribute(ATTR_SERVICE_NAME, OpenlitConfig.applicationName);
    }
    if (OpenlitConfig.environment) {
      span.setAttribute(
        SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT,
        OpenlitConfig.environment
      );
    }
  } catch {
    // Stamping common attributes must never break the wrapped call.
  }
}

/**
 * Run `fn` inside a new manual span named `name`, returning whatever `fn`
 * returns. The span is made the active context for the duration of `fn`, so
 * any auto-instrumented spans created within nest correctly under it and share
 * one trace ID. The span is ended automatically — including on error, in which
 * case the exception is recorded and re-thrown.
 *
 * This is the TypeScript analogue of Python's `openlit.start_trace()` context
 * manager, adapted to a callback because JavaScript has no `with` statement.
 *
 * @example
 *   const text = await Openlit.startTrace('Guess One-liner', async (trace) => {
 *     const completion = await client.chat.completions.create({ ... });
 *     const out = completion.choices[0].message.content;
 *     trace.setResult(out);
 *     return out;
 *   });
 */
export function startTrace<T>(
  name: string,
  fn: (trace: TracedSpan) => T | Promise<T>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(
    name,
    { kind: SpanKind.CLIENT },
    async (span: Span) => {
      const traced = new TracedSpan(span);
      stampCommonAttributes(span);
      try {
        const result = await fn(traced);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (e: any) {
        span.recordException(e);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: e?.message ?? String(e),
        });
        throw e;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Start a manual span and return a {@link TracedSpan} that you must `end()`
 * yourself. Unlike {@link startTrace}, this does **not** make the span the
 * active context, so it is best for cases where you cannot wrap your code in a
 * callback. Prefer {@link startTrace} when possible so that child spans nest
 * automatically.
 *
 * @example
 *   const trace = Openlit.startActiveSpan('my-step');
 *   try {
 *     // ... your code ...
 *     trace.setResult('done');
 *   } finally {
 *     trace.end();
 *   }
 */
export function startActiveSpan(name: string): TracedSpan {
  const span = getTracer().startSpan(name, { kind: SpanKind.CLIENT });
  stampCommonAttributes(span);
  return new TracedSpan(span);
}

/**
 * Method decorator that wraps the decorated method in a manual span named
 * after the method (or `name`, when provided). Mirrors Python's
 * `@openlit.trace` decorator: any auto-instrumented call inside the method is
 * grouped under a single trace. The return value is recorded on
 * `gen_ai.output.messages`.
 *
 * Works with both synchronous and async methods.
 *
 * @example
 *   class Movies {
 *     @trace()
 *     async generateOneLiner() {
 *       return (await client.chat.completions.create({ ... }))
 *         .choices[0].message.content;
 *     }
 *   }
 */
export function trace(name?: string) {
  return function (
    _target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const original = descriptor.value;
    if (typeof original !== 'function') {
      throw new TypeError(
        '@trace can only be applied to methods, got ' + typeof original
      );
    }
    const spanName = name ?? String(propertyKey);

    descriptor.value = function (this: any, ...args: any[]) {
      return startTrace(spanName, async (traced) => {
        const response = await original.apply(this, args);
        try {
          traced.setResult(response ?? '');
          traced.span.setAttribute('function.args', JSON.stringify(args));
        } catch {
          // Recording the result/args must never break the wrapped call.
        }
        return response;
      });
    };

    return descriptor;
  };
}
