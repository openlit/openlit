/**
 * Cross-Language Trace Comparison Tests for Google AI Studio Integration
 */

import { trace } from '@opentelemetry/api';
import GoogleAIWrapper from '../google-ai/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('Google AI Studio Cross-Language Trace Comparison', () => {
  let mockSpan: any;

  beforeEach(() => {
    mockSpan = mockTracer.startSpan('test-span');
    mockSpan.setAttribute = jest.fn();
    mockSpan.addEvent = jest.fn();
    mockSpan.end = jest.fn();
    mockSpan.setStatus = jest.fn();

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenlitConfig as any).pricingInfo = {};
    (OpenlitConfig as any).disableEvents = false;

    (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.001);
    (OpenLitHelper as any).handleException = jest.fn();
    (OpenLitHelper as any).createStreamProxy = jest.fn().mockImplementation((stream, generator) => stream);
    (OpenLitHelper as any).buildInputMessages = jest.fn().mockReturnValue('[{"role":"user","parts":[{"type":"text","content":"What is Gemini?"}]}]');
    (OpenLitHelper as any).buildOutputMessages = jest.fn().mockReturnValue('[{"role":"assistant","parts":[{"type":"text","content":"Gemini is Google\'s AI model"}],"finish_reason":"STOP"}]');
    (OpenLitHelper as any).emitInferenceEvent = jest.fn();

    (BaseWrapper as any).recordMetrics = jest.fn();
    (BaseWrapper as any).setBaseSpanAttributes = jest.fn().mockImplementation((span, attrs) => {
      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, attrs.aiSystem);
      span.setAttribute(SemanticConvention.GEN_AI_ENDPOINT, attrs.genAIEndpoint);
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

  describe('Generate Content Trace Consistency', () => {
    it('should set same attributes as Python SDK', async () => {
      const mockArgs = [
        {
          contents: [
            { role: 'user', parts: [{ text: 'What is Gemini?' }] },
          ],
          config: {
            temperature: 0.7,
            maxOutputTokens: 100,
            topP: 0.95,
          },
        },
      ];

      const mockResponse = {
        response: {
          modelVersion: 'gemini-pro',
          text: () => "Gemini is Google's AI model",
          candidates: [
            {
              content: {
                parts: [{ text: "Gemini is Google's AI model" }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 10,
            totalTokenCount: 15,
          },
        },
      };

      await GoogleAIWrapper._generateContent({
        args: mockArgs,
        genAIEndpoint: 'google.generativeai.models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-pro',
      });

      // Provider name: gcp.gemini (matches OTel semconv well-known value for Google AI Studio)
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL,
        'gcp.gemini'
      );
      // Request model
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MODEL, 'gemini-pro');
      // Response model
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_MODEL, 'gemini-pro');
      // Token usage
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 5);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 10);
      // Server address + port
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_ADDRESS, 'generativelanguage.googleapis.com');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 443);
      // Request params from config
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_P, 0.95);
      // is_stream
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
      // Finish reason as array
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['STOP']);
      // Output type
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_OUTPUT_TYPE, 'text');
    });

    it('should not set sentinel values for unset params', async () => {
      const mockArgs = [
        {
          contents: 'Hello',
          config: {},
        },
      ];

      const mockResponse = {
        response: {
          text: () => 'Hi there!',
          candidates: [{ content: { parts: [{ text: 'Hi there!' }], role: 'model' }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
        },
      };

      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      await GoogleAIWrapper._generateContent({
        args: mockArgs,
        genAIEndpoint: 'google.generativeai.models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
      });

      const setAttrCalls = mockSpan.setAttribute.mock.calls.map((c: any[]) => c[0]);
      expect(setAttrCalls).not.toContain(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE);
      expect(setAttrCalls).not.toContain(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS);
      expect(setAttrCalls).not.toContain(SemanticConvention.GEN_AI_REQUEST_TOP_P);
      expect(setAttrCalls).not.toContain(SemanticConvention.GEN_AI_REQUEST_TOP_K);
      expect(setAttrCalls).not.toContain(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES);
    });

    it('should emit inference event independently of captureMessageContent', async () => {
      (OpenlitConfig as any).captureMessageContent = false;

      const mockArgs = [{ contents: 'Hello', config: {} }];
      const mockResponse = {
        response: {
          text: () => 'Hi!',
          candidates: [{ content: { parts: [{ text: 'Hi!' }], role: 'model' }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        },
      };

      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      await GoogleAIWrapper._generateContent({
        args: mockArgs,
        genAIEndpoint: 'google.generativeai.models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
      });

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalledTimes(1);
      const eventAttrs = (OpenLitHelper.emitInferenceEvent as jest.Mock).mock.calls[0][1];
      expect(eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toBeUndefined();
      expect(eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toBeUndefined();
    });

    it('should call recordMetrics with cost from OpenlitConfig.pricingInfo', async () => {
      (OpenlitConfig as any).pricingInfo = { chat: { 'gemini-pro': { promptPrice: 0.1, completionPrice: 0.2 } } };
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.0025);

      const mockArgs = [{ contents: 'test', config: {} }];
      const mockResponse = {
        response: {
          modelVersion: 'gemini-pro',
          text: () => 'response',
          candidates: [{ content: { parts: [{ text: 'response' }], role: 'model' }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        },
      };

      await GoogleAIWrapper._generateContent({
        args: mockArgs,
        genAIEndpoint: 'google.generativeai.models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-pro',
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          model: 'gemini-pro',
          cost: 0.0025,
          aiSystem: 'gcp.gemini',
        })
      );
    });

    it('should handle function calls matching Python tool attributes', async () => {
      const mockArgs = [{ contents: 'What is the weather?', config: {} }];
      const mockResponse = {
        response: {
          text: () => '',
          candidates: [{
            content: {
              parts: [{
                functionCall: { name: 'get_weather', args: { location: 'NYC' } },
              }],
              role: 'model',
            },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8, totalTokenCount: 13 },
        },
      };

      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      await GoogleAIWrapper._generateContent({
        args: mockArgs,
        genAIEndpoint: 'google.generativeai.models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_NAME,
        'get_weather'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_ARGS,
        '{"location":"NYC"}'
      );
    });
  });
});
