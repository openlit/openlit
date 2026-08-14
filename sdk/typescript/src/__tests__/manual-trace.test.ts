import { trace as otelTrace, SpanStatusCode } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import OpenlitConfig from '../config';
import SemanticConvention from '../semantic-convention';
import { startTrace, trace } from '../manual-trace';

describe('manual-trace', () => {
  let exporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    OpenlitConfig.updateConfig({
      tracer: provider as any,
      applicationName: 'TestApp',
      environment: 'TestEnv',
    });
  });

  beforeEach(() => {
    exporter.reset();
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  it('startTrace nests child spans under the manual span', async () => {
    await startTrace('parent-operation', async () => {
      await otelTrace.getTracer('openlit').startActiveSpan('child-llm', (child) => {
        child.setAttribute('gen_ai.system', 'openai');
        child.end();
      });
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    const parentSpan = spans.find((s) => s.name === 'parent-operation');
    const childSpan = spans.find((s) => s.name === 'child-llm');
    expect(parentSpan).toBeDefined();
    expect(childSpan).toBeDefined();
    expect(childSpan!.parentSpanContext?.spanId).toBe(parentSpan!.spanContext().spanId);
    expect(parentSpan!.attributes[ATTR_SERVICE_NAME]).toBe('TestApp');
    expect(parentSpan!.attributes[SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT]).toBe(
      'TestEnv'
    );
    expect(parentSpan!.status.code).toBe(SpanStatusCode.OK);
  });

  it('startTrace nests child spans across await boundaries', async () => {
    await startTrace('async-parent', async () => {
      await Promise.resolve();
      otelTrace.getTracer('openlit').startActiveSpan('async-child', (child) => {
        child.end();
      });
    });

    const spans = exporter.getFinishedSpans();
    const parentSpan = spans.find((s) => s.name === 'async-parent');
    const childSpan = spans.find((s) => s.name === 'async-child');
    expect(childSpan!.parentSpanContext?.spanId).toBe(parentSpan!.spanContext().spanId);
  });

  it('startTrace setResult and setMetadata stamp attributes', async () => {
    await startTrace('metadata-test', async (span) => {
      span.setResult('hello');
      span.setMetadata({ 'custom.key': 'value', count: 3 });
    });

    const finished = exporter.getFinishedSpans()[0];
    expect(finished.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toBe('hello');
    expect(finished.attributes['custom.key']).toBe('value');
    expect(finished.attributes.count).toBe(3);
  });

  it('trace() ends span on sync success and nests children', () => {
    const result = trace('sync-chain', (span) => {
      otelTrace.getTracer('openlit').startActiveSpan('sync-child', (child) => {
        child.end();
      });
      span.setResult('done');
      return 42;
    });

    expect(result).toBe(42);
    const spans = exporter.getFinishedSpans();
    const parentSpan = spans.find((s) => s.name === 'sync-chain');
    const childSpan = spans.find((s) => s.name === 'sync-child');
    expect(childSpan!.parentSpanContext?.spanId).toBe(parentSpan!.spanContext().spanId);
    expect(parentSpan!.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toBe('done');
    expect(parentSpan!.status.code).toBe(SpanStatusCode.OK);
  });

  it('trace() ends span on async success', async () => {
    const result = await trace('async-chain', async (span) => {
      await Promise.resolve();
      span.setResult('async-done');
      return 'ok';
    });

    expect(result).toBe('ok');
    const parentSpan = exporter.getFinishedSpans().find((s) => s.name === 'async-chain');
    expect(parentSpan!.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toBe('async-done');
    expect(parentSpan!.status.code).toBe(SpanStatusCode.OK);
  });

  it('trace() records errors and sets ERROR status', () => {
    expect(() =>
      trace('failing-sync', () => {
        throw new Error('boom');
      })
    ).toThrow('boom');

    const parentSpan = exporter.getFinishedSpans().find((s) => s.name === 'failing-sync');
    expect(parentSpan!.status.code).toBe(SpanStatusCode.ERROR);
    expect(parentSpan!.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('trace() records async rejection', async () => {
    await expect(
      trace('failing-async', async () => {
        await Promise.resolve();
        throw new Error('async-boom');
      })
    ).rejects.toThrow('async-boom');

    const parentSpan = exporter.getFinishedSpans().find((s) => s.name === 'failing-async');
    expect(parentSpan!.status.code).toBe(SpanStatusCode.ERROR);
  });
});
