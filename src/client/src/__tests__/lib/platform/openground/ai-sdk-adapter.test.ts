jest.mock('ai', () => ({ generateText: jest.fn() }));
jest.mock('@ai-sdk/openai', () => ({ createOpenAI: jest.fn() }));
jest.mock('@ai-sdk/anthropic', () => ({ createAnthropic: jest.fn() }));
jest.mock('@ai-sdk/google', () => ({ google: jest.fn() }));
jest.mock('@ai-sdk/mistral', () => ({ createMistral: jest.fn() }));
jest.mock('@ai-sdk/cohere', () => ({ createCohere: jest.fn() }));

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AISdkAdapter } from '@/lib/platform/openground/ai-sdk-adapter';

it('attributes Perplexity requests to OpenLIT', async () => {
  const model = {};
  (createOpenAI as jest.Mock).mockReturnValue(() => model);
  (generateText as jest.Mock).mockResolvedValue({
    text: 'response',
    usage: { inputTokens: 1, outputTokens: 1 },
    finishReason: 'stop',
  });

  await AISdkAdapter.generateCompletion({
    provider: 'perplexity',
    model: 'sonar',
    apiKey: 'key',
  });

  expect(createOpenAI).toHaveBeenCalledWith({
    baseURL: 'https://api.perplexity.ai',
    apiKey: 'key',
    headers: { 'X-Pplx-Integration': 'openlit' },
  });
});

it('routes Atlas Cloud requests to its OpenAI-compatible endpoint', async () => {
  (createOpenAI as jest.Mock).mockReturnValue(() => ({}));
  (generateText as jest.Mock).mockResolvedValue({
    text: 'response',
    usage: { inputTokens: 1, outputTokens: 2 },
    finishReason: 'stop',
  });

  expect(AISdkAdapter.isProviderSupported('atlascloud')).toBe(true);
  const result = await AISdkAdapter.generateCompletion({
    provider: 'atlascloud',
    model: 'openai/gpt-4.1-mini',
    apiKey: 'key',
  });

  expect(createOpenAI).toHaveBeenCalledWith({
    baseURL: 'https://api.atlascloud.ai/v1',
    apiKey: 'key',
  });
  expect(result.model).toBe('atlascloud/openai/gpt-4.1-mini');
});
