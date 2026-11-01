/**
 * Ollama wrapper tests: prompt cache token reporting.
 *
 * Ollama (v0.33.3+) returns `prompt_eval_cached_count` on the final response
 * when part of the prompt was served from the KV cache. `prompt_eval_count`
 * stays cache-inclusive.
 */

import { Span } from '@opentelemetry/api';
import OllamaWrapper from '../ollama/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('Ollama cached prompt tokens', () => {
  const setAttribute = jest.fn();
  // The wrapper only calls setAttribute/end/setStatus on the span.
  const span = { setAttribute, end: jest.fn(), setStatus: jest.fn() } as unknown as Span;

  const chatArgs = [{ model: 'qwen2.5:0.5b', messages: [{ role: 'user', content: 'Hi' }] }];
  const generateArgs = [{ model: 'qwen2.5:0.5b', prompt: 'Hi' }];

  beforeEach(() => {
    Object.assign(OpenlitConfig, { captureMessageContent: false, pricingInfo: {}, disableEvents: true });
    Object.assign(OpenLitHelper, {
      getChatModelCost: jest.fn().mockReturnValue(0),
      handleException: jest.fn(),
      buildSystemInstructionsFromMessages: jest.fn().mockReturnValue(undefined),
      buildToolDefinitions: jest.fn().mockReturnValue(undefined),
      computeAgentVersionHash: jest.fn().mockReturnValue('ts-test-version-hash'),
    });
    Object.assign(BaseWrapper, { recordMetrics: jest.fn(), setBaseSpanAttributes: jest.fn() });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sets cache read tokens on chat spans when Ollama reports them', async () => {
    await OllamaWrapper._chatCommonSetter({
      args: chatArgs,
      genAIEndpoint: 'ollama.chat',
      result: {
        model: 'qwen2.5:0.5b',
        message: { role: 'assistant', content: 'Hello' },
        done_reason: 'stop',
        prompt_eval_count: 40,
        prompt_eval_cached_count: 32,
        eval_count: 5,
      },
      span,
    });

    expect(setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 40);
    expect(setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 32);
    expect(OpenLitHelper.getChatModelCost).toHaveBeenCalledWith('qwen2.5:0.5b', {}, 40, 5, 32, 0, true);
  });

  it('sets cache read tokens on generate spans when Ollama reports them', async () => {
    await OllamaWrapper._generateCommonSetter({
      args: generateArgs,
      genAIEndpoint: 'ollama.generate',
      result: {
        model: 'qwen2.5:0.5b',
        response: 'Hello',
        done_reason: 'stop',
        prompt_eval_count: 40,
        prompt_eval_cached_count: 32,
        eval_count: 5,
      },
      span,
    });

    expect(setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 32);
    expect(OpenLitHelper.getChatModelCost).toHaveBeenCalledWith('qwen2.5:0.5b', {}, 40, 5, 32, 0, true);
  });

  it('keeps the cached count from the final streamed chat chunk', async () => {
    async function* stream() {
      yield { model: 'qwen2.5:0.5b', message: { role: 'assistant', content: 'Hel' }, done: false };
      yield {
        model: 'qwen2.5:0.5b',
        message: { role: 'assistant', content: 'lo' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 40,
        prompt_eval_cached_count: 32,
        eval_count: 5,
      };
    }

    const gen = OllamaWrapper._chatGenerator({
      args: [{ ...chatArgs[0], stream: true }],
      genAIEndpoint: 'ollama.chat',
      response: stream(),
      span,
    });
    for await (const _chunk of gen) {
      // drain
    }

    expect(setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 32);
  });

  it('keeps the cached count from the final streamed generate chunk', async () => {
    async function* stream() {
      yield { model: 'qwen2.5:0.5b', response: 'Hel', done: false };
      yield {
        model: 'qwen2.5:0.5b',
        response: 'lo',
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 40,
        prompt_eval_cached_count: 32,
        eval_count: 5,
      };
    }

    const gen = OllamaWrapper._generateGenerator({
      args: [{ ...generateArgs[0], stream: true }],
      genAIEndpoint: 'ollama.generate',
      response: stream(),
      span,
    });
    for await (const _chunk of gen) {
      // drain
    }

    expect(setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 32);
  });

  it('leaves cache read tokens unset when Ollama does not report them', async () => {
    await OllamaWrapper._chatCommonSetter({
      args: chatArgs,
      genAIEndpoint: 'ollama.chat',
      result: {
        model: 'qwen2.5:0.5b',
        message: { role: 'assistant', content: 'Hello' },
        done_reason: 'stop',
        prompt_eval_count: 40,
        eval_count: 5,
      },
      span,
    });
    await OllamaWrapper._generateCommonSetter({
      args: generateArgs,
      genAIEndpoint: 'ollama.generate',
      result: { model: 'qwen2.5:0.5b', response: 'Hello', done_reason: 'stop', prompt_eval_count: 40, eval_count: 5 },
      span,
    });

    expect(setAttribute).not.toHaveBeenCalledWith(
      SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
      expect.anything()
    );
  });
});
