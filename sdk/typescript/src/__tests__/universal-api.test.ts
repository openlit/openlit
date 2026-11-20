import { SpanKind, context, trace as otelTrace } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { InMemorySpanExporter, ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import Anthropic from '@anthropic-ai/sdk';
import { codingAgentEnv } from '../coding-agent';
import OpenlitConfig from '../config';
import OpenlitAnthropicInstrumentation from '../instrumentation/anthropic';
import { GuardDeniedError } from '../guard/base';
import { guardClient, setupAutoGuards } from '../guard/integration';
import { PII } from '../guard/pii';
import { Pipeline } from '../guard/pipeline';
import { instrument } from '../instrument-client';
import { instrumentFetch } from '../instrumentation/fetch';
import Instrumentations from '../instrumentation';
import OpenLitHelper, { withTags, usingAttributes } from '../helpers';
import { llm } from '../llm-call';
import Tracing from '../otel/tracing';
import { createLambdaWrapper, createWorkerWrapper } from '../runtime-wrappers';
import { parseBool, parseOtlpHeaders } from '../otel/utils';
import VllmWrapper from '../instrumentation/vllm/wrapper';
import SemanticConvention from '../semantic-convention';
import { extract, inject, recordSpan, traceContextFrom, withParent } from '../trace-context';

const exporter = new InMemorySpanExporter();
const processor = new SimpleSpanProcessor(exporter);
const provider = new NodeTracerProvider({ spanProcessors: [processor] });
const spans = () => exporter.getFinishedSpans();

beforeAll(() => {
  provider.register();
  OpenlitConfig.updateConfig({
    applicationName: 'app',
    environment: 'test',
    tracer: provider,
    captureMessageContent: true,
  });
  OpenlitConfig.pricingInfo = { chat: { 'model-a': { promptPrice: 1, completionPrice: 2 } } } as any;
});

beforeEach(() => exporter.reset());

afterAll(async () => {
  await provider.shutdown();
  otelTrace.disable();
  context.disable();
});

describe('openlit.llm', () => {
  const options = { provider: 'custom', model: 'model-a', serverAddress: 'models.example', serverPort: 443 };

  it('gives one client span named like a patched call, with cost from pricing', async () => {
    const result = await llm(options, async (span) => {
      span.setInput('question');
      span.setUsage({ inputTokens: 1000, outputTokens: 500 });
      span.setOutput('answer');
      span.setResponse({ id: 'r1', finishReason: 'length' });
      return 'parsed';
    });

    expect(result).toBe('parsed');
    const [span] = spans();
    expect(span.name).toBe('chat model-a');
    expect(span.kind).toBe(SpanKind.CLIENT);
    expect(span.attributes[SemanticConvention.GEN_AI_USAGE_COST]).toBeCloseTo(2);
    expect(span.attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]).toEqual(['length']);
    expect(span.attributes[SemanticConvention.GEN_AI_RESPONSE_ID]).toBe('r1');
    expect(span.attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toContain('question');
    expect(span.attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toContain('answer');
  });

  it('honours captureMessageContent', async () => {
    OpenlitConfig.captureMessageContent = false;
    try {
      await llm(options, async (span) => {
        span.setInput('secret');
        span.setOutput('secret');
      });
    } finally {
      OpenlitConfig.captureMessageContent = true;
    }

    expect(JSON.stringify(spans()[0].attributes)).not.toContain('secret');
  });

  it('records errors and rethrows them', async () => {
    await expect(llm(options, async () => { throw new TypeError('bad'); })).rejects.toThrow('bad');

    expect(spans()[0].status.code).toBe(2);
    expect(spans()[0].attributes[SemanticConvention.ERROR_TYPE]).toBe('TypeError');
  });

  it('prices the model that answered, and takes an explicit cost', async () => {
    await llm({ ...options, model: 'unpriced' }, async (span) => {
      span.setResponse({ model: 'model-a' });
      span.setUsage({ inputTokens: 1000, outputTokens: 0 });
    });
    expect(spans()[0].attributes[SemanticConvention.GEN_AI_USAGE_COST]).toBeCloseTo(1);

    exporter.reset();
    await llm(options, async (span) => span.setUsage({ inputTokens: 1, outputTokens: 1, cost: 42 }));
    expect(spans()[0].attributes[SemanticConvention.GEN_AI_USAGE_COST]).toBe(42);
  });

  it('parents model spans under the active span', async () => {
    await provider.getTracer('t').startActiveSpan('parent', async (parent) => {
      await llm(options, async () => {});
      parent.end();
    });

    const child = spans().find((s) => s.name === 'chat model-a')!;
    expect(child.parentSpanContext?.spanId).toBe(spans().find((s) => s.name === 'parent')!.spanContext().spanId);
  });
});

describe('openlit.llm events', () => {
  it('emits the inference event a patched provider emits, unless events are off', async () => {
    const emit = jest.spyOn(OpenLitHelper, 'emitInferenceEvent').mockImplementation(() => {});
    try {
      await llm({ provider: 'custom', model: 'model-a' }, async () => {});
      expect(emit).toHaveBeenCalledTimes(1);

      OpenlitConfig.disableEvents = true;
      await llm({ provider: 'custom', model: 'model-a' }, async () => {});
      expect(emit).toHaveBeenCalledTimes(1);
    } finally {
      OpenlitConfig.disableEvents = false;
      emit.mockRestore();
    }
  });
});

describe('convention contract', () => {
  // Attributes only a patched provider can know from the raw request or response.
  const PROVIDER_ONLY = new Set<string>([
    SemanticConvention.GEN_AI_REQUEST_TOP_P,
    SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
  ]);

  it('openlit.llm carries the same keys and cost as a patched provider', async () => {
    const instrumentation = new OpenlitAnthropicInstrumentation();
    instrumentation.setTracerProvider(provider);
    const client = new Anthropic({
      apiKey: 'test',
      maxRetries: 0,
      fetch: async () =>
        Response.json({
          id: 'msg',
          type: 'message',
          role: 'assistant',
          model: 'model-a',
          content: [{ type: 'text', text: 'hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
    });
    instrumentation.patchClient(client);

    await client.messages.create({ model: 'model-a', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
    const patched: ReadableSpan = spans()[0];
    exporter.reset();

    await llm(
      { provider: 'anthropic', model: 'model-a', serverAddress: 'api.anthropic.com', serverPort: 443, maxTokens: 5 },
      async (span) => {
        span.setInput('hi');
        span.setUsage({ inputTokens: 100, outputTokens: 50 });
        span.setResponse({ id: 'msg' });
        span.setOutput('hi');
      }
    );
    const manual = spans()[0];

    const missing = Object.keys(patched.attributes).filter(
      (key) => !(key in manual.attributes) && !PROVIDER_ONLY.has(key)
    );
    expect(missing).toEqual([]);
    expect(manual.name).toBe(patched.name);
    expect(manual.kind).toBe(patched.kind);
    expect(manual.attributes[SemanticConvention.GEN_AI_USAGE_COST]).toBe(
      patched.attributes[SemanticConvention.GEN_AI_USAGE_COST]
    );
  });
});

describe('cross-invocation traces', () => {
  it('derives valid, stable and separate IDs from a run key', () => {
    const first = traceContextFrom('run-1');

    expect(first).toEqual(traceContextFrom('run-1'));
    expect(first.traceId).not.toBe(traceContextFrom('run-2').traceId);
    expect(first.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(first.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('withParent puts a span under the run root', async () => {
    const run = traceContextFrom('run-1');
    await withParent(run, () => provider.getTracer('t').startSpan('step').end());

    expect(spans()[0].spanContext().traceId).toBe(run.traceId);
    expect(spans()[0].parentSpanContext?.spanId).toBe(run.spanId);
  });

  it('inject and extract round-trip through Headers and plain maps', async () => {
    const run = traceContextFrom('run-1');
    const header = withParent(run, () => inject());
    expect(header).toBe(`00-${run.traceId}-${run.spanId}-01`);

    for (const carrier of [new Headers({ traceparent: header! }), { traceparent: header }]) {
      exporter.reset();
      withParent(extract(carrier), () => provider.getTracer('t').startSpan('remote').end());
      expect(spans()[0].spanContext().traceId).toBe(run.traceId);
      expect(spans()[0].parentSpanContext?.spanId).toBe(run.spanId);
    }
  });

  it('withParent runs the function when there is no parent', () => {
    expect(withParent(undefined, () => 'ran')).toBe('ran');
  });

  it('ignores a malformed traceparent', () => {
    withParent(extract({ traceparent: 'garbage' }), () => provider.getTracer('t').startSpan('fresh').end());

    expect(spans()[0].parentSpanContext).toBeUndefined();
  });

  describe('recordSpan', () => {
    beforeEach(() => {
      Tracing.resource = resourceFromAttributes({ 'service.name': 'app' });
    });

    afterEach(() => {
      Tracing.spanProcessors = [];
      Tracing.resource = undefined;
    });

    it('writes a finished span with the IDs it was given', () => {
      Tracing.spanProcessors = [processor];
      const run = traceContextFrom('run-1');

      recordSpan({ name: 'workflow run', ...run, start: 1_000, end: 3_500, attributes: { a: 1 } });

      const [span] = spans();
      expect(span.spanContext()).toMatchObject({ traceId: run.traceId, spanId: run.spanId });
      expect(span.parentSpanContext).toBeUndefined();
      expect(span.duration).toEqual([2, 500_000_000]);
      expect(span.status.code).toBe(1);
    });

    it.each([
      ['an unparseable start', { start: 'yesterday' }],
      ['a bad trace ID', { traceId: 'not-hex' }],
      ['a bad span ID', { spanId: 'xyz' }],
      ['a bad parent', { parentSpanId: 'xyz' }],
    ])('refuses %s instead of poisoning a batch', (_name, bad) => {
      Tracing.spanProcessors = [processor];
      recordSpan({ name: 'run', ...traceContextFrom('r'), start: 0, end: 1, ...bad });
      expect(spans()).toHaveLength(0);
    });

    it('takes ISO strings and clamps an end before the start', () => {
      Tracing.spanProcessors = [processor];
      recordSpan({ name: 'run', ...traceContextFrom('r'), start: '2026-01-01T00:00:10Z', end: '2026-01-01T00:00:00Z' });
      expect(spans()[0].duration).toEqual([0, 0]);
    });

    it('marks failed runs, and warns rather than throws without a processor', () => {
      Tracing.spanProcessors = [processor];
      recordSpan({ name: 'run', ...traceContextFrom('r'), start: 0, end: 1, error: 'boom' });
      expect(spans()[0].status).toEqual({ code: 2, message: 'boom' });

      exporter.reset();
      Tracing.spanProcessors = [];
      expect(() => recordSpan({ name: 'run', ...traceContextFrom('r'), start: 0, end: 1 })).not.toThrow();
      expect(spans()).toHaveLength(0);
    });
  });
});

describe('withTags', () => {
  const tagged = async () => {
    await llm({ provider: 'custom', model: 'model-a' }, async () => {});
    return spans()[0].attributes;
  };

  it('stamps purpose and route on model spans', async () => {
    const attributes = await withTags({ purpose: 'classification', route: 'gateway' }, tagged);

    expect(attributes[SemanticConvention.OPENLIT_REQUEST_PURPOSE]).toBe('classification');
    expect(attributes[SemanticConvention.OPENLIT_ROUTE]).toBe('gateway');
  });

  it('reaches a patched client call that the callback returns without awaiting', async () => {
    const instrumentation = new OpenlitAnthropicInstrumentation();
    instrumentation.setTracerProvider(provider);
    const client = new Anthropic({
      apiKey: 'test',
      maxRetries: 0,
      fetch: async () =>
        Response.json({
          id: 'msg',
          type: 'message',
          role: 'assistant',
          model: 'model-a',
          content: [{ type: 'text', text: 'hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    });
    (instrumentation as any).patchClient(client);

    await withTags({ purpose: 'lazy', route: 'api' }, () =>
      client.messages.create({ model: 'model-a', max_tokens: 5, messages: [{ role: 'user', content: 'x' }] })
    );

    const chat = spans().find((item) => item.attributes[SemanticConvention.GEN_AI_OPERATION] === 'chat');
    expect(chat?.attributes[SemanticConvention.OPENLIT_REQUEST_PURPOSE]).toBe('lazy');
    expect(chat?.attributes[SemanticConvention.OPENLIT_ROUTE]).toBe('api');
  });

  it('keeps attributes from an enclosing usingAttributes', async () => {
    const attributes = await usingAttributes({ team: 'ml' }, () => withTags({ purpose: 'x' }, tagged));

    expect(attributes.team).toBe('ml');
    expect(attributes[SemanticConvention.OPENLIT_REQUEST_PURPOSE]).toBe('x');
  });
});

describe('runtime wrappers', () => {
  const wrapWorker = (hooks: any, handler: any, configure?: any): any =>
    createWorkerWrapper(hooks)(handler, configure);
  const lifecycle = () => ({
    flush: jest.fn(async () => {}),
    applyRuntimeOptions: jest.fn(),
    ensurePricing: jest.fn(async () => {}),
  });
  const ctx = () => {
    const pending: Promise<unknown>[] = [];
    return { waitUntil: (promise: Promise<unknown>) => void pending.push(promise), pending };
  };
  const request = (headers?: HeadersInit) => new Request('https://app.example/path?secret=1', { method: 'POST', headers });

  it('withWorker traces the request without its query string and flushes in waitUntil', async () => {
    const hooks = lifecycle();
    const wrapped = wrapWorker(hooks, { fetch: async () => new Response('ok', { status: 201 }) });
    const context = ctx();

    const response = await wrapped.fetch(request(), {}, context);

    expect(response.status).toBe(201);
    expect(spans()[0].name).toBe('POST /path');
    expect(spans()[0].kind).toBe(SpanKind.SERVER);
    expect(JSON.stringify(spans()[0].attributes)).not.toContain('secret');
    expect(hooks.flush).toHaveBeenCalledTimes(1);
    expect(context.pending.length).toBeGreaterThanOrEqual(1);
  });

  describe('incoming traceparent', () => {
    const run = traceContextFrom('caller');
    const header = (flags: string) => ({ traceparent: `00-${run.traceId}-${run.spanId}-${flags}` });
    const handler = { fetch: async () => new Response('ok') };

    afterEach(() => {
      OpenlitConfig.trustIncomingTraceparent = false;
    });

    it('starts a new trace by default and keeps the caller as a link', async () => {
      await wrapWorker(lifecycle(), handler).fetch(request(header('01')), {}, ctx());

      const [span] = spans();
      expect(span.spanContext().traceId).not.toBe(run.traceId);
      expect(span.parentSpanContext).toBeUndefined();
      expect(span.links[0].context.traceId).toBe(run.traceId);
    });

    it('does not let an unsampled flag drop the request from telemetry', async () => {
      await wrapWorker(lifecycle(), handler).fetch(request(header('00')), {}, ctx());

      expect(spans()).toHaveLength(1);
    });

    it('continues the trace when trusted', async () => {
      OpenlitConfig.trustIncomingTraceparent = true;
      await wrapWorker(lifecycle(), handler).fetch(request(header('01')), {}, ctx());

      expect(spans()[0].spanContext().traceId).toBe(run.traceId);
      expect(spans()[0].parentSpanContext?.spanId).toBe(run.spanId);
    });
  });

  it('withWorker nests model spans under the request', async () => {
    const wrapped = wrapWorker(lifecycle(), {
      fetch: async () => {
        await llm({ provider: 'custom', model: 'model-a' }, async () => {});
        return new Response('ok');
      },
    });

    await wrapped.fetch(request(), {}, ctx());

    const server = spans().find((s) => s.kind === SpanKind.SERVER)!;
    const model = spans().find((s) => s.kind === SpanKind.CLIENT)!;
    expect(model.parentSpanContext?.spanId).toBe(server.spanContext().spanId);
  });

  it('withWorker reads bindings once, and configure wins over them', async () => {
    const hooks = lifecycle();
    const wrapped = wrapWorker(hooks, { fetch: async () => new Response('ok') }, (env: any) => ({
      applicationName: env.NAME,
    }));
    const env = {
      NAME: 'configured',
      OTEL_SERVICE_NAME: 'bound',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Basic%20a=b,x=1',
      OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'false',
    };

    await wrapped.fetch(request(), env, ctx());
    await wrapped.fetch(request(), env, ctx());

    expect(hooks.applyRuntimeOptions).toHaveBeenCalledTimes(1);
    expect(hooks.applyRuntimeOptions).toHaveBeenCalledWith(
      {
        applicationName: 'bound',
        otlpHeaders: { authorization: 'Basic a=b', x: '1' },
        captureMessageContent: false,
      },
      { applicationName: 'configured' }
    );
  });

  it('withWorker records a thrown error, rethrows it and still flushes', async () => {
    const hooks = lifecycle();
    const wrapped = wrapWorker(hooks, {
      fetch: async () => {
        throw new Error('boom');
      },
    });

    await expect(wrapped.fetch(request(), {}, ctx())).rejects.toThrow('boom');

    expect(spans()[0].status.code).toBe(2);
    expect(hooks.flush).toHaveBeenCalled();
  });

  it('withWorker flushes again once a streamed body has been read', async () => {
    const hooks = lifecycle();
    const wrapped = wrapWorker(hooks, {
      fetch: async () => new Response('data: x\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    });
    const context = ctx();

    const response = await wrapped.fetch(request(), {}, context);
    expect(hooks.flush).toHaveBeenCalledTimes(1);

    expect(await response.text()).toBe('data: x\n\n');
    expect(hooks.flush).toHaveBeenCalledTimes(2);
  });

  it('withWorker flushes when a streamed body fails or is cancelled', async () => {
    const failing = lifecycle();
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error('stream broke'));
      },
    });
    const response = await wrapWorker(failing, { fetch: async () => new Response(broken) }).fetch(request(), {}, ctx());
    await expect(response.text()).rejects.toThrow('stream broke');
    expect(failing.flush).toHaveBeenCalledTimes(2);

    const cancelled = lifecycle();
    const endless = new ReadableStream({ pull: (controller) => controller.enqueue(new Uint8Array(1)) });
    const stream = await wrapWorker(cancelled, { fetch: async () => new Response(endless) }).fetch(request(), {}, ctx());
    await stream.body!.cancel();
    expect(cancelled.flush).toHaveBeenCalledTimes(2);
  });

  it('withWorker leaves a body of known length alone', async () => {
    const original = new Response('done', { headers: { 'content-length': '4' } });

    expect(await wrapWorker(lifecycle(), { fetch: async () => original }).fetch(request(), {}, ctx())).toBe(original);
  });

  it('withWorker flushes after work the handler passes to ctx.waitUntil', async () => {
    const hooks = lifecycle();
    let finishWork = () => {};
    const work = new Promise<void>((resolve) => {
      finishWork = resolve;
    });
    const wrapped = wrapWorker(hooks, {
      fetch: async (_request: Request, _env: unknown, tracked: { waitUntil(p: Promise<unknown>): void }) => {
        tracked.waitUntil(work);
        return new Response('ok', { headers: { 'content-length': '2' } });
      },
    });
    const context = ctx();

    await wrapped.fetch(request(), {}, context);
    expect(hooks.flush).toHaveBeenCalledTimes(1);

    finishWork();
    await Promise.all(context.pending);
    expect(hooks.flush).toHaveBeenCalledTimes(2);
  });

  it('withWorker keeps an instance handler\'s prototype methods', async () => {
    class App {
      helper() {
        return new Response('helped');
      }

      async fetch() {
        return this.helper();
      }
    }

    const response = await wrapWorker(lifecycle(), new App()).fetch(request(), {}, ctx());

    expect(await response.text()).toBe('helped');
  });

  it('withWorker wraps a class and reads env and ctx from the instance', async () => {
    class Base {
      env = { OTEL_SERVICE_NAME: 'from-class' };
      ctx = ctx();

      async fetch() {
        return new Response('ok');
      }
    }
    const hooks = lifecycle();
    const Traced: any = createWorkerWrapper(hooks)(Base);

    await new Traced().fetch(request());

    expect(spans()[0].name).toBe('POST /path');
    expect(hooks.applyRuntimeOptions.mock.calls[0]).toEqual([{ applicationName: 'from-class' }, undefined]);
  });

  it('a bad configure or pricing step never fails the request', async () => {
    const hooks = lifecycle();
    hooks.ensurePricing.mockImplementation(() => new Promise(() => {}));
    const wrapped = wrapWorker(hooks, { fetch: async () => new Response('ok') }, () => {
      throw new Error('bad config');
    });

    expect((await wrapped.fetch(request(), {}, ctx())).status).toBe(200);
  });

  it('caps the path in span names', async () => {
    const long = new Request(`https://app.example/${'a'.repeat(5000)}`);
    await wrapWorker(lifecycle(), { fetch: async () => new Response('ok') }).fetch(long, {}, ctx());

    expect(spans()[0].name.length).toBeLessThan(300);
  });

  it('withLambda does not wait past its flush budget', async () => {
    const hooks = lifecycle();
    hooks.flush.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();

    await createLambdaWrapper(hooks)(async () => 'ok')({}, { getRemainingTimeInMillis: () => 700 });

    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('withWorker wraps scheduled and queue handlers, and leaves other exports alone', async () => {
    const hooks = lifecycle();
    const scheduled = jest.fn(async () => {});
    const handler = { scheduled, custom: 'value' };
    const wrapped = wrapWorker(hooks, handler);

    await wrapped.scheduled({ cron: '* * * * *' }, {}, ctx());

    expect(scheduled).toHaveBeenCalled();
    expect(spans()[0].name).toBe('worker.scheduled');
    expect(hooks.flush).toHaveBeenCalled();
    expect(wrapped.custom).toBe('value');
    expect(wrapped.fetch).toBeUndefined();
  });

  it('withLambda flushes before returning, even on error', async () => {
    const hooks = lifecycle();
    const order: string[] = [];
    hooks.flush.mockImplementation(async () => void order.push('flush'));
    const withLambda = createLambdaWrapper(hooks);

    const ok = withLambda(async () => 'result');
    await ok({}, { functionName: 'fn', awsRequestId: 'id-1' }).then((value) => order.push(value));
    expect(order).toEqual(['flush', 'result']);
    expect(spans()[0].name).toBe('fn');
    expect(spans()[0].attributes['faas.invocation_id']).toBe('id-1');

    const bad = withLambda(async () => {
      throw new Error('boom');
    });
    await expect(bad({}, {})).rejects.toThrow('boom');
    expect(hooks.flush).toHaveBeenCalledTimes(2);
  });
});

describe('instrument', () => {
  it('warns and returns unknown clients untouched', () => {
    const client = { something: true };
    expect(instrument(client)).toBe(client);
  });
});

describe('guards', () => {
  const message = {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'model-a',
    content: [{ type: 'text', text: 'hi' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const sse = () =>
    new Response(
      [
        { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]
        .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        .join(''),
      { headers: { 'content-type': 'text/event-stream' } }
    );
  const secret = { model: 'model-a', max_tokens: 5, messages: [{ role: 'user' as const, content: 'mail bob@example.com' }] };
  const pipeline = new Pipeline({ guards: [new PII({ action: 'deny' } as any)], failOpen: false });

  afterEach(() => {
    OpenlitConfig.guardPipeline = undefined;
  });

  it('instrument() guards a client, including beta', async () => {
    OpenlitConfig.guardPipeline = pipeline;
    const upstream = jest.fn(async () => Response.json(message));
    const client = instrument(new Anthropic({ apiKey: 'test', maxRetries: 0, fetch: upstream }));

    await expect(client.messages.create(secret)).rejects.toThrow(GuardDeniedError);
    await expect(client.beta.messages.create(secret)).rejects.toThrow(GuardDeniedError);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('keeps the APIPromise, so stream() works with guards on', async () => {
    OpenlitConfig.guardPipeline = pipeline;
    const client = new Anthropic({ apiKey: 'test', maxRetries: 0, fetch: async () => sse() });
    guardClient(client);

    const clean = { ...secret, messages: [{ role: 'user' as const, content: 'hello' }] };
    await expect(client.messages.stream(clean).finalMessage()).resolves.toMatchObject({ id: 'msg' });
  });

  describe('a denied call', () => {
    const unhandled = jest.fn();
    beforeAll(() => process.on('unhandledRejection', unhandled));
    afterAll(() => process.off('unhandledRejection', unhandled));
    beforeEach(() => unhandled.mockClear());
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    const deniedClient = () => {
      OpenlitConfig.guardPipeline = pipeline;
      const upstream = jest.fn(async () => sse());
      const client = new Anthropic({ apiKey: 'test', maxRetries: 0, fetch: upstream });
      guardClient(client);
      return { client, upstream };
    };

    it('reaches stream() callers as an error they can catch, with nothing left unhandled', async () => {
      const { client, upstream } = deniedClient();

      const error = await client.messages.stream(secret).finalMessage().catch((e: any) => e);
      await settle();

      // The SDK's stream helper wraps any error it did not raise, and keeps ours as the cause.
      expect(error instanceof GuardDeniedError || error?.cause instanceof GuardDeniedError).toBe(true);
      expect(upstream).not.toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    });

    it('rejects withResponse() and asResponse() with the guard error', async () => {
      const { client } = deniedClient();

      await expect(client.messages.create(secret).withResponse()).rejects.toThrow(GuardDeniedError);
      await expect(client.messages.create(secret).asResponse()).rejects.toThrow(GuardDeniedError);
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
    });
  });

  it('guards a client wrapped before the guards were set up', async () => {
    const upstream = jest.fn(async () => Response.json(message));
    const client = instrument(new Anthropic({ apiKey: 'test', maxRetries: 0, fetch: upstream }));
    OpenlitConfig.guardPipeline = pipeline;

    await expect(client.messages.create(secret)).rejects.toThrow(GuardDeniedError);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('warns when no provider could be guarded', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bare = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      setupAutoGuards([new PII({ action: 'deny' } as any)], false, { anthropic: {} as any, openai: {} as any });
      // Node can still require the real providers here, so only the bundled case is certain to warn.
      const wrapped = bare.mock.calls.some(([line]) => String(line).includes('Auto-guards: wrapped'));
      expect(wrapped || warn.mock.calls.some(([line]) => String(line).includes('not applied'))).toBe(true);
    } finally {
      warn.mockRestore();
      bare.mockRestore();
    }
  });

  it('guards a module passed in, under a default import', async () => {
    class Messages {
      create = undefined;
    }
    const guardedMethod = jest.fn(async () => message);
    (Messages.prototype as any).create = guardedMethod;
    const module = { Messages, Anthropic: {} };

    setupAutoGuards([new PII({ action: 'deny' } as any)], false, { anthropic: module });
    const target = Object.create(Messages.prototype);

    await expect(target.create(secret)).rejects.toThrow(GuardDeniedError);
    expect(guardedMethod).not.toHaveBeenCalled();
  });
});

describe('Instrumentations.setup with an unknown key', () => {
  it('skips it and still patches the rest', () => {
    const patch = jest.spyOn(Instrumentations.availableInstrumentations.anthropic, 'manualPatch').mockImplementation(() => {});
    try {
      expect(() =>
        Instrumentations.setup(provider, [], { nope: {}, anthropic: {} } as any)
      ).not.toThrow();
      expect(patch).toHaveBeenCalledTimes(1);
    } finally {
      patch.mockRestore();
    }
  });
});

describe('instrumentFetch', () => {
  const body = JSON.stringify({ model: 'jev-1', questions: { q1: { type: 'text' } } });
  const url = 'https://api.typesafe.ai/v1/systemone';
  const realFetch = globalThis.fetch;
  let restore: () => void;

  const stub = (response: Response) => {
    globalThis.fetch = jest.fn(async () => response) as any;
    restore = instrumentFetch(['typesafe']);
  };

  afterEach(() => {
    restore();
    globalThis.fetch = realFetch;
  });

  it('traces matching requests and returns the unread response', async () => {
    stub(Response.json({ model: 'jev-1', usage: { input_tokens: 3, output_tokens: 2 } }));

    const response = await fetch(url, { method: 'POST', body });

    expect(await response.json()).toMatchObject({ model: 'jev-1' });
    expect(spans()).toHaveLength(1);
    expect(spans()[0].attributes[SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]).toBe('typesafe');
    expect(spans()[0].attributes[SemanticConvention.GEN_AI_REQUEST_MODEL]).toBe('jev-1');
  });

  it('leaves other hosts alone', async () => {
    stub(new Response('ok'));

    await fetch('https://example.com/v1/systemone', { method: 'POST', body });

    expect(spans()).toHaveLength(0);
  });

  it('returns HTTP errors to the caller and records them', async () => {
    stub(new Response('nope', { status: 500 }));

    const response = await fetch(url, { method: 'POST', body });

    expect(response.status).toBe(500);
    expect(spans()[0].status.code).toBe(2);
  });

  it('passes requests with an unreadable body through', async () => {
    stub(new Response('ok'));

    const response = await fetch(url, { method: 'POST', body: 'not json' });

    expect(await response.text()).toBe('ok');
    expect(spans()).toHaveLength(0);
  });

  it('adds no second span under a patched SDK call', async () => {
    stub(Response.json({}));
    const tracer = provider.getTracer('t');
    const outer = tracer.startSpan('sdk', {
      attributes: { [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: 'typesafe' },
    });

    await context.with(otelTrace.setSpan(context.active(), outer), () => fetch(url, { method: 'POST', body }));
    outer.end();

    expect(spans().map((s) => s.name)).toEqual(['sdk']);
  });
});

describe('codingAgentEnv', () => {
  it('switches on native telemetry and keeps the current environment', () => {
    const env = codingAgentEnv({ vendor: 'claude-code', otlpEndpoint: 'https://collector.example' });

    expect(env.PATH).toBe(process.env.PATH);
    expect(env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe('1');
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('https://collector.example');
  });

  it('leaves service.name to the vendor and identifies the agent for the coding agents pages', () => {
    const env = codingAgentEnv({ vendor: 'claude-code', serviceName: 'my-app' });

    expect(env.OTEL_RESOURCE_ATTRIBUTES).toContain('gen_ai.agent.name=claude-code');
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toContain('openlit.caller.service=my-app');
    expect(env.OTEL_RESOURCE_ATTRIBUTES).not.toContain('service.name');
  });

  it('links the child to the caller by traceparent and resource attributes', () => {
    const parent = traceContextFrom('caller');
    const env = codingAgentEnv({ vendor: 'claude-code', parent });

    expect(env.TRACEPARENT).toBe(`00-${parent.traceId}-${parent.spanId}-01`);
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toContain(`openlit.parent.trace_id=${parent.traceId}`);
  });

  it('keeps content off unless asked', () => {
    expect(codingAgentEnv({ vendor: 'claude-code' }).OTEL_LOG_USER_PROMPTS).toBeUndefined();
    expect(codingAgentEnv({ vendor: 'claude-code', captureContent: true }).OTEL_LOG_USER_PROMPTS).toBe('1');
  });

  it('encodes values that would break the attribute list', () => {
    const env = codingAgentEnv({ vendor: 'claude-code', resourceAttributes: { team: 'a,b=c' } });

    expect(env.OTEL_RESOURCE_ATTRIBUTES).toContain('team=a%2Cb%3Dc');
  });

  describe('inherited variables', () => {
    const saved = { ...process.env };

    afterEach(() => {
      process.env = { ...saved };
    });

    it('cannot undo what it sets up', () => {
      process.env.OTEL_SERVICE_NAME = 'parent';
      for (const flag of ['USER_PROMPTS', 'TOOL_DETAILS', 'RAW_API_BODIES', 'TOOL_CONTENT', 'ASSISTANT_RESPONSES']) {
        process.env[`OTEL_LOG_${flag}`] = '1';
      }
      process.env.OTEL_LOG_LEVEL = 'debug';
      const env = codingAgentEnv({ vendor: 'claude-code' });

      expect(env.OTEL_SERVICE_NAME).toBeUndefined();
      expect(Object.keys(env).filter((name) => name.startsWith('OTEL_LOG_'))).toEqual(['OTEL_LOG_LEVEL']);
    });

    it('merges resource attributes and keeps a chosen protocol', () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = 'team=ml';
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'grpc';
      const env = codingAgentEnv({ vendor: 'claude-code' });

      expect(env.OTEL_RESOURCE_ATTRIBUTES).toMatch(/^team=ml,gen_ai\.agent\.name=claude-code/);
      expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe('grpc');
    });
  });

  it('refuses vendors with no native settings', () => {
    expect(() => codingAgentEnv({ vendor: 'cursor' as any })).toThrow('cursor');
  });
});

describe('settings parsers', () => {
  it('reads OTLP headers whose values contain = or are percent-encoded', () => {
    expect(parseOtlpHeaders('Authorization=Bearer%20abc,x-token=a=b, bad ,=nokey')).toEqual({
      Authorization: 'Bearer abc',
      'x-token': 'a=b',
    });
    expect(parseOtlpHeaders('')).toBeUndefined();
  });

  it('reads booleans the same way from env vars and Worker bindings', () => {
    for (const value of [false, 'false', '0', 'no', 'NO ']) expect(parseBool(value)).toBe(false);
    for (const value of [true, 'true', '1', 'yes']) expect(parseBool(value)).toBe(true);
    for (const value of [undefined, '', 'maybe', 0]) expect(parseBool(value)).toBeUndefined();
  });
});

describe('withWorker settings', () => {
  const lifecycle = () => ({
    flush: jest.fn(async () => {}),
    applyRuntimeOptions: jest.fn(),
    ensurePricing: jest.fn(async () => {}),
  });
  const ctx = { waitUntil: () => undefined };

  it('keeps the bindings when the settings callback throws', async () => {
    const hooks = lifecycle();
    const wrapped: any = createWorkerWrapper(hooks)({ fetch: async () => new Response('ok') }, () => {
      throw new Error('boom');
    });

    await wrapped.fetch(new Request('https://app.example/'), { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://c.example' }, ctx);

    expect(hooks.applyRuntimeOptions).toHaveBeenCalledWith(
      expect.objectContaining({ otlpEndpoint: 'https://c.example' }),
      undefined
    );
  });

  it('switches content capture off for a boolean or 0 binding', async () => {
    for (const value of [false, '0']) {
      const hooks = lifecycle();
      const wrapped: any = createWorkerWrapper(hooks)({ fetch: async () => new Response('ok') });

      await wrapped.fetch(new Request('https://app.example/'), { OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: value }, ctx);

      expect(hooks.applyRuntimeOptions.mock.calls[0][0].captureMessageContent).toBe(false);
    }
  });
});

describe('vLLM hook on the openai module', () => {
  it('hands other OpenAI clients the original APIPromise, not a new Promise', () => {
    const apiPromise = { withResponse: () => undefined, _thenUnwrap: () => undefined };
    const openaiHandler = jest.fn(() => apiPromise);
    const create = VllmWrapper._patchChat({} as any, openaiHandler, jest.fn())(jest.fn());

    expect(create.call({ baseURL: 'https://api.openai.com/v1' }, { model: 'gpt' })).toBe(apiPromise);
  });
});
