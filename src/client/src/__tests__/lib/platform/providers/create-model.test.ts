jest.mock('ai', () => ({}));
jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: jest.fn(() => {
    const provider = (model: string) => ({ model, provider: 'openai', api: 'default' });
    provider.chat = (model: string) => ({ model, provider: 'openai', api: 'chat' });
    return provider;
  }),
}));
jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: jest.fn(() => (model: string) => ({ model, provider: 'anthropic' })),
}));
jest.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: jest.fn(() => (model: string) => ({ model, provider: 'google' })),
}));
jest.mock('@ai-sdk/mistral', () => ({
  createMistral: jest.fn(() => (model: string) => ({ model, provider: 'mistral' })),
}));
jest.mock('@ai-sdk/cohere', () => ({
  createCohere: jest.fn(() => (model: string) => ({ model, provider: 'cohere' })),
}));

import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { CHAT_PROVIDER_IDS, OPENAI_COMPATIBLE_PROVIDER_ID } from '@/constants/chat-providers';
import { createModel } from '@/lib/platform/providers/create-model';
import getMessage from '@/constants/messages';

beforeEach(() => jest.clearAllMocks());

describe('createModel', () => {
  it('creates OpenAI and Anthropic models', () => {
    expect(createModel('openai', 'sk-test', 'gpt-4o')).toMatchObject({ model: 'gpt-4o', provider: 'openai' });
    expect(createModel('anthropic', 'sk-test', 'claude-3')).toEqual({ model: 'claude-3', provider: 'anthropic' });
  });

  it('uses the stored key for Google instead of the ambient env key', () => {
    expect(createModel('google', 'key', 'gemini-pro')).toEqual({ model: 'gemini-pro', provider: 'google' });
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'key' });
  });

  it('throws for unsupported providers, including prototype keys and TypeSafe', () => {
    expect(() => createModel('nonexistent', 'key', 'model')).toThrow('not supported');
    expect(() => createModel('__proto__', 'key', 'model')).toThrow('not supported');
    expect(() => createModel('typesafe', 'key', 'jev-latest')).toThrow('Provider typesafe not supported');
  });

  it('attributes Perplexity requests to OpenLIT', () => {
    createModel('perplexity', 'key', 'sonar');
    expect(createOpenAI).toHaveBeenCalledWith({
      baseURL: 'https://api.perplexity.ai',
      apiKey: 'key',
      headers: { 'X-Pplx-Integration': 'openlit' },
    });
  });

  it('supports every chat provider', () => {
    for (const p of CHAT_PROVIDER_IDS) {
      expect(() => createModel(p, 'key', 'model', 'https://llm.example.com/v1')).not.toThrow();
    }
  });

  it('keeps vendor base URLs for hosted OpenAI-style providers', () => {
    createModel('minimax', 'key', 'MiniMax-M3');
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.minimax.io/v1' })
    );
    createModel('orcarouter', 'sk-orca-test', 'orcarouter/auto');
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.orcarouter.ai/v1' })
    );
  });

  it('never redirects a vendor provider to a supplied base URL', () => {
    createModel('openai', 'sk-test', 'gpt-4o', 'https://attacker.example.com/v1');
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  it('uses the chat API and a guarded fetch for the OpenAI-compatible provider', () => {
    const model = createModel(OPENAI_COMPATIBLE_PROVIDER_ID, 'key', 'llama3', 'https://llm.example.com/v1');
    expect(model).toMatchObject({ api: 'chat', model: 'llama3' });
    expect(createOpenAI).toHaveBeenCalledWith({
      baseURL: 'https://llm.example.com/v1',
      apiKey: 'key',
      fetch: expect.any(Function),
    });
  });

  it('always passes a string key so the SDK cannot fall back to OPENAI_API_KEY', () => {
    createModel(OPENAI_COMPATIBLE_PROVIDER_ID, undefined as unknown as string, 'llama3', 'https://llm.example.com/v1');
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '' }));
  });

  it('requires a base URL for the OpenAI-compatible provider', () => {
    expect(() => createModel(OPENAI_COMPATIBLE_PROVIDER_ID, '', 'llama3')).toThrow(
      getMessage().OPENAI_COMPATIBLE_BASE_URL_REQUIRED
    );
  });
});
