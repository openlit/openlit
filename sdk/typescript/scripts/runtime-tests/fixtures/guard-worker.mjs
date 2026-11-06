import Anthropic from '@anthropic-ai/sdk';
import openlit, { GuardDeniedError, PII } from 'openlit';

openlit.init({
  instrumentations: { anthropic: Anthropic },
  guards: [new PII({ action: 'deny' })],
  guardFailOpen: false,
});

export default openlit.withWorker({
  async fetch() {
    const client = new Anthropic({ apiKey: 'test', maxRetries: 0, fetch: async () => new Response('{}') });
    try {
      await client.messages.create({
        model: 'claude-test',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'mail bob@example.com' }],
      });
      return new Response('reached the model');
    } catch (error) {
      return new Response(error instanceof GuardDeniedError ? 'blocked' : String(error));
    }
  },
});
