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
