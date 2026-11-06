import { Context, TraceFlags, diag } from '@opentelemetry/api';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { ReadableSpan, Span, SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base';

const MAX_BUFFERED_SPANS = 2048;
const MAX_EXPORT_BATCH = 512;
const MAX_BATCH_BYTES = 3 * 1024 * 1024;

function approximateSize(span: ReadableSpan): number {
  let size = 256;
  for (const value of Object.values(span.attributes ?? {})) {
    size += typeof value === 'string' ? value.length : 16;
  }
  return size;
}

/**
 * Only these are worth trying again in the next flush. The OTLP exporter marks
 * them with this message once its own retries run out, and a local limit or a
 * network failure clears by itself. Anything else, such as a 400 or a span that
 * cannot be serialised, would fail the same way on every flush.
 */
function isRetryable(result: ExportResult): boolean {
  const message = result.error?.message ?? '';
  return (
    /retryable status|Concurrent export limit|network|fetch failed|timed? ?out/i.test(message) &&
    !/non-retryable/i.test(message)
  );
}

/**
 * Holds spans until `forceFlush()`. Isolates are frozen between requests, so a
 * timer as in `BatchSpanProcessor` cannot be relied on to fire, and in Workers an
 * export must run inside the request that awaits it. Each flush therefore takes
 * its own batch and shares no promise with any other flush.
 *
 * The buffer is bounded: when full, the oldest spans go first, and the count is
 * kept in `droppedSpans`. A batch that may succeed later returns to the buffer. A
 * batch rejected for good is split to find the spans at fault, so one bad span
 * costs only itself and cannot block everything behind it.
 */
export class BufferingSpanProcessor implements SpanProcessor {
  droppedSpans = 0;
  private buffer: ReadableSpan[] = [];
  private closed = false;

  constructor(
    private readonly getExporter: () => SpanExporter,
    private readonly maxBuffered = MAX_BUFFERED_SPANS
  ) {}

  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(span: ReadableSpan): void {
    if (this.closed || (span.spanContext().traceFlags & TraceFlags.SAMPLED) === 0) return;
    this.buffer.push(span);
    this.enforceLimit();
  }

  async forceFlush(): Promise<void> {
    const droppedBefore = this.droppedSpans;
    while (this.buffer.length > 0) {
      const batch = this.takeBatch();
      if (!(await this.deliver(batch))) {
        diag.warn(`OpenLIT: span export failed, keeping ${batch.length} spans for the next flush`);
        this.buffer.unshift(...batch);
        this.enforceLimit();
        break;
      }
    }
    const dropped = this.droppedSpans - droppedBefore;
    if (dropped > 0) diag.warn(`OpenLIT: dropped ${dropped} spans during this flush`);
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
    this.closed = true;
    await this.getExporter().shutdown();
  }

  private takeBatch(): ReadableSpan[] {
    let bytes = 0;
    let count = 0;
    while (count < this.buffer.length && count < MAX_EXPORT_BATCH) {
      bytes += approximateSize(this.buffer[count]);
      if (count > 0 && bytes > MAX_BATCH_BYTES) break;
      count++;
    }
    return this.buffer.splice(0, count);
  }

  /** False means the batch may succeed later. Permanent failures resolve true. */
  private async deliver(batch: ReadableSpan[]): Promise<boolean> {
    const result = await this.send(batch);
    if (result.code === ExportResultCode.SUCCESS) return true;
    if (isRetryable(result)) return false;
    if (batch.length === 1) {
      this.droppedSpans += 1;
      diag.warn(`OpenLIT: span "${batch[0].name}" was rejected and dropped: ${result.error?.message}`);
      return true;
    }
    const middle = batch.length >>> 1;
    const first = await this.deliver(batch.slice(0, middle));
    const second = await this.deliver(batch.slice(middle));
    return first && second;
  }

  private enforceLimit(): void {
    const excess = this.buffer.length - this.maxBuffered;
    if (excess <= 0) return;
    this.buffer.splice(0, excess);
    this.droppedSpans += excess;
  }

  private send(batch: ReadableSpan[]): Promise<ExportResult> {
    return new Promise((resolve) => {
      try {
        this.getExporter().export(batch, resolve);
      } catch (error) {
        resolve({ code: ExportResultCode.FAILED, error: error as Error });
      }
    });
  }
}
