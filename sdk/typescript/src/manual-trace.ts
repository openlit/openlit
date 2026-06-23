import { SpanKind, SpanStatusCode, context, trace as otelTrace } from '@opentelemetry/api';
import OpenlitConfig from './config';
import SemanticConvention from './semantic-convention';

function getTracer() {
  const provider = OpenlitConfig.tracer as any;
  return provider?.getTracer?.('openlit') ?? otelTrace.getTracer('openlit');
}

function attachAppAttrs(span: any): void {
  span.setAttribute(SemanticConvention.GEN_AI_APPLICATION_NAME, OpenlitConfig.applicationName ?? 'default');
  span.setAttribute(SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment ?? 'default');
}

/** Handle returned by startTrace() for imperative span control. */
export class TracedSpan {
  private readonly _span: any;

  constructor(span: any) {
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

  /** End the span. Always call this — ideally in a finally block. */
  end(): void {
    this._span.end();
  }
}

/**
 * Start a named CLIENT span and return a TracedSpan handle.
 * You are responsible for calling handle.end() (use a try/finally block).
 * For automatic span ending, prefer openlit.trace(name, fn) instead.
 *
 * @example
 *   const span = openlit.startTrace('my-operation');
 *   try {
 *     const result = await doWork();
 *     span.setResult(String(result));
 *   } finally {
 *     span.end();
 *   }
 */
export function startTrace(name: string): TracedSpan {
  const rawSpan = getTracer().startSpan(name, { kind: SpanKind.CLIENT });
  attachAppAttrs(rawSpan);
  return new TracedSpan(rawSpan);
}

/**
 * Wrap a function call in a CLIENT span that ends automatically.
 * Child spans (e.g., LLM calls) created inside fn nest correctly
 * under this span via OTel context propagation.
 *
 * @example
 *   const answer = await openlit.trace('my-chain', async (span) => {
 *     const result = await chain.invoke({ question });
 *     span.setResult(result.content);
 *     return result;
 *   });
 */
export function trace<T>(name: string, fn: (span: TracedSpan) => T | Promise<T>): T | Promise<T> {
  const rawSpan = getTracer().startSpan(name, { kind: SpanKind.CLIENT });
  attachAppAttrs(rawSpan);
  const ctx = otelTrace.setSpan(context.active(), rawSpan);
  const handle = new TracedSpan(rawSpan);

  let result: T | Promise<T>;
  try {
    result = context.with(ctx, () => fn(handle));
  } catch (err: any) {
    rawSpan.recordException(err);
    rawSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
    rawSpan.end();
    throw err;
  }

  if (result && typeof (result as any).then === 'function') {
    return result.then(
      (val) => { rawSpan.setStatus({ code: SpanStatusCode.OK }); rawSpan.end(); return val; },
      (err) => { rawSpan.recordException(err); rawSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) }); rawSpan.end(); throw err; }
    );
  }

  rawSpan.setStatus({ code: SpanStatusCode.OK });
  rawSpan.end();
  return result;
}
