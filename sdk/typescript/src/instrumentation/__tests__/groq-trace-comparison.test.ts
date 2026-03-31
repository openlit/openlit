/**
 * Cross-Language Trace Comparison Tests for Groq Integration
 *
 * These tests verify that TypeScript and Python generate equivalent traces
 * for the same operations.
 */

import GroqWrapper from '../groq/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('Groq Cross-Language Trace Comparison', () => {
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

    (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.001);
    (OpenLitHelper as any).openaiTokens = jest.fn().mockReturnValue(5);
    (OpenLitHelper as any).handleException = jest.fn();
    (OpenLitHelper as any).createStreamProxy = jest.fn().mockImplementation((stream, generator) => stream);
    (OpenLitHelper as any).buildInputMessages = jest.fn().mockReturnValue('[{"role":"user","parts":[{"type":"text","content":"Test"}]}]');
    (OpenLitHelper as any).buildOutputMessages = jest.fn().mockReturnValue('[{"role":"assistant","parts":[{"type":"text","content":"Response"}],"finish_reason":"stop"}]');
    (OpenLitHelper as any).emitInferenceEvent = jest.fn();

    (BaseWrapper as any).recordMetrics = jest.fn();
    (BaseWrapper as any).setBaseSpanAttributes = jest.fn().mockImplementation((span, attrs) => {
      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, attrs.aiSystem);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, attrs.model);
      if (attrs.cost !== undefined) {
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, attrs.cost);
      }
      if (attrs.serverAddress) {
        span.setAttribute(SemanticConvention.SERVER_ADDRESS, attrs.serverAddress);
      }
      if (attrs.serverPort !== undefined) {
        span.setAttribute(SemanticConvention.SERVER_PORT, attrs.serverPort);
      }
      span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, '1.9.0');
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Chat Completion Trace Consistency', () => {
    it('should set same attributes as Python SDK', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'What is LLM Observability?' }],
          model: 'llama-3.1-8b-instant',
          max_tokens: 100,
          temperature: 0.7,
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test-id-123',
        created: Date.now(),
        model: 'llama-3.1-8b-instant',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'LLM Observability is...' },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, 'groq');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MODEL, 'llama-3.1-8b-instant');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'llama-3.1-8b-instant');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_ID, 'test-id-123');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'text');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'api.groq.com');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 443);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_SDK_VERSION, '1.9.0');
    });

    it('should NOT set total_tokens or client.token.usage on span', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test',
        model: 'llama-3.1-8b-instant',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      const setAttributeCalls = (mockSpan.setAttribute as jest.Mock).mock.calls;
      const attributeKeys = setAttributeCalls.map(([key]: [string]) => key);

      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE);
    });

    it('should not set sentinel values for optional params', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test',
        model: 'llama-3.1-8b-instant',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      const setAttributeCalls = (mockSpan.setAttribute as jest.Mock).mock.calls;
      const attributeKeys = setAttributeCalls.map(([key]: [string]) => key);

      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_SEED);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES);
      expect(attributeKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT);
    });

    it('should set conditional params only when explicitly provided', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
          max_tokens: 200,
          seed: 42,
          frequency_penalty: 0.5,
          presence_penalty: 0.3,
          stop: ['END'],
          n: 2,
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test',
        model: 'llama-3.1-8b-instant',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 200);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_SEED, 42);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 0.5);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 0.3);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, ['END']);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, 2);
    });

    it('should emit inference event via LoggerProvider', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test-id',
        model: 'llama-3.1-8b-instant',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'llama-3.1-8b-instant',
          [SemanticConvention.GEN_AI_RESPONSE_MODEL]: 'llama-3.1-8b-instant',
          [SemanticConvention.SERVER_ADDRESS]: 'api.groq.com',
          [SemanticConvention.SERVER_PORT]: 443,
          [SemanticConvention.GEN_AI_RESPONSE_ID]: 'test-id',
          [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 5,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: 10,
        })
      );
    });

    it('should include message content in event when captureMessageContent is true', async () => {
      (OpenlitConfig as any).captureMessageContent = true;

      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test-id',
        model: 'llama-3.1-8b-instant',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          [SemanticConvention.GEN_AI_INPUT_MESSAGES]: expect.any(String),
          [SemanticConvention.GEN_AI_OUTPUT_MESSAGES]: expect.any(String),
        })
      );
    });

    it('should NOT include message content in event when captureMessageContent is false', async () => {
      (OpenlitConfig as any).captureMessageContent = false;

      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test-id',
        model: 'llama-3.1-8b-instant',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      const eventCall = (OpenLitHelper.emitInferenceEvent as jest.Mock).mock.calls[0];
      const eventAttrs = eventCall[1];
      expect(eventAttrs).not.toHaveProperty(SemanticConvention.GEN_AI_INPUT_MESSAGES);
      expect(eventAttrs).not.toHaveProperty(SemanticConvention.GEN_AI_OUTPUT_MESSAGES);
    });

    it('should handle tool calls properly', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'What is the weather?' }],
          model: 'llama-3.1-8b-instant',
          tools: [{ type: 'function', function: { name: 'get_weather' } }],
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test-id',
        model: 'llama-3.1-8b-instant',
        choices: [
          {
            message: {
              content: null,
              role: 'assistant',
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"location":"SF"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_NAME,
        'get_weather'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_CALL_ID,
        'call_123'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_ARGS,
        '{"location":"SF"}'
      );
    });

    it('should set system_fingerprint when present', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test-id',
        model: 'llama-3.1-8b-instant',
        system_fingerprint: 'fp_groq_test',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_SYSTEM_FINGERPRINT,
        'fp_groq_test'
      );
    });

    it('should record metrics via BaseWrapper.recordMetrics', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test',
        model: 'llama-3.1-8b-instant',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          genAIEndpoint: 'groq.chat.completions',
          model: 'llama-3.1-8b-instant',
          aiSystem: 'groq',
        })
      );
    });

    it('should use OpenlitConfig.pricingInfo for cost calculation', async () => {
      (OpenlitConfig as any).pricingInfo = { chat: { 'llama-3.1-8b-instant': { promptPrice: 0.05, completionPrice: 0.08 } } };

      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'test',
        model: 'llama-3.1-8b-instant',
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      };

      await GroqWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockResponse,
        span: mockSpan,
      });

      expect(OpenLitHelper.getChatModelCost).toHaveBeenCalledWith(
        'llama-3.1-8b-instant',
        expect.any(Object),
        100,
        50
      );
    });
  });

  describe('Streaming Chat Completion', () => {
    it('should set streaming attributes matching Python SDK', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test streaming' }],
          model: 'llama-3.1-8b-instant',
          stream: true,
        },
      ];

      async function* mockStream() {
        yield {
          id: 'test-id',
          created: Date.now(),
          model: 'llama-3.1-8b-instant',
          choices: [{ delta: { content: 'Hello' } }],
        };
        yield {
          id: 'test-id',
          created: Date.now(),
          model: 'llama-3.1-8b-instant',
          choices: [{ delta: { content: ' world' } }],
        };
      }

      const generator = GroqWrapper._chatCompletionGenerator({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockStream(),
        span: mockSpan,
      });

      for await (const _ of generator) {
        // consume
      }

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, 'groq');
    });

    it('should handle x_groq usage data in streaming', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Test' }],
          model: 'llama-3.1-8b-instant',
          stream: true,
        },
      ];

      async function* mockStream() {
        yield {
          id: 'test-id',
          created: Date.now(),
          model: 'llama-3.1-8b-instant',
          choices: [{ delta: { content: 'Hello' } }],
        };
        yield {
          id: 'test-id',
          created: Date.now(),
          model: 'llama-3.1-8b-instant',
          choices: [{ delta: { content: '' }, finish_reason: 'stop' }],
          x_groq: {
            usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
          },
        };
      }

      const generator = GroqWrapper._chatCompletionGenerator({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockStream(),
        span: mockSpan,
      });

      for await (const _ of generator) {
        // consume
      }

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 15);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 25);
    });

    it('should handle tool calls in streaming', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'Get the weather' }],
          model: 'llama-3.1-8b-instant',
          stream: true,
        },
      ];

      async function* mockStream() {
        yield {
          id: 'test-id',
          created: Date.now(),
          model: 'llama-3.1-8b-instant',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_abc',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"loc' },
              }],
            },
          }],
        };
        yield {
          id: 'test-id',
          created: Date.now(),
          model: 'llama-3.1-8b-instant',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: 'ation":"SF"}' },
              }],
            },
          }],
        };
        yield {
          id: 'test-id',
          created: Date.now(),
          model: 'llama-3.1-8b-instant',
          choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        };
      }

      const generator = GroqWrapper._chatCompletionGenerator({
        args: mockArgs,
        genAIEndpoint: 'groq.chat.completions',
        response: mockStream(),
        span: mockSpan,
      });

      for await (const _ of generator) {
        // consume
      }

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_NAME,
        'get_weather'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_CALL_ID,
        'call_abc'
      );
    });
  });

  describe('Span Creation Attributes', () => {
    it('should use aiSystem from SemanticConvention.GEN_AI_SYSTEM_GROQ', () => {
      expect(GroqWrapper.aiSystem).toBe(SemanticConvention.GEN_AI_SYSTEM_GROQ);
      expect(GroqWrapper.aiSystem).toBe('groq');
    });

    it('should set correct server address and port', () => {
      expect(GroqWrapper.serverAddress).toBe('api.groq.com');
      expect(GroqWrapper.serverPort).toBe(443);
    });
  });
});
