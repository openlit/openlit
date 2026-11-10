/**
 * @jest-environment node
 *
 * Runs the real AI SDK against a local server, so it proves the request that
 * actually leaves OpenLIT rather than the arguments handed to a mock.
 */
import dns from 'dns';
import http from 'http';
import type { AddressInfo } from 'net';
import { generateText, streamText } from 'ai';
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
    // jest.setup.ts swaps in a stub Response; the endpoint builds real ones.
    (globalThis as any).Response = (await fetch('data:,')).constructor;
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

  it('streams chunks as the server sends them', async () => {
    process.env[ENV_KEY] = 'true';
    const chunk = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({
        id: 'cmpl-1',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'llama3',
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    let releaseSecondChunk = () => {};
    respond = (res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.write(chunk({ role: 'assistant', content: 'hel' }));
      releaseSecondChunk = () => {
        res.write(chunk({ content: 'lo' }));
        res.end(`${chunk({}, 'stop')}data: [DONE]\n\n`);
      };
    };

    const { textStream } = streamText({
      model: createModel(OPENAI_COMPATIBLE_PROVIDER_ID, '', 'llama3', baseUrl),
      prompt: 'hi',
      maxRetries: 0,
    });

    const received: string[] = [];
    for await (const delta of textStream) {
      received.push(delta);
      releaseSecondChunk();
    }
    expect(received.join('')).toBe('hello');
    expect(received.length).toBeGreaterThan(1);
  });

  it('stops the request when the caller aborts', async () => {
    process.env[ENV_KEY] = 'true';
    const controller = new AbortController();
    const closed = new Promise<void>((resolve) => {
      respond = (res) => {
        res.on('close', () => resolve());
        controller.abort();
      };
    });

    await expect(
      generateText({
        model: createModel(OPENAI_COMPATIBLE_PROVIDER_ID, '', 'llama3', baseUrl),
        prompt: 'hi',
        maxRetries: 0,
        abortSignal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await closed;
  });

  it('returns a status Response cannot represent as a failed call, not a crash', async () => {
    process.env[ENV_KEY] = 'true';
    respond = (res) => {
      res.statusCode = 600;
      res.end();
    };
    await expect(run('')).rejects.toThrow();
  });

  it('streams the body of an error response back to the SDK', async () => {
    process.env[ENV_KEY] = 'true';
    respond = (res) => {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'bad key' } }));
    };
    await expect(run('')).rejects.toMatchObject({ statusCode: 401 });
  });

  describe('when a hostname changes after validation', () => {
    const port = () => new URL(baseUrl).port;
    const runHost = (hostname: string) =>
      generateText({
        model: createModel(
          OPENAI_COMPATIBLE_PROVIDER_ID,
          'secret-key',
          'llama3',
          `http://${hostname}:${port()}/v1`
        ),
        prompt: 'hi',
        maxRetries: 0,
      });

    // assertPublicUrl sees `validated`; the socket connects to loopback, where
    // the test server stands in for an internal service.
    function rebind(validated: string, connected = '127.0.0.1') {
      jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: validated, family: 4 }] as never);
      const realLookup = dns.lookup;
      return jest.spyOn(dns, 'lookup').mockImplementation(((
        _hostname: string,
        options: { all?: boolean },
        callback: (...args: unknown[]) => void
      ) => {
        if (connected === '127.0.0.1') {
          realLookup('127.0.0.1', options as never, callback as never);
        } else if (options.all) {
          callback(null, [{ address: connected, family: 4 }]);
        } else {
          callback(null, connected, 4);
        }
      }) as never);
    }

    afterEach(() => jest.restoreAllMocks());

    it('refuses a host that rebinds to loopback with the setting off', async () => {
      const lookup = rebind('93.184.216.34');
      await expect(runHost('rebind.example')).rejects.toThrow(getMessage().MODEL_ENDPOINT_NOT_ALLOWED);
      expect(lookup).toHaveBeenCalled();
      expect(seen).toHaveLength(0);
    });

    it('refuses a host that rebinds to a metadata address with the setting on', async () => {
      process.env[ENV_KEY] = 'true';
      rebind('10.0.0.5', '169.254.169.254');
      await expect(runHost('rebind.example')).rejects.toThrow(getMessage().MODEL_ENDPOINT_NOT_ALLOWED);
      expect(seen).toHaveLength(0);
    });

    it('connects to a private host through the lookup when the setting is on', async () => {
      process.env[ENV_KEY] = 'true';
      rebind('10.0.0.5');
      const { text } = await runHost('llm.internal');
      expect(text).toBe('hello');
      expect(seen[0].authorization).toBe('Bearer secret-key');
    });
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
      'http://[fd00:ec2::254]/latest/meta-data',
      'http://[fd20:ce::254]/computeMetadata/v1',
      'http://100.100.100.200/latest/meta-data',
      'http://[fe80::1]/v1',
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
