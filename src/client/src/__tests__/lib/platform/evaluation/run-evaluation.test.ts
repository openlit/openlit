// Mock all AI SDK packages before any imports to prevent TransformStream/eventsource-parser errors
jest.mock('ai', () => ({ generateText: jest.fn() }));
jest.mock('@ai-sdk/openai', () => ({ createOpenAI: jest.fn() }));
jest.mock('@ai-sdk/anthropic', () => ({ createAnthropic: jest.fn() }));
jest.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: jest.fn() }));
jest.mock('@ai-sdk/mistral', () => ({ createMistral: jest.fn() }));
jest.mock('@ai-sdk/cohere', () => ({ createCohere: jest.fn() }));

import { runEvaluation } from '@/lib/platform/evaluation/run-evaluation';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createCohere } from '@ai-sdk/cohere';

const mockModelInstance = { id: 'mock-model' };
const makeProviderFactory = () => jest.fn().mockReturnValue(mockModelInstance);

beforeEach(() => {
  jest.clearAllMocks();
  (createOpenAI as jest.Mock).mockReturnValue(makeProviderFactory());
  (createAnthropic as jest.Mock).mockReturnValue(makeProviderFactory());
  (createGoogleGenerativeAI as jest.Mock).mockReturnValue(makeProviderFactory());
  (createMistral as jest.Mock).mockReturnValue(makeProviderFactory());
  (createCohere as jest.Mock).mockReturnValue(makeProviderFactory());
  (generateText as jest.Mock).mockResolvedValue({
    text: JSON.stringify({
      success: true,
      result: [{ score: 0.1, evaluation: 'Hallucination', classification: 'none', explanation: 'ok', verdict: 'no' }],
    }),
    usage: { inputTokens: 100, outputTokens: 50 },
  });
});

const BASE_PARAMS = { provider: 'openai', model: 'gpt-4', apiKey: 'sk-test' };

describe('runEvaluation — early return for missing params', () => {
  it('returns failure when apiKey is missing', async () => {
    const result = await runEvaluation({ ...BASE_PARAMS, apiKey: '' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('returns failure when provider is missing', async () => {
    const result = await runEvaluation({ ...BASE_PARAMS, provider: '' });
    expect(result.success).toBe(false);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('returns failure when model is missing', async () => {
    const result = await runEvaluation({ ...BASE_PARAMS, model: '' });
    expect(result.success).toBe(false);
    expect(generateText).not.toHaveBeenCalled();
  });

  it('includes DEFAULT_RESULT in the early-return response', async () => {
    const result = await runEvaluation({ ...BASE_PARAMS, apiKey: '' });
    expect(Array.isArray(result.result)).toBe(true);
    expect(result.result!.length).toBeGreaterThan(0);
    expect(result.result![0].evaluation).toBe('Hallucination');
  });
});

describe('runEvaluation — provider routing', () => {
  it('creates an OpenAI model for provider=openai', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'openai' });
    expect(createOpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  it('creates an Anthropic model for provider=anthropic', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'anthropic' });
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  it('creates a Google model for provider=google', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'google' });
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  it('creates a Mistral model for provider=mistral', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'mistral' });
    expect(createMistral).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  it('creates a Cohere model for provider=cohere', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'cohere' });
    expect(createCohere).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });

  it('creates OpenAI-compatible model for provider=groq', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'groq' });
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.groq.com/openai/v1' }));
  });

  it('creates OpenAI-compatible model for provider=perplexity', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'perplexity' });
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.perplexity.ai' }));
  });

  it('creates OpenAI-compatible model for provider=deepseek', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'deepseek' });
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.deepseek.com' }));
  });

  it('creates OpenAI-compatible model for provider=xai', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'xai' });
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.x.ai/v1' }));
  });

  it('creates OpenAI-compatible model for provider=together', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'together' });
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.together.xyz/v1' }));
  });

  it('creates OpenAI-compatible model for provider=fireworks', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'fireworks' });
    expect(createOpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.fireworks.ai/inference/v1' }));
  });

  it('maps gemini provider alias to google', async () => {
    await runEvaluation({ ...BASE_PARAMS, provider: 'gemini' });
    expect(createGoogleGenerativeAI).toHaveBeenCalled();
  });

  it('throws for unsupported provider via catch block', async () => {
    const result = await runEvaluation({ ...BASE_PARAMS, provider: 'unknown-provider' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('unknown-provider');
  });
});

describe('runEvaluation — generateText and response parsing', () => {
  it('returns success with parsed result and usage', async () => {
    const result = await runEvaluation(BASE_PARAMS);
    expect(result.success).toBe(true);
    expect(result.result).toHaveLength(1);
    expect(result.result![0].evaluation).toBe('Hallucination');
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
  });

  it('maps outputTokens to completionTokens from usage', async () => {
    (generateText as jest.Mock).mockResolvedValue({
      text: JSON.stringify({ success: true, result: [{ score: 0, evaluation: 'Bias', classification: 'none', explanation: 'ok', verdict: 'no' }] }),
      usage: { inputTokens: 200, outputTokens: 80 },
    });
    const result = await runEvaluation(BASE_PARAMS);
    expect(result.usage).toEqual({ promptTokens: 200, completionTokens: 80 });
  });

  it('returns undefined usage when usage tokens are null', async () => {
    (generateText as jest.Mock).mockResolvedValue({
      text: JSON.stringify({ success: true, result: [{ score: 0, evaluation: 'Toxicity', classification: 'none', explanation: 'ok', verdict: 'no' }] }),
      usage: {},
    });
    const result = await runEvaluation(BASE_PARAMS);
    expect(result.usage).toBeUndefined();
  });

  it('returns failure when parsed result is empty array', async () => {
    (generateText as jest.Mock).mockResolvedValue({
      text: JSON.stringify({ success: true, result: [] }),
      usage: {},
    });
    const result = await runEvaluation(BASE_PARAMS);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid response format');
  });

  it('returns failure when parsed result is not an array', async () => {
    (generateText as jest.Mock).mockResolvedValue({
      text: JSON.stringify({ success: true, result: null }),
      usage: {},
    });
    const result = await runEvaluation(BASE_PARAMS);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid response format');
  });

  it('respects success: false in parsed response', async () => {
    (generateText as jest.Mock).mockResolvedValue({
      text: JSON.stringify({
        success: false,
        result: [{ score: 0.9, evaluation: 'Hallucination', classification: 'factual_inaccuracy', explanation: 'bad', verdict: 'yes' }],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const result = await runEvaluation(BASE_PARAMS);
    expect(result.success).toBe(false);
  });

  it('catches invalid JSON and returns failure with DEFAULT_RESULT', async () => {
    (generateText as jest.Mock).mockResolvedValue({ text: 'not-json', usage: {} });
    const result = await runEvaluation(BASE_PARAMS);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(Array.isArray(result.result)).toBe(true);
  });

  it('catches generateText throwing and returns failure', async () => {
    (generateText as jest.Mock).mockRejectedValue(new Error('Network failure'));
    const result = await runEvaluation(BASE_PARAMS);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network failure');
  });

  it('catches non-Error throws and stringifies them', async () => {
    (generateText as jest.Mock).mockRejectedValue('plain string error');
    const result = await runEvaluation(BASE_PARAMS);
    expect(result.success).toBe(false);
    expect(result.error).toBe('plain string error');
  });

  it('passes thresholdScore into the system prompt via generateText call', async () => {
    await runEvaluation({ ...BASE_PARAMS, thresholdScore: 0.7 });
    const [{ prompt }] = (generateText as jest.Mock).mock.calls[0];
    expect(prompt).toContain('0.7');
  });

  it('uses temperature=0 for deterministic output', async () => {
    await runEvaluation(BASE_PARAMS);
    const [callArgs] = (generateText as jest.Mock).mock.calls[0];
    expect(callArgs.temperature).toBe(0);
  });

  it('system prompt uses generic TypeA/TypeB examples, not hardcoded eval type names', async () => {
    await runEvaluation(BASE_PARAMS);
    const [{ prompt }] = (generateText as jest.Mock).mock.calls[0];

    // The JSON example in the prompt should use generic placeholders
    expect(prompt).toContain('TypeA');
    expect(prompt).toContain('TypeB');

    // The prompt template itself should NOT hardcode specific evaluation type names
    // (the actual type names come from contexts, not from the template)
    const templateWithoutContexts = prompt.split('Contexts:')[0];
    expect(templateWithoutContexts).not.toContain('"Hallucination"');
    expect(templateWithoutContexts).not.toContain('"Bias"');
    expect(templateWithoutContexts).not.toContain('"Toxicity"');
  });

  it('system prompt instructs to scan for [X evaluation context] blocks dynamically', async () => {
    await runEvaluation(BASE_PARAMS);
    const [{ prompt }] = (generateText as jest.Mock).mock.calls[0];

    // The prompt should instruct the model to scan for evaluation type blocks dynamically
    expect(prompt).toContain('[X evaluation context]');
    expect(prompt).toContain('EVERY evaluation type present');
  });
});
