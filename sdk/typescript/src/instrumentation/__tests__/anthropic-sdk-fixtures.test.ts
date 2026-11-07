/**
 * Runs the real `@anthropic-ai/sdk` against recorded-shape responses, because
 * the behaviour under test lives in how the SDK's helpers use what `create()`
 * returns. Test doubles of `create()` cannot show that.
 */
import { trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import Anthropic from '@anthropic-ai/sdk';
import OpenlitAnthropicInstrumentation from '../anthropic';
import OpenlitConfig from '../../config';
import SemanticConvention from '../../semantic-convention';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

const usage = { input_tokens: 10, output_tokens: 5 };
const message = (extra: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content: [{ type: 'text', text: 'hello' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage,
  ...extra,
});

function sse(stopReason = 'end_turn', deltaUsage: Record<string, unknown> = { output_tokens: 5 }) {
  const events = [
    { type: 'message_start', message: message({ content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } }) },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: deltaUsage },
    { type: 'message_stop' },
  ];
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function client(respond: () => Response) {
  return new Anthropic({
    apiKey: 'test',
    maxRetries: 0,
    fetch: async () => respond(),
  } as any);
}

const params = { model: 'claude-test', max_tokens: 5, messages: [{ role: 'user' as const, content: 'hi' }] };
const chatSpans = () =>
  exporter.getFinishedSpans().filter((s) => s.attributes[SemanticConvention.GEN_AI_OPERATION] === 'chat');

describe('Anthropic against the real SDK', () => {
  const instrumentation = new OpenlitAnthropicInstrumentation();

  beforeAll(() => {
    OpenlitConfig.updateConfig({ applicationName: 'app', environment: 'test' });
    OpenlitConfig.pricingInfo = {
      chat: {
        'claude-test': { promptPrice: 1, completionPrice: 2 },
        'claude-fallback': { promptPrice: 10, completionPrice: 20 },
      },
    } as any;
    instrumentation.setTracerProvider(provider);
    instrumentation.manualPatch({ Anthropic });
  });

  beforeEach(() => exporter.reset());


  it('messages.create gives one span with model, tokens, cost and finish reason', async () => {
    await client(() => json(message())).messages.create(params);

    const [span, ...rest] = chatSpans();
    expect(rest).toHaveLength(0);
    expect(span.attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL]).toBe('claude-test');
    expect(span.attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]).toBe(10);
    expect(span.attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(5);
    expect(span.attributes[SemanticConvention.GEN_AI_USAGE_COST]).toBeGreaterThan(0);
    expect(span.attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]).toEqual(['stop']);
  });

  it('keeps the APIPromise, so withResponse() and asResponse() work', async () => {
    const withResponse = await client(() => json(message())).messages.create(params).withResponse();
    expect(withResponse.data.id).toBe('msg_1');
    expect(withResponse.response.status).toBe(200);
    expect(chatSpans()).toHaveLength(1);
    expect(chatSpans()[0].attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]).toBe(10);

    exporter.reset();
    const raw = await client(() => json(message())).messages.create(params).asResponse();
    expect(raw.status).toBe(200);
    expect(await raw.json()).toMatchObject({ id: 'msg_1' });
    expect(chatSpans()).toHaveLength(1);
  });

  it('ends the span of a call nobody awaits', async () => {
    client(() => json(message())).messages.create(params);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(chatSpans()).toHaveLength(1);
  });

  it('messages.create with stream:true gives one span when the stream ends', async () => {
    const stream: any = await client(() => sse()).messages.create({ ...params, stream: true });
    expect(chatSpans()).toHaveLength(0);
    for await (const _event of stream) { /* drain */ }

    expect(chatSpans()).toHaveLength(1);
    expect(chatSpans()[0].attributes[SemanticConvention.GEN_AI_REQUEST_IS_STREAM]).toBe(true);
    expect(chatSpans()[0].attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(5);
  });

  it('messages.stream works and gives exactly one span', async () => {
    const final = await client(() => sse()).messages.stream(params).finalMessage();

    expect(final.content[0]).toMatchObject({ type: 'text', text: 'hello' });
    expect(chatSpans()).toHaveLength(1);
    expect(chatSpans()[0].attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(5);
  });

  it('beta.messages.create gives one span under the beta endpoint', async () => {
    await client(() => json(message())).beta.messages.create(params);
    expect(chatSpans()).toHaveLength(1);
  });

  it('beta.messages.stream works and gives exactly one span', async () => {
    const final = await client(() => sse()).beta.messages.stream(params).finalMessage();

    expect(final.content[0]).toMatchObject({ type: 'text', text: 'hello' });
    expect(chatSpans()).toHaveLength(1);
  });

  it('records server tool use and passes refusal, pause_turn through as finish reasons', async () => {
    await client(() =>
      json(message({ stop_reason: 'refusal', usage: { ...usage, server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } } }))
    ).messages.create(params);

    const span = chatSpans()[0];
    expect(span.attributes[SemanticConvention.ANTHROPIC_USAGE_WEB_SEARCH_REQUESTS]).toBe(2);
    expect(span.attributes[SemanticConvention.ANTHROPIC_USAGE_WEB_FETCH_REQUESTS]).toBe(1);
    expect(span.attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]).toEqual(['refusal']);

    exporter.reset();
    await client(() => sse('pause_turn', { output_tokens: 5, server_tool_use: { web_search_requests: 3 } }))
      .messages.stream(params)
      .finalMessage();
    expect(chatSpans()[0].attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]).toEqual(['pause_turn']);
    expect(chatSpans()[0].attributes[SemanticConvention.ANTHROPIC_USAGE_WEB_SEARCH_REQUESTS]).toBe(3);
  });

  it('reports the fallback model that served the response and prices it', async () => {
    const iterations = [{ type: 'fallback_message', model: 'claude-fallback', input_tokens: 10, output_tokens: 5 }];
    await client(() => json(message({ usage: { ...usage, iterations } }))).beta.messages.create(params);

    const span = chatSpans()[0];
    expect(span.attributes[SemanticConvention.ANTHROPIC_RESPONSE_FALLBACK_MODEL]).toBe('claude-fallback');
    expect(span.attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL]).toBe('claude-fallback');
    expect(span.attributes[SemanticConvention.GEN_AI_USAGE_COST]).toBeCloseTo((10 * 10 + 5 * 20) / 1000);
  });

  it('ends the span and rethrows when the API returns an error', async () => {
    const error = { type: 'error', error: { type: 'overloaded_error', message: 'busy' } };
    await expect(client(() => json(error, 529)).messages.create(params)).rejects.toThrow();

    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(exporter.getFinishedSpans()[0].status.code).toBe(2);
  });

  it('patchClient covers one client and does not double-patch a patched prototype', async () => {
    const fresh = new OpenlitAnthropicInstrumentation();
    fresh.setTracerProvider(provider);
    const one = client(() => json(message()));

    fresh.patchClient(one);
    await one.messages.create(params);
    expect(chatSpans()).toHaveLength(1);
  });
});

describe('the SDK\'s own tracing', () => {
  const scopes = () => exporter.getFinishedSpans().map((s) => s.instrumentationScope.name);

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
  });

  afterAll(() => {
    trace.disable();
  });

  beforeEach(() => exporter.reset());

  // Guards `disableNativeCallSpan`: it relies on an SDK internal. If an SDK
  // upgrade makes these fail, every Anthropic call is reported and billed twice.
  it('emits no second span for an instrumented call', async () => {
    await client(() => json(message())).messages.create(params);

    expect(scopes()).toEqual([expect.stringContaining('instrumentation-anthropic')]);
  });

  it('leaves a client alone that was given its own tracer provider', async () => {
    const seen = new InMemorySpanExporter();
    const own = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(seen)] });
    const dedicated = new Anthropic({
      apiKey: 'test',
      maxRetries: 0,
      fetch: async () => json(message()),
      openTelemetry: { tracerProvider: own },
    } as any);

    await dedicated.messages.create(params);

    expect(seen.getFinishedSpans()).toHaveLength(1);
    await own.shutdown();
  });

  it('emits no second span for the first stream() on a client', async () => {
    await client(() => sse()).messages.stream(params).finalMessage();

    expect(scopes()).toEqual([expect.stringContaining('instrumentation-anthropic')]);
  });
});
