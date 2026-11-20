import {
  Attributes,
  Context,
  HrTime,
  SpanContext,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  context,
  diag,
  defaultTextMapGetter,
  defaultTextMapSetter,
  isValidSpanId,
  isValidTraceId,
  trace,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { sha1Hex } from './platform';
import Tracing from './otel/tracing';

const propagator = new W3CTraceContextPropagator();

export type RunTraceContext = {
  traceId: string;
  spanId: string;
};

export type RecordSpanOptions = RunTraceContext & {
  name: string;
  /** Milliseconds since the epoch, a `Date`, or an ISO 8601 string. */
  start: number | Date | string;
  end: number | Date | string;
  /** Parent span ID. Leave out for the root span of a run. */
  parentSpanId?: string;
  kind?: SpanKind;
  attributes?: Attributes;
  error?: string;
};

function nonZeroHex(hash: string, length: number): string {
  const id = hash.slice(0, length);
  return /^0+$/.test(id) ? `${'0'.repeat(length - 1)}1` : id;
}

/**
 * Stable trace and root span IDs for a run key. Every invocation that handles
 * the same run derives the same IDs, so its spans join one trace. Same idea as
 * `cli/internal/otlp/tracecontext.go`, though the IDs differ from the CLI's: the
 * two never need to match.
 */
export function traceContextFrom(runId: string): RunTraceContext {
  return {
    traceId: nonZeroHex(sha1Hex(`openlit.trace|${runId}`), 32),
    spanId: nonZeroHex(sha1Hex(`openlit.trace|${runId}|root`), 16),
  };
}

function asSpanContext(parent: RunTraceContext | SpanContext): SpanContext {
  return {
    traceId: parent.traceId,
    spanId: parent.spanId,
    traceFlags: (parent as SpanContext).traceFlags ?? TraceFlags.SAMPLED,
    isRemote: true,
  };
}

/** Run `fn` with `parent` as the active parent, from `traceContextFrom()` or `extract()`. */
export function withParent<T>(
  parent: RunTraceContext | SpanContext | Context | undefined,
  fn: () => T
): T {
  if (!parent) return fn();
  const parentContext =
    'traceId' in parent
      ? trace.setSpanContext(context.active(), asSpanContext(parent))
      : (parent as Context);
  return context.with(parentContext, fn);
}

/** The `traceparent` header for the active span, or undefined when there is none. */
export function inject(): string | undefined {
  const carrier: Record<string, string> = {};
  propagator.inject(context.active(), carrier, defaultTextMapSetter);
  return carrier.traceparent;
}

const headerGetter = {
  get: (carrier: any, key: string) =>
    typeof carrier?.get === 'function' ? carrier.get(key) ?? undefined : defaultTextMapGetter.get(carrier, key),
  keys: (carrier: any) =>
    typeof carrier?.keys === 'function' ? Array.from(carrier.keys() as Iterable<string>) : defaultTextMapGetter.keys(carrier),
};

/** Read trace context from a `Headers` object or a plain header map. */
export function extract(headers: unknown): Context {
  return propagator.extract(context.active(), headers, headerGetter);
}

function toMillis(value: number | Date | string): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === 'string' ? Date.parse(value) : value;
}

function toHrTime(millis: number): HrTime {
  return [Math.floor(millis / 1000), Math.round((millis % 1000) * 1e6)];
}

/**
 * Write a finished span with chosen IDs, such as a run's root span once the run
 * ends. The tracer API cannot set a span ID, so the span goes straight to the
 * span processors. They exist only on a provider OpenLIT created; with an
 * application's own provider this logs a warning and writes nothing.
 */
export function recordSpan(options: RecordSpanOptions): void {
  const processors = Tracing.spanProcessors;
  if (processors.length === 0) {
    diag.warn('OpenLIT: recordSpan needs the tracer provider OpenLIT creates in init()');
    return;
  }

  const { traceId, spanId, parentSpanId, name, start, end, kind, attributes, error } = options;
  const startMillis = toMillis(start);
  const endMillis = Math.max(toMillis(end), startMillis);
  // One bad span would otherwise fail the export of every span batched with it.
  if (
    !isValidTraceId(traceId) ||
    !isValidSpanId(spanId) ||
    (parentSpanId !== undefined && !isValidSpanId(parentSpanId)) ||
    !Number.isFinite(startMillis) ||
    !Number.isFinite(endMillis)
  ) {
    diag.warn(`OpenLIT: recordSpan ignored "${name}": invalid IDs or times`);
    return;
  }

  const startTime = toHrTime(startMillis);
  const endTime = toHrTime(endMillis);
  const span = {
    name,
    kind: kind ?? SpanKind.INTERNAL,
    spanContext: () => ({ traceId, spanId, traceFlags: TraceFlags.SAMPLED }),
    parentSpanContext: parentSpanId
      ? { traceId, spanId: parentSpanId, traceFlags: TraceFlags.SAMPLED, isRemote: true }
      : undefined,
    startTime,
    endTime,
    duration: toHrTime(endMillis - startMillis),
    status: error ? { code: SpanStatusCode.ERROR, message: error } : { code: SpanStatusCode.OK },
    attributes: attributes ?? {},
    links: [],
    events: [],
    ended: true,
    resource: Tracing.resource,
    instrumentationScope: { name: 'openlit' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
  for (const processor of processors) processor.onEnd(span as any);
}
