import Anthropic from '@anthropic-ai/sdk';
import openlit from 'openlit';

const message = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-test',
  content: [{ type: 'text', text: 'hello' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

// No init() and no module patch: everything comes from bindings and this one client.
export default openlit.withWorker({
  async fetch() {
    const client = openlit.instrument(
      new Anthropic({ apiKey: 'test', maxRetries: 0, fetch: async () => Response.json(message) })
    );
    await client.messages.create({ model: 'claude-test', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
    return new Response('ok');
  },
});
