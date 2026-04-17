// Mock ai package before anything else
jest.mock('ai', () => ({
  streamText: jest.fn(),
  generateText: jest.fn(),
  stepCountIs: jest.fn(() => () => false),
  tool: jest.fn((t: any) => t),
  jsonSchema: jest.fn((s: any) => s),
}));

import { getModelInstance, formatStreamError, buildConversationMessages } from '@/lib/platform/chat/stream';

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

import { getConversationMessages } from '@/lib/platform/chat/conversation';

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
