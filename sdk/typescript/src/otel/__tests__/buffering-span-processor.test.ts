import { TraceFlags } from '@opentelemetry/api';
import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { BufferingSpanProcessor } from '../buffering-span-processor';

const span = (sampled = true, attributes: Record<string, unknown> = {}) =>
  ({
    attributes,
    spanContext: () => ({ traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE }),
  }) as unknown as ReadableSpan;

const RETRYABLE = { code: ExportResultCode.FAILED, error: new Error('Export failed with retryable status') };
const REJECTED = { code: ExportResultCode.FAILED, error: new Error('Fetch request failed with non-retryable status 400') };

function exporter(results: (ExportResult | ((spans: ReadableSpan[]) => ExportResult))[] = []) {
  const batches: ReadableSpan[][] = [];
  const instance: SpanExporter = {
    export(spans, done: (result: ExportResult) => void) {
      batches.push(spans);
      const next = results.length > 1 ? results.shift() : results[0];
      const result = typeof next === 'function' ? next(spans) : next;
      done(result ?? { code: ExportResultCode.SUCCESS });
    },
    shutdown: jest.fn(async () => {}),
  };
  return { instance, batches };
}

describe('BufferingSpanProcessor', () => {
  it('sends nothing until forceFlush', async () => {
    const { instance, batches } = exporter();
    const processor = new BufferingSpanProcessor(() => instance);

    processor.onEnd(span());
    expect(batches).toHaveLength(0);

    await processor.forceFlush();
    expect(batches).toEqual([[expect.anything()]]);
  });

  it('skips unsampled spans', async () => {
    const { instance, batches } = exporter();
    const processor = new BufferingSpanProcessor(() => instance);

    processor.onEnd(span(false));
    await processor.forceFlush();

    expect(batches).toHaveLength(0);
  });

  it('splits large buffers into batches', async () => {
    const { instance, batches } = exporter();
    const processor = new BufferingSpanProcessor(() => instance);

    for (let i = 0; i < 1025; i++) processor.onEnd(span());
    await processor.forceFlush();

    expect(batches.map((batch) => batch.length)).toEqual([512, 512, 1]);
  });

  it('keeps a failed batch for the next flush, in order', async () => {
    const { instance, batches } = exporter([RETRYABLE, { code: ExportResultCode.SUCCESS }]);
    const processor = new BufferingSpanProcessor(() => instance);
    const first = span();

    processor.onEnd(first);
    await processor.forceFlush();
    processor.onEnd(span());
    await processor.forceFlush();

    expect(batches).toHaveLength(2);
    expect(batches[1]).toHaveLength(2);
    expect(batches[1][0]).toBe(first);
  });

  it('isolates a span the collector rejects, and delivers the rest', async () => {
    const poison = span();
    const delivered: ReadableSpan[] = [];
    const { instance } = exporter([
      (spans) => {
        if (spans.includes(poison)) return REJECTED;
        delivered.push(...spans);
        return { code: ExportResultCode.SUCCESS };
      },
    ]);
    const processor = new BufferingSpanProcessor(() => instance);
    const good = [span(), span(), span(), span()];

    [good[0], good[1], poison, good[2], good[3]].forEach((s) => processor.onEnd(s));
    await processor.forceFlush();

    expect(delivered.sort()).toEqual(good.sort());
    expect(processor.droppedSpans).toBe(1);
  });

  it('a permanent failure cannot block later spans', async () => {
    const { instance, batches } = exporter([REJECTED, { code: ExportResultCode.SUCCESS }]);
    const processor = new BufferingSpanProcessor(() => instance);

    processor.onEnd(span());
    await processor.forceFlush();
    processor.onEnd(span());
    await processor.forceFlush();

    expect(batches).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
    expect(processor.droppedSpans).toBe(1);
  });

  it('caps a batch by size as well as count', async () => {
    const { instance, batches } = exporter();
    const processor = new BufferingSpanProcessor(() => instance);
    const large = 'x'.repeat(2 * 1024 * 1024);

    for (let i = 0; i < 3; i++) processor.onEnd(span(true, { content: large }));
    await processor.forceFlush();

    expect(batches.map((batch) => batch.length)).toEqual([1, 1, 1]);
  });

  it('ignores spans after shutdown', async () => {
    const { instance, batches } = exporter();
    const processor = new BufferingSpanProcessor(() => instance);

    await processor.shutdown();
    processor.onEnd(span());
    await processor.forceFlush();

    expect(batches).toHaveLength(0);
  });

  it('drops the oldest spans past the limit and counts them', async () => {
    const { instance, batches } = exporter();
    const processor = new BufferingSpanProcessor(() => instance, 2);
    const kept = [span(), span()];

    processor.onEnd(span());
    kept.forEach((s) => processor.onEnd(s));
    await processor.forceFlush();

    expect(processor.droppedSpans).toBe(1);
    expect(batches[0]).toEqual(kept);
  });

  it('drops a batch the exporter cannot serialise rather than retrying it forever', async () => {
    const processor = new BufferingSpanProcessor(() => {
      throw new Error('bad config');
    });

    processor.onEnd(span());
    await expect(processor.forceFlush()).resolves.toBeUndefined();
    expect(processor.droppedSpans).toBe(1);
  });

  it('keeps spans when the collector cannot be reached or times out', async () => {
    // The fetch transport reports a refused connection or an abort this way.
    const unreachable = {
      code: ExportResultCode.FAILED,
      error: Object.assign(new Error('Fetch request errored'), { cause: new TypeError('fetch failed') }),
    };
    const { instance, batches } = exporter([unreachable, { code: ExportResultCode.SUCCESS }]);
    const processor = new BufferingSpanProcessor(() => instance);

    for (let i = 0; i < 8; i++) processor.onEnd(span());
    await processor.forceFlush();
    expect(batches).toHaveLength(1);
    expect(processor.droppedSpans).toBe(0);

    await processor.forceFlush();
    expect(batches[1]).toHaveLength(8);
  });

  it('drops a batch refused for the whole endpoint without splitting it', async () => {
    const unauthorized = {
      code: ExportResultCode.FAILED,
      error: new Error('Fetch request failed with non-retryable status 401'),
    };
    const { instance, batches } = exporter([unauthorized]);
    const processor = new BufferingSpanProcessor(() => instance);

    for (let i = 0; i < 64; i++) processor.onEnd(span());
    await processor.forceFlush();

    expect(batches).toHaveLength(1);
    expect(processor.droppedSpans).toBe(64);
  });

  it('never sends a span twice when the collector fails partway through a split', async () => {
    const sent: ReadableSpan[] = [];
    const { instance } = exporter([
      REJECTED,
      (spans) => (sent.push(...spans), { code: ExportResultCode.SUCCESS }),
      RETRYABLE,
      (spans) => (sent.push(...spans), { code: ExportResultCode.SUCCESS }),
    ]);
    const processor = new BufferingSpanProcessor(() => instance);
    const all = Array.from({ length: 8 }, () => span());

    for (const item of all) processor.onEnd(item);
    await processor.forceFlush();
    await processor.forceFlush();

    expect(new Set(sent).size).toBe(sent.length);
    expect(sent).toHaveLength(8);
  });

  it('flushes on shutdown and stops the exporter', async () => {
    const { instance, batches } = exporter();
    const processor = new BufferingSpanProcessor(() => instance);

    processor.onEnd(span());
    await processor.shutdown();

    expect(batches).toHaveLength(1);
    expect(instance.shutdown).toHaveBeenCalled();
  });
});
