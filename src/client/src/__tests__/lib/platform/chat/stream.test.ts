// Mock ai package before anything else
jest.mock('ai', () => ({
  streamText: jest.fn(),
  generateText: jest.fn(),
  stepCountIs: jest.fn(() => () => false),
  tool: jest.fn((t: any) => t),
  jsonSchema: jest.fn((s: any) => s),
}));

import { getModelInstance, formatStreamError, buildConversationMessages, streamChatMessage } from '@/lib/platform/chat/stream';

// Mock external dependencies
jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => (model: string) => ({ model, provider: 'openai' })),
}));
jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: jest.fn(() => (model: string) => ({ model, provider: 'anthropic' })),
}));
jest.mock('@ai-sdk/google', () => ({
  google: (model: string) => ({ model, provider: 'google' }),
}));
jest.mock('@ai-sdk/mistral', () => ({
  createMistral: jest.fn(() => (model: string) => ({ model, provider: 'mistral' })),
}));
jest.mock('@ai-sdk/cohere', () => ({
  createCohere: jest.fn(() => (model: string) => ({ model, provider: 'cohere' })),
}));
jest.mock('@/lib/platform/chat/conversation', () => ({
  addMessage: jest.fn(),
  getConversationMessages: jest.fn(),
  updateConversation: jest.fn(),
}));
jest.mock('@/lib/platform/chat/schema-context', () => ({
  getChatSystemPrompt: jest.fn(() => 'system prompt'),
}));
jest.mock('@/lib/platform/chat/sql-validator', () => ({
  validateSQL: jest.fn(),
  extractSQLFromResponse: jest.fn(() => []),
}));
jest.mock('@/lib/platform/common', () => ({
  dataCollector: jest.fn(),
}));
jest.mock('@/lib/platform/chat/tools', () => ({
  getChatTools: jest.fn(() => ({})),
}));

import { streamText, generateText } from 'ai';
import { dataCollector } from '@/lib/platform/common';
import { addMessage, getConversationMessages, updateConversation } from '@/lib/platform/chat/conversation';
import { extractSQLFromResponse, validateSQL } from '@/lib/platform/chat/sql-validator';

async function* streamParts(parts: any[]) {
  for (const part of parts) {
    yield part;
  }
}

describe('getModelInstance', () => {
  it('creates OpenAI model instance', () => {
    const instance = getModelInstance('openai', 'sk-test', 'gpt-4o');
    expect(instance).toEqual({ model: 'gpt-4o', provider: 'openai' });
  });

  it('creates Anthropic model instance', () => {
    const instance = getModelInstance('anthropic', 'sk-test', 'claude-3');
    expect(instance).toEqual({ model: 'claude-3', provider: 'anthropic' });
  });

  it('creates Google model instance', () => {
    const instance = getModelInstance('google', 'key', 'gemini-pro');
    expect(instance).toEqual({ model: 'gemini-pro', provider: 'google' });
  });

  it('throws for unsupported provider', () => {
    expect(() => getModelInstance('nonexistent', 'key', 'model')).toThrow('not supported');
  });

  it('supports groq via OpenAI-compatible endpoint', () => {
    const instance = getModelInstance('groq', 'key', 'llama-3');
    expect(instance).toBeDefined();
  });

  it('supports all 14 providers', () => {
    const providers = [
      'openai', 'anthropic', 'google', 'mistral', 'cohere',
      'groq', 'perplexity', 'azure', 'together', 'fireworks',
      'deepseek', 'xai', 'huggingface', 'replicate',
    ];
    for (const p of providers) {
      expect(() => getModelInstance(p, 'key', 'model')).not.toThrow();
    }
  });
});

describe('formatStreamError', () => {
  it('returns specific message for 401', () => {
    const msg = formatStreamError({ statusCode: 401 });
    expect(msg).toContain('Invalid API key');
  });

  it('returns specific message for invalid_api_key code', () => {
    const msg = formatStreamError({ data: { error: { code: 'invalid_api_key' } } });
    expect(msg).toContain('Invalid API key');
  });

  it('returns specific message for 429', () => {
    expect(formatStreamError({ statusCode: 429 })).toContain('Rate limit');
  });

  it('returns specific message for 403', () => {
    expect(formatStreamError({ statusCode: 403 })).toContain('Access denied');
  });

  it('returns specific message for 404', () => {
    expect(formatStreamError({ statusCode: 404 })).toContain('Model not found');
  });

  it('returns specific message for 500+', () => {
    expect(formatStreamError({ statusCode: 500 })).toContain('provider is experiencing issues');
    expect(formatStreamError({ statusCode: 503 })).toContain('provider is experiencing issues');
  });

  it('strips long tokens from error messages', () => {
    const msg = formatStreamError({ message: 'Key: sk-abcdefghijklmnopqrstuvwxyz1234567890 is invalid' });
    expect(msg).toContain('***');
    expect(msg).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('returns generic message for unknown errors', () => {
    expect(formatStreamError({})).toContain('An error occurred');
  });
});

describe('buildConversationMessages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns current message when no history', async () => {
    (getConversationMessages as jest.Mock).mockResolvedValue({ data: [] });
    const messages = await buildConversationMessages('c1', 'Hello');
    expect(messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('includes history messages', async () => {
    (getConversationMessages as jest.Mock).mockResolvedValue({
      data: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'New message' },
      ],
    });
    const messages = await buildConversationMessages('c1', 'New message');
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: 'Hi' });
    expect(messages[2]).toEqual({ role: 'user', content: 'New message' });
  });

  it('appends current message if not in history', async () => {
    (getConversationMessages as jest.Mock).mockResolvedValue({
      data: [{ role: 'user', content: 'Old message' }],
    });
    const messages = await buildConversationMessages('c1', 'Brand new');
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe('Brand new');
  });

  it('does not duplicate current message if already in history', async () => {
    (getConversationMessages as jest.Mock).mockResolvedValue({
      data: [{ role: 'user', content: 'Same message' }],
    });
    const messages = await buildConversationMessages('c1', 'Same message');
    expect(messages).toHaveLength(1);
  });
});

describe('streamChatMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (addMessage as jest.Mock).mockResolvedValue({ data: 'msg-id' });
    (updateConversation as jest.Mock).mockResolvedValue({ err: null });
    (getConversationMessages as jest.Mock).mockResolvedValue({
      data: [
        { role: 'user', content: 'Earlier question' },
        { role: 'user', content: 'Show traces' },
      ],
    });
    (extractSQLFromResponse as jest.Mock).mockReturnValue([]);
    (validateSQL as jest.Mock).mockReturnValue({ valid: false });
    (dataCollector as jest.Mock).mockResolvedValue({ data: [], err: null });
    (generateText as jest.Mock).mockResolvedValue({ text: 'Trace Summary' });
  });

  it('streams text, enriches SQL query results, and saves assistant stats', async () => {
    const response = 'Here is SQL:\n```sql\nSELECT 1\n```';
    (extractSQLFromResponse as jest.Mock).mockReturnValue(['SELECT 1']);
    (validateSQL as jest.Mock).mockReturnValue({ valid: true, query: 'SELECT 1' });
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ one: 1 }], err: null });
    (streamText as jest.Mock).mockImplementation(({ onFinish }) => {
      onFinish({
        text: response,
        usage: { inputTokens: 100, outputTokens: 20 },
        steps: [],
      });
      return {
        fullStream: streamParts([
          { type: 'text-delta', text: 'Here is SQL:\n' },
          { type: 'text-delta', text: '```sql\nSELECT 1\n```' },
        ]),
      };
    });

    const result = await streamChatMessage({
      conversationId: 'c1',
      content: 'Show traces',
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      userId: 'u1',
      dbConfigId: 'db1',
    });

    expect(result.streamError).toBeNull();
    expect(result.responseText).toContain('```query-result');
    expect(result.responseText).toContain('"one":1');
    expect(dataCollector).toHaveBeenCalledWith({
      query: 'SELECT 1',
      enable_readonly: true,
    });
    expect(updateConversation).toHaveBeenCalledWith('c1', {
      addPromptTokens: 100,
      addCompletionTokens: 20,
      addCost: 0.0006,
      incrementMessages: true,
    });
    expect(addMessage).toHaveBeenLastCalledWith({
      conversationId: 'c1',
      role: 'assistant',
      content: expect.stringContaining('```query-result'),
      promptTokens: 100,
      completionTokens: 20,
      cost: 0.0006,
    });
  });

  it('saves a sanitized error response when streaming fails before text arrives', async () => {
    (streamText as jest.Mock).mockImplementation(({ onError }) => {
      onError({ error: { statusCode: 401 } });
      return { fullStream: streamParts([]) };
    });

    const result = await streamChatMessage({
      conversationId: 'c1',
      content: 'Hello',
      provider: 'openai',
      apiKey: 'bad-key',
      model: 'gpt-4o',
      userId: 'u1',
      dbConfigId: 'db1',
    });

    expect(result.responseText).toContain('Invalid API key');
    expect(addMessage).toHaveBeenLastCalledWith({
      conversationId: 'c1',
      role: 'assistant',
      content: expect.stringContaining('Invalid API key'),
    });
  });

  it('uses tool-result fallback content when no text deltas are streamed', async () => {
    (streamText as jest.Mock).mockImplementation(({ onFinish }) => {
      onFinish({
        text: '',
        usage: { inputTokens: 0, outputTokens: 0 },
        steps: [],
      });
      return {
        fullStream: streamParts([
          {
            type: 'tool-result',
            result: { success: true, message: 'Secret stored', details: 'Key: API_KEY' },
          },
        ]),
      };
    });

    const result = await streamChatMessage({
      conversationId: 'c1',
      content: 'Store secret',
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      userId: 'u1',
      dbConfigId: 'db1',
    });

    expect(result.responseText).toContain('**Secret stored**');
    expect(result.responseText).toContain('Key: API_KEY');
  });

  it('generates a title for the first message using onFinish tool summaries', async () => {
    (getConversationMessages as jest.Mock).mockResolvedValue({
      data: [{ role: 'user', content: 'Create a rule' }],
    });
    (generateText as jest.Mock).mockResolvedValue({ text: '"Rule Created"' });
    (streamText as jest.Mock).mockImplementation(({ onFinish }) => {
      onFinish({
        text: '',
        usage: { inputTokens: 1, outputTokens: 1 },
        steps: [
          {
            toolResults: [
              { result: { success: true, message: 'Rule created', details: 'ID: rule-1' } },
              { result: { success: false, error: 'secondary warning' } },
            ],
          },
        ],
      });
      return {
        fullStream: streamParts([
          {
            type: 'tool-result',
            result: { success: true, message: 'Rule created', details: 'ID: rule-1' },
          },
        ]),
      };
    });

    await streamChatMessage({
      conversationId: 'c1',
      content: 'Create a rule',
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      userId: 'u1',
      dbConfigId: 'db1',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Rule created'),
        maxOutputTokens: 20,
      })
    );
    expect(updateConversation).toHaveBeenCalledWith('c1', {
      title: 'Rule Created',
    });
  });

  it('falls back to a truncated title when title generation fails', async () => {
    const longPrompt = 'Explain the longest running trace in the current project';
    (getConversationMessages as jest.Mock).mockResolvedValue({
      data: [{ role: 'user', content: longPrompt }],
    });
    (generateText as jest.Mock).mockRejectedValue(new Error('title failed'));
    (streamText as jest.Mock).mockImplementation(({ onFinish }) => {
      onFinish({
        text: 'Trace analysis',
        usage: { inputTokens: 1, outputTokens: 1 },
        steps: [],
      });
      return {
        fullStream: streamParts([{ type: 'text-delta', text: 'Trace analysis' }]),
      };
    });

    await streamChatMessage({
      conversationId: 'c1',
      content: longPrompt,
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      userId: 'u1',
      dbConfigId: 'db1',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateConversation).toHaveBeenCalledWith('c1', {
      title: `${longPrompt.slice(0, 50)}...`,
    });
  });

  it('appends query results when a SQL block cannot be replaced exactly', async () => {
    (extractSQLFromResponse as jest.Mock).mockReturnValue(['SELECT 1']);
    (validateSQL as jest.Mock).mockReturnValue({ valid: true, query: 'SELECT 1' });
    (dataCollector as jest.Mock).mockResolvedValue({ data: [{ one: 1 }], err: null });
    (streamText as jest.Mock).mockImplementation(({ onFinish }) => {
      onFinish({
        text: 'Run SELECT 1',
        usage: { inputTokens: 1, outputTokens: 1 },
        steps: [],
      });
      return {
        fullStream: streamParts([{ type: 'text-delta', text: 'Run SELECT 1' }]),
      };
    });

    const result = await streamChatMessage({
      conversationId: 'c1',
      content: 'Run SQL',
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      userId: 'u1',
      dbConfigId: 'db1',
    });

    expect(result.responseText).toBe('Run SELECT 1\n\n```query-result\n[{"one":1}]\n```');
  });

  it('continues when SQL execution throws', async () => {
    (extractSQLFromResponse as jest.Mock).mockReturnValue(['SELECT 1']);
    (validateSQL as jest.Mock).mockReturnValue({ valid: true, query: 'SELECT 1' });
    (dataCollector as jest.Mock).mockRejectedValue(new Error('db unavailable'));
    (streamText as jest.Mock).mockImplementation(({ onFinish }) => {
      onFinish({
        text: '```sql\nSELECT 1\n```',
        usage: { inputTokens: 1, outputTokens: 1 },
        steps: [],
      });
      return {
        fullStream: streamParts([{ type: 'text-delta', text: '```sql\nSELECT 1\n```' }]),
      };
    });

    const result = await streamChatMessage({
      conversationId: 'c1',
      content: 'Run SQL',
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      userId: 'u1',
      dbConfigId: 'db1',
    });

    expect(result.responseText).toBe('```sql\nSELECT 1\n```');
  });
});
