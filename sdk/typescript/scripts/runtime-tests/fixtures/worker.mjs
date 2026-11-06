import Anthropic from '@anthropic-ai/sdk';
import openlit from 'openlit';

// Module scope on purpose: Workers rejects I/O and timers here.
openlit.init({
  environment: 'runtime-test',
  disableMetrics: true,
  disableEvents: true,
  instrumentations: { anthropic: Anthropic, 'not-a-provider': {} },
});

const message = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-3-5-haiku-20241022',
  content: [{ type: 'text', text: 'hello' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1000, output_tokens: 500 },
};

const sse = () =>
  new Response(
    [
      { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 1000, output_tokens: 0 } } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 500 } },
      { type: 'message_stop' },
    ]
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );

const client = (respond) => new Anthropic({ apiKey: 'test', maxRetries: 0, fetch: async () => respond() });
const params = { model: 'claude-3-5-haiku-20241022', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] };

export default openlit.withWorker(
  {
    async fetch(request, _env, ctx) {
      const url = new URL(request.url);
      switch (url.pathname) {
        case '/anthropic':
          await client(() => Response.json(message)).messages.create(params);
          return new Response('ok');
        case '/anthropic-stream': {
          await client(sse).messages.stream(params).finalMessage();
          return new Response('ok');
        }
        case '/stream-response': {
          const stream = await client(sse).messages.create({ ...params, stream: true });
          const encoder = new TextEncoder();
          const body = new ReadableStream({
            async start(controller) {
              for await (const event of stream) controller.enqueue(encoder.encode(`data: ${event.type}\n\n`));
              controller.close();
            },
          });
          return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
        }
        case '/llm':
          await openlit.withTags({ purpose: 'classification', route: 'gateway' }, () =>
            openlit.llm({ provider: 'typesafe', model: 'jev-latest' }, async (span) => {
              span.setInput('hi');
              span.setUsage({ inputTokens: 10, outputTokens: 5 });
              span.setOutput('hello');
            })
          );
          return new Response('ok');
        case '/step': {
          const parent = openlit.traceContextFrom(url.searchParams.get('run'));
          await openlit.withParent(parent, () =>
            openlit.trace(`step ${url.searchParams.get('n')}`, async () => {})
          );
          return new Response('ok');
        }
        case '/finish': {
          const run = openlit.traceContextFrom(url.searchParams.get('run'));
          openlit.recordSpan({ name: 'workflow run', ...run, start: Date.now() - 1000, end: Date.now() });
          return new Response('ok');
        }
        case '/set-version':
          openlit.setAgentVersion('tenant-a');
          return new Response('ok');
        case '/read-version':
          return new Response(openlit.getAgentVersion() ?? 'none');
        case '/plain-stream': {
          const body = new ReadableStream({
            async start(controller) {
              await openlit.llm({ provider: 'custom', model: 'streamed' }, async () => {});
              controller.enqueue(new TextEncoder().encode('done'));
              controller.close();
            },
          });
          return new Response(body, { headers: { 'content-type': 'text/plain' } });
        }
        case '/background':
          ctx.waitUntil(openlit.llm({ provider: 'custom', model: 'background' }, async () => {}));
          return new Response('ok');
        case '/fail':
          throw new Error('handler failed');
        default:
          return new Response('not found', { status: 404 });
      }
    },
  },
  (env) => ({ applicationName: env.APP_NAME })
);
