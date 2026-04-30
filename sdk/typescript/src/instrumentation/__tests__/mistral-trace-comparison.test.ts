import { Span, trace } from '@opentelemetry/api';
import MistralWrapper from '../mistral/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('MistralWrapper', () => {
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

  describe('_chatCompletion', () => {
    it('should call recordMetrics after span ends', async () => {
      const mockArgs = [{ messages: [{ role: 'user', content: 'test message' }] }];
      const mockResponse = {
        id: '123',
        model: 'mistral-small-latest',
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        choices: [
          {
            message: { content: 'response text', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
      };
      const mockGenAIEndpoint = 'mistral.chat.completions';
      jest
        .spyOn(MistralWrapper, '_chatCompletionCommonSetter')
        .mockImplementationOnce(async ({ genAIEndpoint, span }) => {
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, 1);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);

          return {
            genAIEndpoint,
            model: 'mistral-small-latest',
            user: 'test-user',
            cost: 0.5,
            aiSystem: SemanticConvention.GEN_AI_SYSTEM_MISTRAL,
          };
        });

      await MistralWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: mockGenAIEndpoint,
        response: mockResponse,
        span,
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        genAIEndpoint: mockGenAIEndpoint,
        model: 'mistral-small-latest',
        user: 'test-user',
        cost: 0.5,
        aiSystem: SemanticConvention.GEN_AI_SYSTEM_MISTRAL,
      });
    });
  });

  describe('_chatCompletionCommonSetter', () => {
    it('should set span attributes and return metric parameters', async () => {
      const mockArgs = [
        {
          model: 'mistral-small-latest',
          messages: [{ role: 'user', content: 'test message' }],
          max_tokens: 100,
          temperature: 0.7,
          top_p: 1,
          user: 'test-user',
          presence_penalty: 2,
          frequency_penalty: 3,
          seed: 3,
          stream: false,
          stop: ['STOP'],
        },
      ];

      const mockResult = {
        id: '123',
        model: 'mistral-small-latest',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
        choices: [
          {
            message: { content: 'response text', role: 'assistant' },
            finish_reason: 'stop',
          },
        ],
      };
      const mockGenAIEndpoint = 'mistral.chat.completions';

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);

      const metricParams = await MistralWrapper._chatCompletionCommonSetter({
        args: mockArgs,
        genAIEndpoint: mockGenAIEndpoint,
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_P, 1);
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        100
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
        0.7
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
        2
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        3
      );
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_SEED, 3);
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
        false
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        ['STOP']
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_MODEL,
        'mistral-small-latest'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
        10
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
        20
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['stop']
      );

      expect(metricParams).toEqual({
        genAIEndpoint: mockGenAIEndpoint,
        model: 'mistral-small-latest',
        user: 'test-user',
        cost: 0.5,
        aiSystem: SemanticConvention.GEN_AI_SYSTEM_MISTRAL,
      });
    });

    it('should NOT set sentinel values for optional request params', async () => {
      const mockArgs = [
        {
          model: 'mistral-small-latest',
          messages: [{ role: 'user', content: 'test' }],
          stream: false,
        },
      ];

      const mockResult = {
        id: '456',
        model: 'mistral-small-latest',
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
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

      await MistralWrapper._chatCompletionCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'mistral.chat.completions',
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
        id: '123',
        model: 'mistral-small-latest',
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
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
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);

      await MistralWrapper._chatCompletionCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'mistral.chat.completions',
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_NAME,
        'get_weather'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_CALL_ID,
        'call_123'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_ARGS,
        '{"location":"SF"}'
      );
    });

    it('should emit inference event when events not disabled', async () => {
      const mockArgs = [
        {
          model: 'mistral-small-latest',
          messages: [{ role: 'user', content: 'test message' }],
          stream: false,
        },
      ];

      const mockResult = {
        id: '789',
        model: 'mistral-small-latest',
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
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

      await MistralWrapper._chatCompletionCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'mistral.chat.completions',
        result: mockResult,
        span,
      });

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalledWith(
        span,
        expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'mistral-small-latest',
          [SemanticConvention.GEN_AI_RESPONSE_MODEL]: 'mistral-small-latest',
          [SemanticConvention.SERVER_ADDRESS]: 'api.mistral.ai',
          [SemanticConvention.SERVER_PORT]: 443,
          [SemanticConvention.GEN_AI_RESPONSE_ID]: '789',
          [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 10,
          [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: 20,
        })
      );
    });
  });

  describe('Cross-Language Trace Comparison', () => {
    it('should use mistral_ai as provider name (matching Python SDK)', () => {
      expect(MistralWrapper.aiSystem).toBe('mistral_ai');
      expect(MistralWrapper.aiSystem).toBe(SemanticConvention.GEN_AI_SYSTEM_MISTRAL);
    });

    it('should set same attributes as Python SDK for chat completion', async () => {
      const mockArgs = [
        {
          messages: [{ role: 'user', content: 'What is Mistral AI?' }],
          model: 'mistral-small-latest',
          max_tokens: 50,
          temperature: 0.7,
          stream: false,
        },
      ];

      const mockResponse = {
        id: 'mistral-test-id',
        created: Date.now(),
        model: 'mistral-small-latest',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Mistral AI is...' },
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 15,
          total_tokens: 23,
        },
      };

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = true;
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.001);
      jest.spyOn(OpenLitHelper, 'buildInputMessages').mockReturnValue('[]');
      jest.spyOn(OpenLitHelper, 'buildOutputMessages').mockReturnValue('[]');

      await MistralWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: 'mistral.chat.completions',
        response: mockResponse,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 8);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 15);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'mistral-small-latest');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);

      const setAttrCalls = (span.setAttribute as jest.Mock).mock.calls;
      const attrKeys = setAttrCalls.map((c: any[]) => c[0]);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE);
    });

    it('should set embedding attributes matching Python SDK', async () => {
      const mockArgs = [
        {
          model: 'mistral-embed',
          input: 'Test embedding text',
        },
      ];

      const mockResponse = {
        model: 'mistral-embed',
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: {
          prompt_tokens: 3,
          total_tokens: 3,
        },
      };

      jest.restoreAllMocks();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = true;
      jest.spyOn(OpenLitHelper, 'getEmbedModelCost').mockReturnValue(0.0001);

      const mockTracer: any = {
        startSpan: jest.fn().mockReturnValue(span),
      };

      const patchMethod = MistralWrapper._patchEmbedding(mockTracer);
      const wrappedMethod = patchMethod(async () => mockResponse);

      await wrappedMethod.call({}, ...mockArgs);

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 3);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS, ['float']);

      const setAttrCalls = (span.setAttribute as jest.Mock).mock.calls;
      const attrKeys = setAttrCalls.map((c: any[]) => c[0]);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_SERVER_TTFT);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_SERVER_TBT);
    });
  });
});
