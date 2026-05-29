/**
 * Unit tests for the shared GenAI helpers in `OpenLitHelper`:
 *
 * - `buildSystemInstructionsFromMessages` — normalize chat-completions
 *   `messages` into the OTel `gen_ai.system_instructions` payload
 *   (`[{"type":"text","content":"..."}]`) as a JSON string.
 * - `buildToolDefinitions` — normalize a request `tools` array into the OTel
 *   `gen_ai.tool.definitions` schema as a JSON string.
 *
 * Every TS provider wired for these two attributes routes through these
 * helpers, so this file gives broad correctness coverage for the cross-SDK
 * GenAI gap-closure work.
 */

import { createHash } from 'crypto';
import OpenLitHelper from '../../helpers';

describe('OpenLitHelper.buildSystemInstructionsFromMessages', () => {
  it('returns undefined for empty or missing input', () => {
    expect(OpenLitHelper.buildSystemInstructionsFromMessages([])).toBeUndefined();
    expect(OpenLitHelper.buildSystemInstructionsFromMessages(null as any)).toBeUndefined();
    expect(OpenLitHelper.buildSystemInstructionsFromMessages(undefined as any)).toBeUndefined();
  });

  it('returns undefined when no system role is present', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(OpenLitHelper.buildSystemInstructionsFromMessages(messages)).toBeUndefined();
  });

  it('extracts a single system message with string content', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'hi' },
    ];
    const raw = OpenLitHelper.buildSystemInstructionsFromMessages(messages);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!)).toEqual([
      { type: 'text', content: 'You are a helpful assistant.' },
    ]);
  });

  it('extracts a list-of-parts system message and ignores non-text parts', () => {
    const messages = [
      {
        role: 'system',
        content: [
          { type: 'text', text: 'part 1' },
          { type: 'text', text: 'part 2' },
          { type: 'image_url', image_url: 'ignored' },
          'part 3',
        ],
      },
    ];
    const raw = OpenLitHelper.buildSystemInstructionsFromMessages(messages);
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!)).toEqual([
      { type: 'text', content: 'part 1' },
      { type: 'text', content: 'part 2' },
      { type: 'text', content: 'part 3' },
    ]);
  });

  it('preserves multiple system messages in order', () => {
    const messages = [
      { role: 'system', content: 'first' },
      { role: 'user', content: 'noise' },
      { role: 'system', content: 'second' },
    ];
    const raw = OpenLitHelper.buildSystemInstructionsFromMessages(messages);
    expect(JSON.parse(raw!)).toEqual([
      { type: 'text', content: 'first' },
      { type: 'text', content: 'second' },
    ]);
  });

  it('skips system messages with empty content', () => {
    const messages = [
      { role: 'system', content: '' },
      { role: 'system', content: 'non-empty' },
    ];
    const raw = OpenLitHelper.buildSystemInstructionsFromMessages(messages);
    expect(JSON.parse(raw!)).toEqual([{ type: 'text', content: 'non-empty' }]);
  });

  it('coerces non-string content to a string', () => {
    const messages = [{ role: 'system', content: 42 }];
    const raw = OpenLitHelper.buildSystemInstructionsFromMessages(messages as any);
    expect(JSON.parse(raw!)).toEqual([{ type: 'text', content: '42' }]);
  });
});

describe('OpenLitHelper.buildToolDefinitions', () => {
  it('returns undefined for empty or missing input', () => {
    expect(OpenLitHelper.buildToolDefinitions(undefined)).toBeUndefined();
    expect(OpenLitHelper.buildToolDefinitions(null)).toBeUndefined();
    expect(OpenLitHelper.buildToolDefinitions([])).toBeUndefined();
  });

  it('extracts an OpenAI-style function schema', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      },
    ];
    const raw = OpenLitHelper.buildToolDefinitions(tools);
    expect(JSON.parse(raw!)).toEqual([
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get current weather',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ]);
  });

  it('extracts a flat schema with parameters', () => {
    const tools = [
      {
        name: 'search',
        description: 'Search the web',
        parameters: { type: 'object' },
      },
    ];
    const raw = OpenLitHelper.buildToolDefinitions(tools);
    expect(JSON.parse(raw!)).toEqual([
      {
        type: 'function',
        name: 'search',
        description: 'Search the web',
        parameters: { type: 'object' },
      },
    ]);
  });

  it('maps Anthropic input_schema onto parameters', () => {
    const tools = [
      {
        name: 'ping',
        description: 'Anthropic shape',
        input_schema: { type: 'object' },
      },
    ];
    const raw = OpenLitHelper.buildToolDefinitions(tools);
    expect(JSON.parse(raw!)).toEqual([
      {
        type: 'function',
        name: 'ping',
        description: 'Anthropic shape',
        parameters: { type: 'object' },
      },
    ]);
  });

  it('defaults parameters to {} when missing', () => {
    const tools = [{ name: 'no_params', description: 'no schema' }];
    const raw = OpenLitHelper.buildToolDefinitions(tools);
    expect(JSON.parse(raw!)).toEqual([
      {
        type: 'function',
        name: 'no_params',
        description: 'no schema',
        parameters: {},
      },
    ]);
  });

  it('drops unnamed function entries but keeps valid siblings', () => {
    const tools = [
      { type: 'function', function: { description: 'no name' } },
      { name: 'ok' },
    ];
    const raw = OpenLitHelper.buildToolDefinitions(tools);
    expect(JSON.parse(raw!)).toEqual([
      { type: 'function', name: 'ok', description: '', parameters: {} },
    ]);
  });

  it('returns undefined when every entry is unusable', () => {
    const tools = [{ description: 'no name' }, {}, null];
    expect(OpenLitHelper.buildToolDefinitions(tools)).toBeUndefined();
  });

  it('returns undefined when input is not an array', () => {
    // The TS helper only treats arrays as tool lists; non-array shapes (e.g.
    // Vercel AI's object map) must be normalized by the caller.
    expect(
      OpenLitHelper.buildToolDefinitions({ name: 'not-an-array' } as any),
    ).toBeUndefined();
  });
});

describe('OpenLitHelper.computeAgentVersionHash', () => {
  const BASE_PROMPT = JSON.stringify([
    { type: 'text', content: 'You are a helpful assistant.' },
  ]);
  const BASE_TOOLS = [
    {
      type: 'function',
      name: 'lookup_weather',
      description: 'Look up weather',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  ];
  const BASE_RUNTIME = { temperature: 0.2, top_p: 1.0, max_tokens: 512 };

  function hash(overrides: Partial<Parameters<typeof OpenLitHelper.computeAgentVersionHash>[0]> = {}): string {
    return OpenLitHelper.computeAgentVersionHash({
      systemInstructions: BASE_PROMPT,
      toolDefinitions: BASE_TOOLS,
      primaryModel: 'gpt-4o-mini',
      runtimeConfig: BASE_RUNTIME,
      providers: ['openai'],
      ...overrides,
    });
  }

  it('is deterministic', () => {
    expect(hash()).toBe(hash());
  });

  it('returns a 16-char hex digest', () => {
    const h = hash();
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is independent of tool key order', () => {
    const reordered = [
      {
        description: 'Look up weather',
        parameters: {
          required: ['city'],
          properties: { city: { type: 'string' } },
          type: 'object',
        },
        type: 'function',
        name: 'lookup_weather',
      },
    ];
    expect(hash({ toolDefinitions: reordered })).toBe(hash());
  });

  it('is independent of tool list order', () => {
    const a = [
      { type: 'function', name: 'a', parameters: { type: 'object' } },
      { type: 'function', name: 'b', parameters: { type: 'object' } },
    ];
    const b = [...a].reverse();
    expect(hash({ toolDefinitions: a })).toBe(hash({ toolDefinitions: b }));
  });

  it('changes when system prompt changes', () => {
    expect(hash()).not.toBe(
      hash({
        systemInstructions: JSON.stringify([
          { type: 'text', content: 'Different prompt.' },
        ]),
      }),
    );
  });

  it('changes when primary model changes', () => {
    expect(hash()).not.toBe(hash({ primaryModel: 'gpt-4o' }));
  });

  it('changes when temperature changes', () => {
    expect(hash()).not.toBe(
      hash({ runtimeConfig: { ...BASE_RUNTIME, temperature: 0.9 } }),
    );
  });

  it('changes when tool set changes', () => {
    const more = [
      ...BASE_TOOLS,
      { type: 'function', name: 'find_hotels', parameters: { type: 'object' } },
    ];
    expect(hash()).not.toBe(hash({ toolDefinitions: more }));
  });

  it('produces the same digest as the Python SDK for the same inputs', () => {
    // The companion Python test
    // (`sdk/python/tests/test_genai_helpers.py::test_cross_language_consistency_with_typescript_sdk`)
    // computes this exact digest from the equivalent canonical inputs. Pinning
    // it here guarantees that an agent emitted by the Python SDK and the
    // TypeScript SDK with the same definition produces the same
    // `openlit.agent.version_hash` value.
    const h = OpenLitHelper.computeAgentVersionHash({
      systemInstructions: [{ type: 'text', content: 'ping' }],
      toolDefinitions: [
        {
          type: 'function',
          name: 'echo',
          description: 'Echo a message',
          parameters: {
            type: 'object',
            properties: { msg: { type: 'string' } },
          },
        },
      ],
      primaryModel: 'gpt-4o-mini',
      runtimeConfig: { temperature: 0.0, top_p: 1.0, max_tokens: 256 },
      providers: ['openai'],
    });
    expect(h).toBe('040e364c33aa3dde');
  });

  it('matches manually computed canonical payload', () => {
    // Lock the canonical payload shape so any future drift in
    // `computeAgentVersionHash` requires a deliberate test update.
    const payload = {
      cfg: {
        max_tokens: 512,
        provider: 'openai',
        temperature: 0.2,
        top_p: 1,
      },
      model: 'gpt-4o-mini',
      sp: BASE_PROMPT,
      tools: [
        {
          n: 'lookup_weather',
          s: {
            properties: { city: { type: 'string' } },
            required: ['city'],
            type: 'object',
          },
        },
      ],
    };
    const expected = createHash('sha1')
      .update(JSON.stringify(payload))
      .digest('hex')
      .slice(0, 16);
    expect(hash()).toBe(expected);
  });
});
