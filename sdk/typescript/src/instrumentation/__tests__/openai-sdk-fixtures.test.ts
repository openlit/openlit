/** Runs the real `openai` SDK, because the behaviour depends on what `create()` returns. */
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import OpenAI from 'openai';
import OpenlitOpenAIInstrumentation from '../openai';
import OpenlitConfig from '../../config';
import SemanticConvention from '../../semantic-convention';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

const completion = {
  id: 'chatcmpl_1',
  object: 'chat.completion',
  model: 'gpt-test',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

function sse() {
  const chunks = [
    { id: 'c', object: 'chat.completion.chunk', model: 'gpt-test', choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' }, finish_reason: null }] },
    { id: 'c', object: 'chat.completion.chunk', model: 'gpt-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

const client = (respond: () => Response) =>
  new OpenAI({ apiKey: 'test', maxRetries: 0, fetch: async () => respond() });
const params = { model: 'gpt-test', messages: [{ role: 'user' as const, content: 'hi' }] };
const json = (body: unknown, status = 200) => Response.json(body as object, { status });

describe('OpenAI against the real SDK', () => {
  beforeAll(() => {
    OpenlitConfig.updateConfig({ applicationName: 'app', environment: 'test' });
    OpenlitConfig.pricingInfo = {} as any;
    const instrumentation = new OpenlitOpenAIInstrumentation();
    instrumentation.setTracerProvider(provider);
    instrumentation.manualPatch({ OpenAI });
  });

  beforeEach(() => exporter.reset());

  it('create() still gives one span with tokens', async () => {
    await client(() => json(completion)).chat.completions.create(params);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]).toBe(10);
  });

  it('keeps withResponse() and asResponse() working', async () => {
    const { data, response } = await client(() => json(completion)).chat.completions.create(params).withResponse();
    expect(data.id).toBe('chatcmpl_1');
    expect(response.status).toBe(200);
    expect(exporter.getFinishedSpans()).toHaveLength(1);

    exporter.reset();
    const raw = await client(() => json(completion)).chat.completions.create(params).asResponse();
    expect(await raw.json()).toMatchObject({ id: 'chatcmpl_1' });
    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it('chat.completions.stream() gives one span', async () => {
    const final = await client(sse).chat.completions.stream(params).finalChatCompletion();

    expect(final.choices[0].message.content).toBe('hi');
    expect(exporter.getFinishedSpans()).toHaveLength(1);
  });

  it('ends the span and rethrows on an API error', async () => {
    await expect(
      client(() => json({ error: { message: 'busy' } }, 500)).chat.completions.create(params)
    ).rejects.toThrow();

    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(exporter.getFinishedSpans()[0].status.code).toBe(2);
  });
});
