import { Span, trace } from '@opentelemetry/api';
import VllmWrapper from '../vllm/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';


jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('VllmWrapper', () => {
  let span: Span;

  beforeEach(() => {
    span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    span.addEvent = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    span.end();
  });

  describe('_chat', () => {
    it('should call recordMetrics after span ends', async () => {
      const mockArgs = [{ messages: [{ role: 'user', content: 'test message' }] }];
      const mockResponse = {
        id: 'chatcmpl-123',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        choices: [
          {
            message: { content: 'response text', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
      };
      const mockGenAIEndpoint = 'vllm.chat';

      jest
        .spyOn(VllmWrapper, '_chatCommonSetter')
        .mockImplementationOnce(async ({ genAIEndpoint, span }) => {
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, 1);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);

          return {
            genAIEndpoint,
            model: 'facebook/opt-125m',
            cost: 0.0,
            aiSystem: SemanticConvention.GEN_AI_SYSTEM_VLLM,
            serverAddress: '127.0.0.1',
            serverPort: 8000,
          };
        });

      await VllmWrapper._chat({
        args: mockArgs,
        genAIEndpoint: mockGenAIEndpoint,
        response: mockResponse,
        span,
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        genAIEndpoint: mockGenAIEndpoint,
        model: 'facebook/opt-125m',
        cost: 0.0,
        aiSystem: SemanticConvention.GEN_AI_SYSTEM_VLLM,
        serverAddress: '127.0.0.1',
        serverPort: 8000,
      });
    });
  });

  describe('_chatCommonSetter', () => {
    it('should set span attributes and return metric parameters', async () => {
      const mockArgs = [
        {
          model: 'facebook/opt-125m',
          messages: [{ role: 'user', content: 'test message' }],
          max_tokens: 100,
          temperature: 0.7,
          top_p: 1,
          presence_penalty: 2,
          frequency_penalty: 3,
          seed: 3,
          stream: false,
          stop: ['STOP'],
        },
      ];

      const mockResult = {
        id: 'chatcmpl-123',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        choices: [
          {
            message: { content: 'response text', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
      };

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.0);

      const metricParams = await VllmWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_P, 1);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 2);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 3);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_SEED, 3);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, ['STOP']);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'facebook/opt-125m');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);

      expect(metricParams).toEqual({
        genAIEndpoint: 'vllm.chat',
        model: 'facebook/opt-125m',
        cost: 0.0,
        aiSystem: SemanticConvention.GEN_AI_SYSTEM_VLLM,
        serverAddress: '127.0.0.1',
        serverPort: 8000,
      });
    });

    it('should NOT set sentinel values for optional request params', async () => {
      const mockArgs = [
        {
          model: 'facebook/opt-125m',
          messages: [{ role: 'user', content: 'test' }],
          stream: false,
        },
      ];

      const mockResult = {
        id: 'chatcmpl-456',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 5, completion_tokens: 10 },
        choices: [
          {
            message: { content: 'test response', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
      };

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      await VllmWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        result: mockResult,
        span,
      });

      const setAttrCalls = (span.setAttribute as jest.Mock).mock.calls;
      const attrKeys = setAttrCalls.map((c: any[]) => c[0]);

      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_SEED);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT);
    });

    it('should handle tool calls properly', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'test message' }],
          tools: [{ type: 'function', function: { name: 'get_weather' } }],
        },
      ];

      const mockResult = {
        id: 'chatcmpl-123',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
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
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.0);

      await VllmWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_TOOL_NAME, 'get_weather');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_TOOL_CALL_ID, 'call_123');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_TOOL_ARGS, '{"location":"SF"}');
    });

    it('should emit inference event when events not disabled', async () => {
      const mockArgs = [
        {
          model: 'facebook/opt-125m',
          messages: [{ role: 'user', content: 'test message' }],
          stream: false,
        },
      ];

      const mockResult = {
        id: 'chatcmpl-789',
        model: 'facebook/opt-125m',
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        choices: [
          {
            message: { content: 'response text', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
      };

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = false;
      (OpenlitConfig as any).disableEvents = false;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      jest.spyOn(OpenLitHelper, 'emitInferenceEvent').mockImplementation(() => {});

      await VllmWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        result: mockResult,
        span,
      });

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalledWith(
        span,
        expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'facebook/opt-125m',
          [SemanticConvention.GEN_AI_RESPONSE_MODEL]: 'facebook/opt-125m',
          [SemanticConvention.SERVER_ADDRESS]: '127.0.0.1',
          [SemanticConvention.SERVER_PORT]: 8000,
          [SemanticConvention.GEN_AI_RESPONSE_ID]: 'chatcmpl-789',
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 10,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: 20,
        })
      );
    });
  });

  describe('Cross-Language Trace Comparison', () => {
    it('should use vllm as provider name (matching Python SDK)', () => {
      expect(VllmWrapper.aiSystem).toBe('vllm');
      expect(VllmWrapper.aiSystem).toBe(SemanticConvention.GEN_AI_SYSTEM_VLLM);
    });

    it('should use port 8000 as default (matching vLLM default server port)', () => {
      expect(VllmWrapper.serverPort).toBe(8000);
    });

    it('should set same attributes as Python SDK for chat completion', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'What is vLLM?' }],
          model: 'facebook/opt-125m',
          max_tokens: 50,
          temperature: 0.7,
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'chatcmpl-test-id',
        model: 'facebook/opt-125m',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'vLLM is...' },
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 15,
        },
      };

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = true;
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.0);
      jest.spyOn(OpenLitHelper, 'buildInputMessages').mockReturnValue('[]');
      jest.spyOn(OpenLitHelper, 'buildOutputMessages').mockReturnValue('[]');

      await VllmWrapper._chat({
        args: mockArgs,
        genAIEndpoint: 'vllm.chat',
        response: mockResponse,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 8);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 15);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'facebook/opt-125m');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 50);

      // Must NOT set total tokens (not in OpenAI-compatible vLLM response)
      const setAttrCalls = (span.setAttribute as jest.Mock).mock.calls;
      const attrKeys = setAttrCalls.map((c: any[]) => c[0]);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE);
    });
  });
});