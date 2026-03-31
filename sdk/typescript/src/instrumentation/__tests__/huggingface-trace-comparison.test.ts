/**
 * Cross-Language Trace Comparison Tests for HuggingFace Inference Integration
 *
 * Verifies that the TypeScript SDK generates traces consistent with
 * OTel GenAI semantic conventions and the OpenAI reference wrapper pattern.
 */

import HuggingFaceWrapper from '../huggingface/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('HuggingFace Cross-Language Trace Comparison', () => {
  let mockSpan: any;
  let mockTracer: any;

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      addEvent: jest.fn(),
      end: jest.fn(),
      setStatus: jest.fn(),
    };

    mockTracer = {
      startSpan: jest.fn().mockReturnValue(mockSpan),
    };

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenlitConfig as any).pricingInfo = {};
    (OpenlitConfig as any).disableEvents = false;

    (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.0005);
    (OpenLitHelper as any).generalTokens = jest.fn().mockReturnValue(8);
    (OpenLitHelper as any).buildInputMessages = jest.fn().mockReturnValue('[]');
    (OpenLitHelper as any).buildOutputMessages = jest.fn().mockReturnValue('[]');
    (OpenLitHelper as any).handleException = jest.fn();
    (OpenLitHelper as any).emitInferenceEvent = jest.fn();
    (OpenLitHelper as any).createStreamProxy = jest.fn().mockImplementation((stream, _gen) => stream);

    (BaseWrapper as any).recordMetrics = jest.fn();
    (BaseWrapper as any).setBaseSpanAttributes = jest.fn().mockImplementation((span: any, attrs: any) => {
      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, attrs.aiSystem);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, attrs.model);
      if (attrs.cost !== undefined) span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, attrs.cost);
      if (attrs.serverAddress) span.setAttribute(SemanticConvention.SERVER_ADDRESS, attrs.serverAddress);
      if (attrs.serverPort !== undefined) span.setAttribute(SemanticConvention.SERVER_PORT, attrs.serverPort);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Span Creation ──────────────────────────────────────────────────────────

  describe('Span Creation', () => {
    it('should create span with name "{operation} {model}"', () => {
      const patchedFn = HuggingFaceWrapper._patchChatCompletion(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue({
        id: 'test', model: 'meta-llama/Meta-Llama-3-8B-Instruct',
        choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      });
      const wrapped = patchedFn(originalMethod);
      wrapped.call({}, { model: 'meta-llama/Meta-Llama-3-8B-Instruct', messages: [] });

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'chat meta-llama/Meta-Llama-3-8B-Instruct',
        expect.objectContaining({
          kind: expect.any(Number),
          attributes: expect.objectContaining({
            [SemanticConvention.GEN_AI_OPERATION]: 'chat',
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: 'huggingface',
            [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'meta-llama/Meta-Llama-3-8B-Instruct',
            [SemanticConvention.SERVER_ADDRESS]: 'api-inference.huggingface.co',
            [SemanticConvention.SERVER_PORT]: 443,
          }),
        })
      );
    });

    it('should create text generation span with name "text_completion {model}"', () => {
      const patchedFn = HuggingFaceWrapper._patchTextGeneration(mockTracer);
      const originalMethod = jest.fn().mockResolvedValue({ generated_text: 'result' });
      const wrapped = patchedFn(originalMethod);
      wrapped.call({}, { model: 'gpt2', inputs: 'test' });

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'text_completion gpt2',
        expect.objectContaining({
          attributes: expect.objectContaining({
            [SemanticConvention.GEN_AI_OPERATION]: 'text_completion',
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: 'huggingface',
            [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'gpt2',
          }),
        })
      );
    });
  });

  // ── Chat Completion ───────────────────────────────────────────────────────

  describe('Chat Completion', () => {
    const mockArgs = [
      {
        model: 'meta-llama/Meta-Llama-3-8B-Instruct',
        messages: [{ role: 'user', content: 'What is LLM Observability?' }],
        max_tokens: 100,
        temperature: 0.7,
        stream: false,
      },
    ];

    const mockResponse = {
      id: 'hf-chat-123',
      created: Date.now(),
      model: 'meta-llama/Meta-Llama-3-8B-Instruct',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'LLM Observability is...' },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 25, total_tokens: 37 },
    };

    it('should set gen_ai.provider.name = "huggingface" via setBaseSpanAttributes', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(BaseWrapper.setBaseSpanAttributes).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({ aiSystem: 'huggingface' })
      );
    });

    it('should set token usage attributes without sentinel total_tokens', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 12);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 25);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, expect.anything()
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, expect.anything()
      );
    });

    it('should set server.address and server.port via setBaseSpanAttributes', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(BaseWrapper.setBaseSpanAttributes).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          serverAddress: 'api-inference.huggingface.co',
          serverPort: 443,
        })
      );
    });

    it('should set request params: temperature, max_tokens, top_p, is_stream', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_P, 1);
    });

    it('should conditionally set frequency_penalty, presence_penalty, seed, stop', async () => {
      const argsWithExtras = [
        {
          ...mockArgs[0],
          frequency_penalty: 0.5,
          presence_penalty: 0.3,
          seed: 42,
          stop: ['\n'],
          n: 2,
        },
      ];

      await HuggingFaceWrapper._chatCompletion({
        args: argsWithExtras,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 0.5);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 0.3);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_SEED, 42);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, ['\n']);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, 2);
    });

    it('should NOT set frequency_penalty or presence_penalty when 0', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: [{ ...mockArgs[0], frequency_penalty: 0, presence_penalty: 0 }],
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, expect.anything()
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, expect.anything()
      );
    });

    it('should set finish_reason and output_type', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['stop']
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      );
    });

    it('should emit inference event via emitInferenceEvent', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: 'chat',
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'meta-llama/Meta-Llama-3-8B-Instruct',
          [SemanticConvention.GEN_AI_RESPONSE_MODEL]: 'meta-llama/Meta-Llama-3-8B-Instruct',
          [SemanticConvention.SERVER_ADDRESS]: 'api-inference.huggingface.co',
          [SemanticConvention.SERVER_PORT]: 443,
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 12,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: 25,
        })
      );
    });

    it('should not emit event when disableEvents=true', async () => {
      (OpenlitConfig as any).disableEvents = true;

      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(OpenLitHelper.emitInferenceEvent).not.toHaveBeenCalled();
    });

    it('should call recordMetrics after span ends', async () => {
      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.end).toHaveBeenCalled();
      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          genAIEndpoint: 'huggingface.chat.completions',
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          aiSystem: 'huggingface',
        })
      );
    });

    it('should use OpenlitConfig.pricingInfo for cost calculation', async () => {
      (OpenlitConfig as any).pricingInfo = { chat: {} };

      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(OpenLitHelper.getChatModelCost).toHaveBeenCalledWith(
        'meta-llama/Meta-Llama-3-8B-Instruct',
        { chat: {} },
        12,
        25
      );
    });
  });

  // ── Error Handling ─────────────────────────────────────────────────────────

  describe('Error Handling', () => {
    it('should record metrics with errorType on catch path', async () => {
      const patchedFn = HuggingFaceWrapper._patchChatCompletion(mockTracer);
      const error = new TypeError('network failure');
      const originalMethod = jest.fn().mockRejectedValue(error);
      const wrapped = patchedFn(originalMethod);

      await expect(
        wrapped.call({}, { model: 'test-model', messages: [] })
      ).rejects.toThrow('network failure');

      expect(OpenLitHelper.handleException).toHaveBeenCalledWith(mockSpan, error);
      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          errorType: 'TypeError',
          model: 'test-model',
          aiSystem: 'huggingface',
          serverAddress: 'api-inference.huggingface.co',
          serverPort: 443,
        })
      );
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record metrics with errorType on text generation error', async () => {
      const patchedFn = HuggingFaceWrapper._patchTextGeneration(mockTracer);
      const error = new RangeError('out of bounds');
      const originalMethod = jest.fn().mockRejectedValue(error);
      const wrapped = patchedFn(originalMethod);

      await expect(
        wrapped.call({}, { model: 'gpt2', inputs: 'test' })
      ).rejects.toThrow('out of bounds');

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          errorType: 'RangeError',
          model: 'gpt2',
          aiSystem: 'huggingface',
        })
      );
    });
  });

  // ── Streaming ─────────────────────────────────────────────────────────────

  describe('Streaming Chat Completion', () => {
    it('should set is_stream=true and accumulate content across chunks', async () => {
      const mockArgs = [
        {
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        },
      ];

      async function* mockStream() {
        yield {
          id: 'hf-stream-1',
          created: Date.now(),
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          choices: [{ delta: { content: 'Hello' } }],
        };
        yield {
          id: 'hf-stream-1',
          created: Date.now(),
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }],
        };
      }

      const generator = HuggingFaceWrapper._chatCompletionGenerator({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockStream(),
        span: mockSpan,
      });

      for await (const _ of generator) { /* consume */ }

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
      expect(mockSpan.end).toHaveBeenCalled();
      expect(BaseWrapper.recordMetrics).toHaveBeenCalled();
      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalled();
    });

    it('should handle tool call deltas across streaming chunks', async () => {
      const mockArgs = [
        {
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          messages: [{ role: 'user', content: 'Weather?' }],
          stream: true,
        },
      ];

      async function* mockStream() {
        yield {
          id: 'hf-stream-tc',
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"loc' },
              }],
            },
          }],
        };
        yield {
          id: 'hf-stream-tc',
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '":"SF"}' },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        };
      }

      const generator = HuggingFaceWrapper._chatCompletionGenerator({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockStream(),
        span: mockSpan,
      });

      for await (const _ of generator) { /* consume */ }

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_NAME, 'get_weather'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_CALL_ID, 'call_1'
      );
    });
  });

  // ── Text Generation ───────────────────────────────────────────────────────

  describe('Text Generation', () => {
    it('should set text_completion operation and correct attributes', async () => {
      const mockArgs = [
        {
          model: 'gpt2',
          inputs: 'The meaning of life is',
          parameters: { max_new_tokens: 50, temperature: 0.9 },
        },
      ];

      const mockResponse = { generated_text: 'The meaning of life is 42.' };

      await HuggingFaceWrapper._textGeneration({
        args: mockArgs,
        genAIEndpoint: 'huggingface.text.generation',
        response: mockResponse,
        span: mockSpan,
      });

      expect(BaseWrapper.setBaseSpanAttributes).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({ aiSystem: 'huggingface' })
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 50);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.9);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['stop']
      );
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should use OTel message format for input/output content', async () => {
      const mockArgs = [
        {
          model: 'gpt2',
          inputs: 'The meaning of life is',
          parameters: {},
        },
      ];
      const mockResponse = { generated_text: '42.' };

      await HuggingFaceWrapper._textGeneration({
        args: mockArgs,
        genAIEndpoint: 'huggingface.text.generation',
        response: mockResponse,
        span: mockSpan,
      });

      expect(OpenLitHelper.buildInputMessages).toHaveBeenCalledWith(
        [{ role: 'user', content: 'The meaning of life is' }]
      );
      expect(OpenLitHelper.buildOutputMessages).toHaveBeenCalledWith('42.', 'stop');

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        expect.any(String)
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        expect.any(String)
      );
    });

    it('should emit inference event for text generation', async () => {
      const mockArgs = [
        {
          model: 'gpt2',
          inputs: 'test',
          parameters: {},
        },
      ];
      const mockResponse = { generated_text: 'result' };

      await HuggingFaceWrapper._textGeneration({
        args: mockArgs,
        genAIEndpoint: 'huggingface.text.generation',
        response: mockResponse,
        span: mockSpan,
      });

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: 'text_completion',
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'gpt2',
          [SemanticConvention.GEN_AI_OUTPUT_TYPE]: SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
        })
      );
    });

    it('should not set legacy content attributes', async () => {
      const mockArgs = [
        {
          model: 'gpt2',
          inputs: 'The meaning of life is',
          parameters: {},
        },
      ];
      const mockResponse = { generated_text: '42.' };

      await HuggingFaceWrapper._textGeneration({
        args: mockArgs,
        genAIEndpoint: 'huggingface.text.generation',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
        expect.anything()
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
        expect.anything()
      );
    });

    it('should not set total_tokens or client.token.usage (legacy)', async () => {
      const mockArgs = [
        {
          model: 'gpt2',
          inputs: 'test',
          parameters: {},
        },
      ];
      const mockResponse = { generated_text: 'result' };

      await HuggingFaceWrapper._textGeneration({
        args: mockArgs,
        genAIEndpoint: 'huggingface.text.generation',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
        expect.anything()
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
        expect.anything()
      );
    });
  });

  // ── Content Gating ─────────────────────────────────────────────────────────

  describe('Content capture gating', () => {
    it('should not set input/output messages when captureMessageContent=false', async () => {
      (OpenlitConfig as any).captureMessageContent = false;

      const mockArgs = [
        {
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          messages: [{ role: 'user', content: 'Secret' }],
          stream: false,
        },
      ];
      const mockResponse = {
        id: 'hf-123',
        model: 'meta-llama/Meta-Llama-3-8B-Instruct',
        choices: [{ message: { content: 'Reply' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      };

      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_INPUT_MESSAGES, expect.anything()
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES, expect.anything()
      );
    });

    it('should still emit event even when captureMessageContent=false', async () => {
      (OpenlitConfig as any).captureMessageContent = false;

      const mockArgs = [
        {
          model: 'meta-llama/Meta-Llama-3-8B-Instruct',
          messages: [{ role: 'user', content: 'Secret' }],
          stream: false,
        },
      ];
      const mockResponse = {
        id: 'hf-123',
        model: 'meta-llama/Meta-Llama-3-8B-Instruct',
        choices: [{ message: { content: 'Reply' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      };

      await HuggingFaceWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'huggingface.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalled();
    });
  });
});
