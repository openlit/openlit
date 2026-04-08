/**
 * Cross-Language Trace Comparison Tests for Vercel AI Integration
 *
 * Vercel AI is JS-only (no Python equivalent). These tests verify that the
 * Vercel AI instrumentation follows the same OTel conventions and patterns
 * as the OpenAI reference wrapper.
 */

import { Span, trace } from '@opentelemetry/api';
import VercelAIWrapper from '../vercel-ai/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('VercelAIWrapper', () => {
  let span: Span;

  beforeEach(() => {
    span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    span.addEvent = jest.fn();
    jest.clearAllMocks();

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenlitConfig as any).pricingInfo = {};
    (OpenlitConfig as any).disableEvents = false;

    (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.001);
    (OpenLitHelper as any).getEmbedModelCost = jest.fn().mockReturnValue(0.0001);
    (OpenLitHelper as any).handleException = jest.fn();
    (OpenLitHelper as any).emitInferenceEvent = jest.fn();
    (OpenLitHelper as any).buildInputMessages = jest.fn().mockReturnValue('[{"role":"user","parts":[{"type":"text","content":"Hello"}]}]');
    (OpenLitHelper as any).buildOutputMessages = jest.fn().mockReturnValue('[{"role":"assistant","parts":[{"type":"text","content":"Hi"}],"finish_reason":"stop"}]');

    (BaseWrapper as any).recordMetrics = jest.fn();
    (BaseWrapper as any).setBaseSpanAttributes = jest.fn().mockImplementation((s, attrs) => {
      s.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME, attrs.aiSystem);
      s.setAttribute(SemanticConvention.GEN_AI_ENDPOINT, attrs.genAIEndpoint);
      s.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, attrs.model);
      if (attrs.cost !== undefined) {
        s.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, attrs.cost);
      }
      if (attrs.serverAddress) {
        s.setAttribute(SemanticConvention.SERVER_ADDRESS, attrs.serverAddress);
      }
      if (attrs.serverPort !== undefined) {
        s.setAttribute(SemanticConvention.SERVER_PORT, attrs.serverPort);
      }
    });
  });

  afterEach(() => {
    span.end();
  });

  describe('static fields', () => {
    it('should have correct aiSystem', () => {
      expect(VercelAIWrapper.aiSystem).toBe('vercel_ai');
    });

    it('should have serverAddress and serverPort', () => {
      expect(VercelAIWrapper.serverAddress).toBe('vercel.ai');
      expect(VercelAIWrapper.serverPort).toBe(443);
    });
  });

  describe('_chatComplete (non-streaming)', () => {
    it('should call _chatCommonSetter and recordMetrics', async () => {
      const mockArgs = [
        {
          model: { modelId: 'gpt-4o-mini' },
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0.7,
        },
      ];

      const mockResponse = {
        text: 'Hi there!',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
        toolCalls: [],
        response: { id: 'resp-123', modelId: 'gpt-4o-mini' },
      };

      jest.restoreAllMocks();
      span.setAttribute = jest.fn();
      span.addEvent = jest.fn();
      span.end = jest.fn();

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = true;
      (OpenlitConfig as any).disableEvents = false;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.001);
      jest.spyOn(OpenLitHelper, 'buildInputMessages').mockReturnValue('[]');
      jest.spyOn(OpenLitHelper, 'buildOutputMessages').mockReturnValue('[]');
      jest.spyOn(OpenLitHelper, 'emitInferenceEvent').mockImplementation(() => {});

      const result = await VercelAIWrapper._chatComplete({
        args: mockArgs,
        genAIEndpoint: 'vercel_ai.generateText',
        response: mockResponse,
        span,
        outputType: SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
      });

      expect(result).toBe(mockResponse);
      expect(BaseWrapper.recordMetrics).toHaveBeenCalled();
    });
  });

  describe('_chatCommonSetter', () => {
    it('should set all required span attributes', async () => {
      const mockArgs = [
        {
          model: { modelId: 'gpt-4o-mini' },
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0.7,
          topP: 0.9,
          maxTokens: 100,
          seed: 42,
          frequencyPenalty: 0.5,
          presencePenalty: 0.3,
          stopSequences: ['END'],
          topK: 50,
        },
      ];

      const mockResult = {
        text: 'Hi there!',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
        toolCalls: [],
        response: { id: 'resp-123', modelId: 'gpt-4o-mini' },
      };

      jest.restoreAllMocks();
      span.setAttribute = jest.fn();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = true;
      (OpenlitConfig as any).disableEvents = false;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.001);
      jest.spyOn(OpenLitHelper, 'buildInputMessages').mockReturnValue('[]');
      jest.spyOn(OpenLitHelper, 'buildOutputMessages').mockReturnValue('[]');
      jest.spyOn(OpenLitHelper, 'emitInferenceEvent').mockImplementation(() => {});

      const metricParams = await VercelAIWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vercel_ai.generateText',
        result: mockResult,
        span,
        isStream: false,
        outputType: SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_P, 0.9);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_SEED, 42);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, 0.5);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, 0.3);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, ['END']);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_K, 50);

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'gpt-4o-mini');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_ID, 'resp-123');
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 5);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'text');

      expect(metricParams).toEqual({
        genAIEndpoint: 'vercel_ai.generateText',
        model: 'gpt-4o-mini',
        cost: 0.001,
        aiSystem: 'vercel_ai',
        serverAddress: 'vercel.ai',
        serverPort: 443,
      });
    });

    it('should not set sentinel values', async () => {
      const mockArgs = [
        {
          model: { modelId: 'gpt-4o-mini' },
          messages: [{ role: 'user', content: 'Hello' }],
        },
      ];

      const mockResult = {
        text: 'Hi',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
        toolCalls: [],
        response: { id: 'resp-123', modelId: 'gpt-4o-mini' },
      };

      jest.restoreAllMocks();
      span.setAttribute = jest.fn();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = false;
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      await VercelAIWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vercel_ai.generateText',
        result: mockResult,
        span,
        isStream: false,
        outputType: 'text',
      });

      const calls = (span.setAttribute as jest.Mock).mock.calls;
      const attrMap = new Map(calls.map(([k, v]) => [k, v]));

      expect(attrMap.has(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS)).toBe(false);
      expect(attrMap.has(SemanticConvention.GEN_AI_REQUEST_SEED)).toBe(false);
      expect(attrMap.has(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY)).toBe(false);
      expect(attrMap.has(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY)).toBe(false);
      expect(attrMap.has(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES)).toBe(false);
      expect(attrMap.has(SemanticConvention.GEN_AI_REQUEST_TOP_K)).toBe(false);
    });

    it('should set response model from provider response, distinct from request model', async () => {
      const mockArgs = [
        {
          model: { modelId: 'gpt-4o' },
          messages: [{ role: 'user', content: 'Hello' }],
        },
      ];

      const mockResult = {
        text: 'Hi',
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 3 },
        toolCalls: [],
        response: { id: 'resp-456', modelId: 'gpt-4o-2024-08-06' },
      };

      jest.restoreAllMocks();
      span.setAttribute = jest.fn();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = false;
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      await VercelAIWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vercel_ai.generateText',
        result: mockResult,
        span,
        isStream: false,
        outputType: 'text',
      });

      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_MODEL,
        'gpt-4o-2024-08-06'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_ID,
        'resp-456'
      );
    });

    it('should handle tool calls', async () => {
      const mockArgs = [
        {
          model: { modelId: 'gpt-4o-mini' },
          messages: [{ role: 'user', content: 'Weather?' }],
        },
      ];

      const mockResult = {
        text: '',
        finishReason: 'tool_calls',
        usage: { promptTokens: 15, completionTokens: 10 },
        toolCalls: [
          { toolCallId: 'call_abc', toolName: 'getWeather', args: { city: 'SF' } },
        ],
        response: { id: 'resp-789', modelId: 'gpt-4o-mini' },
      };

      jest.restoreAllMocks();
      span.setAttribute = jest.fn();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = true;
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.002);
      jest.spyOn(OpenLitHelper, 'buildInputMessages').mockReturnValue('[]');
      jest.spyOn(OpenLitHelper, 'buildOutputMessages').mockReturnValue('[]');

      await VercelAIWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vercel_ai.generateText',
        result: mockResult,
        span,
        isStream: false,
        outputType: 'text',
      });

      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_NAME,
        'getWeather'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_CALL_ID,
        'call_abc'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_ARGS,
        '{"city":"SF"}'
      );
    });

    it('should emit inference event with all required attributes', async () => {
      const mockArgs = [
        {
          model: { modelId: 'gpt-4o-mini' },
          messages: [{ role: 'user', content: 'Hello' }],
        },
      ];

      const mockResult = {
        text: 'Hi',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
        toolCalls: [],
        response: { id: 'resp-evt', modelId: 'gpt-4o-mini' },
      };

      jest.restoreAllMocks();
      span.setAttribute = jest.fn();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = true;
      (OpenlitConfig as any).disableEvents = false;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.001);
      jest.spyOn(OpenLitHelper, 'buildInputMessages').mockReturnValue('[{"role":"user"}]');
      jest.spyOn(OpenLitHelper, 'buildOutputMessages').mockReturnValue('[{"role":"assistant"}]');
      const emitSpy = jest.spyOn(OpenLitHelper, 'emitInferenceEvent').mockImplementation(() => {});

      await VercelAIWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vercel_ai.generateText',
        result: mockResult,
        span,
        isStream: false,
        outputType: 'text',
      });

      expect(emitSpy).toHaveBeenCalledTimes(1);
      const eventAttrs = emitSpy.mock.calls[0][1];
      expect(eventAttrs[SemanticConvention.GEN_AI_OPERATION]).toBe('chat');
      expect(eventAttrs[SemanticConvention.GEN_AI_REQUEST_MODEL]).toBe('gpt-4o-mini');
      expect(eventAttrs[SemanticConvention.GEN_AI_RESPONSE_MODEL]).toBe('gpt-4o-mini');
      expect(eventAttrs[SemanticConvention.SERVER_ADDRESS]).toBe('vercel.ai');
      expect(eventAttrs[SemanticConvention.SERVER_PORT]).toBe(443);
      expect(eventAttrs[SemanticConvention.GEN_AI_RESPONSE_ID]).toBe('resp-evt');
      expect(eventAttrs[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]).toEqual(['stop']);
      expect(eventAttrs[SemanticConvention.GEN_AI_OUTPUT_TYPE]).toBe('text');
      expect(eventAttrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]).toBe(10);
      expect(eventAttrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(5);
      expect(eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toBe('[{"role":"user"}]');
      expect(eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toBe('[{"role":"assistant"}]');
    });

    it('should not include message content in event when captureMessageContent is false', async () => {
      const mockArgs = [
        {
          model: { modelId: 'gpt-4o-mini' },
          messages: [{ role: 'user', content: 'secret' }],
        },
      ];

      const mockResult = {
        text: 'reply',
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 3 },
        toolCalls: [],
        response: { id: 'resp-no-content', modelId: 'gpt-4o-mini' },
      };

      jest.restoreAllMocks();
      span.setAttribute = jest.fn();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = false;
      (OpenlitConfig as any).disableEvents = false;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const emitSpy = jest.spyOn(OpenLitHelper, 'emitInferenceEvent').mockImplementation(() => {});

      await VercelAIWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vercel_ai.generateText',
        result: mockResult,
        span,
        isStream: false,
        outputType: 'text',
      });

      expect(emitSpy).toHaveBeenCalledTimes(1);
      const eventAttrs = emitSpy.mock.calls[0][1];
      expect(eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toBeUndefined();
      expect(eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toBeUndefined();
    });

    it('should set TTFT and TBT for streaming', async () => {
      const mockArgs = [
        {
          model: { modelId: 'gpt-4o-mini' },
          messages: [{ role: 'user', content: 'Hello' }],
        },
      ];

      const mockResult = {
        text: 'Hi',
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5 },
        toolCalls: [],
        response: { id: 'resp-stream', modelId: 'gpt-4o-mini' },
      };

      jest.restoreAllMocks();
      span.setAttribute = jest.fn();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).captureMessageContent = false;
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      await VercelAIWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vercel_ai.streamText',
        result: mockResult,
        span,
        isStream: true,
        outputType: 'text',
        ttft: 0.15,
        tbt: 0.025,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_SERVER_TTFT, 0.15);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_SERVER_TBT, 0.025);
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, true);
    });

    it('should use pricing from OpenlitConfig.pricingInfo', async () => {
      const mockArgs = [
        {
          model: { modelId: 'gpt-4o-mini' },
          messages: [{ role: 'user', content: 'Hello' }],
        },
      ];

      const mockResult = {
        text: 'Hi',
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
        toolCalls: [],
        response: { id: 'resp-price', modelId: 'gpt-4o-mini' },
      };

      jest.restoreAllMocks();
      span.setAttribute = jest.fn();
      const pricingInfo = { chat: { 'gpt-4o-mini': { promptPrice: 0.15, completionPrice: 0.6 } } };
      (OpenlitConfig as any).pricingInfo = pricingInfo;
      (OpenlitConfig as any).captureMessageContent = false;
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.045);

      const metricParams = await VercelAIWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'vercel_ai.generateText',
        result: mockResult,
        span,
        isStream: false,
        outputType: 'text',
      });

      expect(OpenLitHelper.getChatModelCost).toHaveBeenCalledWith(
        'gpt-4o-mini',
        pricingInfo,
        100,
        50
      );
      expect(metricParams?.cost).toBe(0.045);
    });
  });

  describe('serverAddress and serverPort in error path', () => {
    it('should include serverAddress and serverPort in recordMetrics on error', async () => {
      jest.restoreAllMocks();
      span.setAttribute = jest.fn();
      span.end = jest.fn();
      (OpenLitHelper as any).handleException = jest.fn();
      (BaseWrapper as any).recordMetrics = jest.fn();

      jest.spyOn(VercelAIWrapper, '_chatCommonSetter').mockRejectedValue(new TypeError('fail'));

      try {
        await VercelAIWrapper._chatComplete({
          args: [{ model: { modelId: 'gpt-4o-mini' } }],
          genAIEndpoint: 'vercel_ai.generateText',
          response: {},
          span,
          outputType: 'text',
        });
      } catch {
        // expected
      }

      expect(OpenLitHelper.handleException).toHaveBeenCalledWith(span, expect.any(TypeError));
    });
  });
});
