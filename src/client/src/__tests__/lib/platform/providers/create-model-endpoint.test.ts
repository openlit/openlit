/**
 * @jest-environment node
 *
 * Runs the real AI SDK against a local server, so it proves the request that
 * actually leaves OpenLIT rather than the arguments handed to a mock.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { generateText } from 'ai';
import getMessage from '@/constants/messages';
import { OPENAI_COMPATIBLE_PROVIDER_ID } from '@/constants/chat-providers';
import {
  assertModelEndpointAllowed,
  createModel,
} from '@/lib/platform/providers/create-model';

const ENV_KEY = 'OPENLIT_ALLOW_PRIVATE_MODEL_ENDPOINTS';

type Seen = { url?: string; authorization?: string };

function chatCompletion(res: http.ServerResponse) {
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      id: 'cmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'llama3',
      choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  );
}

describe('OpenAI-compatible endpoint', () => {
  let server: http.Server;
  let baseUrl: string;
  let seen: Seen[];
  let respond: (res: http.ServerResponse) => void;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      req.resume();
      seen.push({ url: req.url, authorization: req.headers.authorization });
      respond(res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    seen = [];
    respond = chatCompletion;
    process.env.OPENAI_API_KEY = 'sk-must-not-leak';
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  });

  const run = (apiKey: string) =>
    generateText({
      model: createModel(OPENAI_COMPATIBLE_PROVIDER_ID, apiKey, 'llama3', baseUrl),
      prompt: 'hi',
      maxRetries: 0,
    });

  it('calls /chat/completions and never sends the OPENAI_API_KEY env value', async () => {
    process.env[ENV_KEY] = 'true';
    const { text } = await run('');
    expect(text).toBe('hello');
    expect(seen[0].url).toBe('/v1/chat/completions');
    expect(seen[0].authorization ?? '').not.toContain('sk-must-not-leak');
  });

  it('sends the configured key when there is one', async () => {
    process.env[ENV_KEY] = 'true';
    await run('local-key');
    expect(seen[0].authorization).toBe('Bearer local-key');
  });

  it('blocks a loopback endpoint at call time by default', async () => {
    await expect(run('')).rejects.toThrow(getMessage().MODEL_ENDPOINT_NOT_ALLOWED);
    expect(seen).toHaveLength(0);
  });

  it('does not follow a redirect from an allowed endpoint', async () => {
    process.env[ENV_KEY] = 'true';
    const target = jest.fn(chatCompletion);
    respond = (res) => {
      respond = target;
      res.statusCode = 302;
      res.setHeader('location', `${baseUrl}/chat/completions`);
      res.end();
    };
    await expect(run('')).rejects.toThrow();
    expect(seen).toHaveLength(1);
    expect(target).not.toHaveBeenCalled();
  });

  describe('assertModelEndpointAllowed', () => {
    const blocked = getMessage().MODEL_ENDPOINT_NOT_ALLOWED;

    it.each([
      'http://localhost:11434/v1',
      'http://127.0.0.1:8000/v1',
      'http://10.0.0.5:8000/v1',
      'http://192.168.1.20:8000/v1',
    ])('rejects private address %s by default', async (url) => {
      await expect(assertModelEndpointAllowed(url)).rejects.toThrow(blocked);
    });

    it.each([
      'http://169.254.169.254/latest/meta-data',
      'http://metadata.google.internal/computeMetadata/v1',
      'http://[::ffff:169.254.169.254]/latest/meta-data',
    ])('rejects metadata endpoint %s even with the setting on', async (url) => {
      process.env[ENV_KEY] = 'true';
      await expect(assertModelEndpointAllowed(url)).rejects.toThrow(blocked);
    });

    it('rejects non-http schemes and embedded credentials', async () => {
      process.env[ENV_KEY] = 'true';
      await expect(assertModelEndpointAllowed('file:///etc/passwd')).rejects.toThrow(blocked);
      await expect(assertModelEndpointAllowed('http://user:pw@10.0.0.5/v1')).rejects.toThrow(blocked);
    });

    it('treats any value other than an enabled flag as off', async () => {
      process.env[ENV_KEY] = 'false';
      await expect(assertModelEndpointAllowed('http://10.0.0.5:8000/v1')).rejects.toThrow(blocked);
    });

    it('allows private addresses with the setting on', async () => {
      process.env[ENV_KEY] = 'true';
      await expect(assertModelEndpointAllowed('http://10.0.0.5:8000/v1')).resolves.toBeInstanceOf(URL);
    });

    it('allows public addresses over http or https', async () => {
      await expect(assertModelEndpointAllowed('https://8.8.8.8/v1')).resolves.toBeInstanceOf(URL);
    });
  });
});
