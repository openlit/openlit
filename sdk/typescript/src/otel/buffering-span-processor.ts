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

type Failure = 'retry' | 'split' | 'drop';

/**
 * What a failed export means for its spans.
 * - `retry`: the collector could not be reached, timed out or asked for a retry,
 *   so the spans go back to the buffer. A fetch that throws always lands here:
 *   the transport reports it as "Fetch request errored", with the real cause,
 *   such as a refused connection or an abort, on `error.cause`.
 * - `split`: a 400 or 413 may come from one span, so the batch is split to find it.
 * - `drop`: any other refusal, such as a 401, 403 or 404, applies to every span
 *   alike, so splitting would only repeat it.
 */
function classify(result: ExportResult): Failure {
  const message = result.error?.message ?? '';
  const status = /non-retryable status (\d{3})/i.exec(message);
  if (status) return status[1] === '400' || status[1] === '413' ? 'split' : 'drop';
  if (/retryable status|Concurrent export limit|network|fetch failed|timed? ?out|Fetch request errored/i.test(message)) {
    return 'retry';
  }
  return 'split';
}

/**
 * Holds spans until `forceFlush()`. Isolates are frozen between requests, so a
 * timer as in `BatchSpanProcessor` cannot be relied on to fire, and in Workers an
 * export must run inside the request that awaits it. Each flush therefore takes
 * its own batch and shares no promise with any other flush.
 *
 * The buffer is bounded: when full, the oldest spans go first, and the count is
 * kept in `droppedSpans`. Spans that may succeed later return to the buffer. A
 * batch the collector rejects as bad input is split to find the spans at fault,
 * so one bad span costs only itself and cannot block everything behind it.
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
      const kept = await this.deliver(batch);
      if (kept.length > 0) {
        diag.warn(`OpenLIT: span export failed, keeping ${kept.length} spans for the next flush`);
        this.buffer.unshift(...kept);
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

  /**
   * Returns the spans worth another try. Spans that were stored, or that failed
   * for good, are not returned, so a retry never sends a span twice.
   */
  private async deliver(batch: ReadableSpan[]): Promise<ReadableSpan[]> {
    const result = await this.send(batch);
    if (result.code === ExportResultCode.SUCCESS) return [];
    const failure = classify(result);
    if (failure === 'retry') return batch;
    if (failure === 'drop' || batch.length === 1) {
      this.droppedSpans += batch.length;
      const what = batch.length === 1 ? `span "${batch[0].name}" was` : `${batch.length} spans were`;
      diag.warn(`OpenLIT: ${what} rejected and dropped: ${result.error?.message}`);
      return [];
    }
    const middle = batch.length >>> 1;
    const first = await this.deliver(batch.slice(0, middle));
    // Once the collector stops answering, the rest of the batch waits for the next flush.
    if (first.length > 0) return [...first, ...batch.slice(middle)];
    return this.deliver(batch.slice(middle));
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
