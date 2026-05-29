import { Span, trace } from '@opentelemetry/api';
import BedrockWrapper from '../bedrock/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('BedrockWrapper', () => {
  let span: Span;

  beforeEach(() => {
    span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    span.end();
  });

  describe('_converseComplete', () => {
    it('should call recordMetrics after span ends', async () => {
      const input = {
        modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        messages: [{ role: 'user', content: [{ text: 'test' }] }],
      };
      const mockResponse = {
        output: { message: { role: 'assistant', content: [{ text: 'Hello' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 20 },
        $metadata: { requestId: 'req-123' },
      };

      jest.spyOn(BaseWrapper, 'recordMetrics').mockImplementation(() => {});
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);

      await BedrockWrapper._converseComplete({
        input,
        genAIEndpoint: 'bedrock.converse',
        response: mockResponse,
        span,
        modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        genAIEndpoint: 'bedrock.converse',
        model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        cost: 0.5,
        aiSystem: 'aws.bedrock',
      });
    });

    it('should re-throw errors from commonSetter', async () => {
      jest.spyOn(BaseWrapper, 'recordMetrics').mockImplementation(() => {});
      jest.spyOn(BedrockWrapper, '_converseCommonSetter').mockImplementationOnce(() => {
        throw new Error('test error');
      });

      await expect(
        BedrockWrapper._converseComplete({
          input: {},
          genAIEndpoint: 'bedrock.converse',
          response: {},
          span,
          modelId: 'test-model',
        })
      ).rejects.toThrow('test error');
    });
  });

  describe('_converseCommonSetter', () => {
    it('should set span attributes and return metric parameters', () => {
      const input = {
        modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        messages: [{ role: 'user', content: [{ text: 'test message' }] }],
        inferenceConfig: { temperature: 0.7, maxTokens: 100, topP: 0.9 },
      };
      const mockResult = {
        output: { message: { role: 'assistant', content: [{ text: 'Hello' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 20 },
        $metadata: { requestId: 'req-123' },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);

      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      const metricParams = BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        isStream: false,
      });

      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_ID, 'req-123');
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_P, 0.9);
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['stop']
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_MODEL,
        'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        'text'
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
        expect.anything()
      );
      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
        expect.anything()
      );
      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
        expect.anything()
      );

      expect(metricParams).toEqual({
        genAIEndpoint: 'bedrock.converse',
        model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        cost: 0.5,
        aiSystem: 'aws.bedrock',
      });
    });

    it('should map Bedrock finish reasons to OTel standard', () => {
      const makeResult = (stopReason: string) => ({
        output: { message: { content: [{ text: 'hi' }] } },
        stopReason,
        usage: { inputTokens: 5, outputTokens: 5 },
      });

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      const testCases = [
        { bedrock: 'end_turn', otel: 'stop' },
        { bedrock: 'max_tokens', otel: 'max_tokens' },
        { bedrock: 'stop_sequence', otel: 'stop' },
        { bedrock: 'tool_use', otel: 'tool_calls' },
        { bedrock: 'content_filtered', otel: 'content_filter' },
        { bedrock: 'guardrail_intervention', otel: 'content_filter' },
      ];

      for (const { bedrock, otel } of testCases) {
        jest.clearAllMocks();
        span.setAttribute = jest.fn();

        BedrockWrapper._converseCommonSetter({
          input: { messages: [] },
          genAIEndpoint: 'bedrock.converse',
          result: makeResult(bedrock),
          span,
          modelId: 'test-model',
          isStream: false,
        });

        expect(span.setAttribute).toHaveBeenCalledWith(
          SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
          [otel]
        );
      }
    });

    it('should not set max_tokens when not provided', () => {
      const input = { messages: [], inferenceConfig: { temperature: 1 } };
      const mockResult = {
        output: { message: { content: [{ text: 'hi' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 5 },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'test-model',
        isStream: false,
      });

      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        expect.anything()
      );
    });

    it('should not set frequency/presence penalty when not provided', () => {
      const input = { messages: [], inferenceConfig: {} };
      const mockResult = {
        output: { message: { content: [{ text: 'hi' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 5 },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'test-model',
        isStream: false,
      });

      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        expect.anything()
      );
      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
        expect.anything()
      );
    });

    it('should emit inference event when events are enabled', () => {
      const input = {
        modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        messages: [{ role: 'user', content: [{ text: 'hello' }] }],
      };
      const mockResult = {
        output: { message: { content: [{ text: 'Hi there' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 20 },
        $metadata: { requestId: 'req-123' },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = false;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);
      const emitSpy = jest.spyOn(OpenLitHelper, 'emitInferenceEvent').mockImplementation(() => {});

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        isStream: false,
      });

      expect(emitSpy).toHaveBeenCalledWith(span, expect.objectContaining({
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        [SemanticConvention.SERVER_ADDRESS]: 'bedrock-runtime.amazonaws.com',
        [SemanticConvention.SERVER_PORT]: 443,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: 'req-123',
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: 'text',
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 10,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: 20,
      }));
    });

    it('should not emit event when events are disabled', () => {
      const input = { messages: [] };
      const mockResult = {
        output: { message: { content: [{ text: 'hi' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 5 },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const emitSpy = jest.spyOn(OpenLitHelper, 'emitInferenceEvent').mockImplementation(() => {});

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'test-model',
        isStream: false,
      });

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should set tool call attributes when toolUse blocks are present', () => {
      const input = { messages: [] };
      const mockResult = {
        output: {
          message: {
            content: [
              { text: '' },
              { toolUse: { toolUseId: 'tool_123', name: 'get_weather', input: { location: 'Paris' } } },
            ],
          },
        },
        stopReason: 'tool_use',
        usage: { inputTokens: 10, outputTokens: 20 },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'test-model',
        isStream: false,
      });

      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_NAME,
        'get_weather'
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_CALL_ID,
        'tool_123'
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['tool_calls']
      );
    });

    it('should set cache token attributes when present', () => {
      const input = { messages: [] };
      const mockResult = {
        output: { message: { content: [{ text: 'cached response' }] } },
        stopReason: 'end_turn',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 3,
          cacheWriteInputTokens: 5,
        },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'test-model',
        isStream: false,
      });

      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        3
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        5
      );
    });

    it('should not set cache token attributes when zero', () => {
      const input = { messages: [] };
      const mockResult = {
        output: { message: { content: [{ text: 'response' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 20 },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'test-model',
        isStream: false,
      });

      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        expect.anything()
      );
      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        expect.anything()
      );
    });

    it('should set system instructions when system block is present and captureContent is true', () => {
      const input = {
        messages: [{ role: 'user', content: [{ text: 'hello' }] }],
        system: [{ text: 'You are a helpful assistant.' }],
      };
      const mockResult = {
        output: { message: { content: [{ text: 'Hi!' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 5 },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = true;
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      jest.spyOn(OpenLitHelper, 'buildInputMessages').mockReturnValue('[]');
      jest.spyOn(OpenLitHelper, 'buildOutputMessages').mockReturnValue('[]');
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'test-model',
        isStream: false,
      });

      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
        JSON.stringify([{ type: 'text', content: 'You are a helpful assistant.' }])
      );
    });

    it('should use OpenlitConfig.pricingInfo for cost calculation', () => {
      const input = { messages: [] };
      const mockResult = {
        output: { message: { content: [{ text: 'response' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 50 },
      };

      const mockPricingInfo = { chat: { 'test-model': { promptPrice: 0.01, completionPrice: 0.02 } } };
      (OpenlitConfig as any).pricingInfo = mockPricingInfo;
      (OpenlitConfig as any).disableEvents = true;
      const costSpy = jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(1.5);

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'test-model',
        isStream: false,
      });

      expect(costSpy).toHaveBeenCalledWith('test-model', mockPricingInfo, 100, 50);
    });

    it('should set TTFT and TBT when provided for streaming', () => {
      const input = { messages: [] };
      const mockResult = {
        output: { message: { content: [{ text: 'response' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 5 },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse_stream',
        result: mockResult,
        span,
        modelId: 'test-model',
        isStream: true,
        ttft: 0.15,
        tbt: 0.05,
      });

      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_SERVER_TTFT, 0.15);
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_SERVER_TBT, 0.05);
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
    });

    it('should not set TTFT and TBT when zero', () => {
      const input = { messages: [] };
      const mockResult = {
        output: { message: { content: [{ text: 'response' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 5, outputTokens: 5 },
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      BedrockWrapper._converseCommonSetter({
        input,
        genAIEndpoint: 'bedrock.converse',
        result: mockResult,
        span,
        modelId: 'test-model',
        isStream: false,
      });

      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_SERVER_TTFT,
        expect.anything()
      );
      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_SERVER_TBT,
        expect.anything()
      );
    });
  });
});
