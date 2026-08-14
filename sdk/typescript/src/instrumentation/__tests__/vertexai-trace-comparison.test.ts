/**
 * Cross-Language Trace Comparison Tests for Vertex AI Integration.
 * Verifies the TS SDK emits the same telemetry as the Python SDK's
 * openlit/instrumentation/vertexai/ reference implementation.
 */

import { trace } from '@opentelemetry/api';
import VertexAIWrapper from '../vertexai/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers', () => {
  const actual = jest.requireActual('../../helpers');
  return {
    ...actual,
    getChatModelCost: jest.fn(),
    handleException: jest.fn(),
    buildInputMessages: jest.fn(),
    buildOutputMessages: jest.fn(),
    emitInferenceEvent: jest.fn(),
    buildToolDefinitions: jest.fn(),
    computeAgentVersionHash: jest.fn(),
    isFrameworkLlmActive: jest.fn().mockReturnValue(false),
    getFrameworkParentContext: jest.fn().mockReturnValue(undefined),
    getCurrentAgentVersion: jest.fn().mockReturnValue(null),
  };
});
jest.mock('../base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('Vertex AI Cross-Language Trace Comparison', () => {
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
    (OpenLitHelper as any).buildInputMessages = jest.fn().mockReturnValue('[{"role":"user","parts":[{"type":"text","content":"Hello"}]}]');
    (OpenLitHelper as any).buildOutputMessages = jest.fn().mockReturnValue('[{"role":"assistant","parts":[{"type":"text","content":"Hi"}],"finish_reason":"STOP"}]');
    (OpenLitHelper as any).emitInferenceEvent = jest.fn();
    (OpenLitHelper as any).buildToolDefinitions = jest.fn().mockReturnValue(undefined);
    (OpenLitHelper as any).computeAgentVersionHash = jest.fn().mockReturnValue(null);

    (BaseWrapper as any).recordMetrics = jest.fn();
    (BaseWrapper as any).setBaseSpanAttributes = jest.fn().mockImplementation((span: any, attrs: any) => {
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
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateContent — non-streaming', () => {
    it('sets provider name to vertex_ai (matches Python GEN_AI_SYSTEM_VERTEXAI)', async () => {
      const mockArgs = [{
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 256, topP: 0.9 },
      }];
      const mockResponse = {
        response: {
          candidates: [{
            content: { parts: [{ text: 'Hi there!' }], role: 'model' },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL,
        'vertex_ai'
      );
    });

    it('sets request params only when explicitly provided', async () => {
      const mockArgs = [{
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 100, topP: 0.8, topK: 40 },
      }];
      const mockResponse = {
        response: {
          candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.5);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_P, 0.8);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_K, 40);
    });

    it('omits request params when not set (no sentinel values)', async () => {
      const mockArgs = [{ contents: 'Hello', generationConfig: {} }];
      const mockResponse = {
        response: {
          candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
      });

      const attrKeys = mockSpan.setAttribute.mock.calls.map((c: any[]) => c[0]);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_TOP_P);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_TOP_K);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES);
    });

    it('sets token usage and server address from location', async () => {
      const mockArgs = [{ contents: 'Ping', generationConfig: {} }];
      const mockResponse = {
        response: {
          candidates: [{ content: { parts: [{ text: 'Pong' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'europe-west1-aiplatform.googleapis.com',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 5);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.SERVER_ADDRESS,
        'europe-west1-aiplatform.googleapis.com'
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.SERVER_PORT, 443);
    });

    it('sets finish reason as array (matches Python list)', async () => {
      const mockArgs = [{ contents: 'Hello', generationConfig: {} }];
      const mockResponse = {
        response: {
          candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['STOP']
      );
    });

    it('sets is_stream=false for non-streaming', async () => {
      const mockArgs = [{ contents: 'Hello', generationConfig: {} }];
      const mockResponse = {
        response: {
          candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
    });

    it('captures function call attributes', async () => {
      const mockArgs = [{ contents: 'What is the weather?', generationConfig: {} }];
      const mockResponse = {
        response: {
          candidates: [{
            content: {
              parts: [{ functionCall: { name: 'get_weather', args: { city: 'Berlin' } } }],
              role: 'model',
            },
            finishReason: 'STOP',
          }],
          usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4, totalTokenCount: 10 },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_TOOL_NAME, 'get_weather');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_ARGS,
        '{"city":"Berlin"}'
      );
    });

    it('emits inference event independently of captureMessageContent', async () => {
      (OpenlitConfig as any).captureMessageContent = false;

      const mockArgs = [{ contents: 'Hello', generationConfig: {} }];
      const mockResponse = {
        response: {
          candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
      });

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalledTimes(1);
      const eventAttrs = (OpenLitHelper.emitInferenceEvent as jest.Mock).mock.calls[0][1];
      expect(eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES]).toBeUndefined();
      expect(eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES]).toBeUndefined();
    });

    it('records metrics with cost from pricingInfo', async () => {
      (OpenlitConfig as any).pricingInfo = { chat: { 'gemini-2.0-flash': { promptPrice: 0.1, completionPrice: 0.2 } } };
      (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.003);

      const mockArgs = [{ contents: 'Hello', generationConfig: {} }];
      const mockResponse = {
        response: {
          candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          model: 'gemini-2.0-flash',
          cost: 0.003,
          aiSystem: 'vertex_ai',
        })
      );
    });
  });

  describe('model name extraction', () => {
    it('strips full projects/locations/publishers/models/ resource path', () => {
      const instance = {
        model: 'projects/my-project/locations/us-central1/publishers/google/models/gemini-2.0-flash',
      };
      expect(VertexAIWrapper._extractModelName(instance)).toBe('gemini-2.0-flash');
    });

    it('strips publishers/google/models/ prefix', () => {
      const instance = { model: 'publishers/google/models/gemini-pro' };
      expect(VertexAIWrapper._extractModelName(instance)).toBe('gemini-pro');
    });

    it('leaves a plain model name unchanged', () => {
      const instance = { model: 'gemini-2.0-flash' };
      expect(VertexAIWrapper._extractModelName(instance)).toBe('gemini-2.0-flash');
    });

    it('falls back to gemini-2.0-flash when instance has no model field', () => {
      expect(VertexAIWrapper._extractModelName({})).toBe('gemini-2.0-flash');
    });

    it('reads model from resourcePath (ChatSession shape)', () => {
      const instance = {
        resourcePath: 'projects/my-project/locations/us-central1/publishers/google/models/gemini-1.5-pro',
      };
      expect(VertexAIWrapper._extractModelName(instance)).toBe('gemini-1.5-pro');
    });

    it('reads model from generativeModel property', () => {
      const instance = { generativeModel: { model: 'gemini-1.5-pro' } };
      expect(VertexAIWrapper._extractModelName(instance)).toBe('gemini-1.5-pro');
    });
  });

  describe('ChatSession.sendMessage', () => {
    it('captures the turn message as input and reads session config from instance', async () => {
      const mockArgs = ['What is the capital of France?'];
      const mockInstance = {
        generationConfig: { temperature: 0.4, maxOutputTokens: 128 },
        systemInstruction: { parts: [{ text: 'You are a geography tutor.' }] },
      };
      const mockResponse = {
        response: {
          candidates: [{ content: { parts: [{ text: 'Paris' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 },
        },
      };

      (OpenLitHelper as any).buildInputMessages = jest
        .fn()
        .mockReturnValue('[{"role":"user","parts":[{"type":"text","content":"What is the capital of France?"}]}]');

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        instance: mockInstance,
        genAIEndpoint: 'vertexai.generative_models.chat_session.send_message',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
        isChatSession: true,
      });

      expect(OpenLitHelper.buildInputMessages).toHaveBeenCalledWith([
        { role: 'user', content: 'What is the capital of France?' },
      ]);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.4);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 128);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
        8
      );
    });
  });

  describe('custom span attributes', () => {
    it('applies global custom attributes via setBaseSpanAttributes', async () => {
      const actualBaseWrapper = jest.requireActual('../base-wrapper').default;
      (BaseWrapper as any).setBaseSpanAttributes = actualBaseWrapper.setBaseSpanAttributes;
      (OpenlitConfig as any).customSpanAttributes = { 'team.id': 'eng-ml' };

      const mockArgs = [{ contents: 'Hello', generationConfig: {} }];
      const mockResponse = {
        response: {
          candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('team.id', 'eng-ml');
    });

    it('applies custom attributes on failed requests before span end', async () => {
      (OpenlitConfig as any).customSpanAttributes = { 'request.source': 'batch' };

      const errorSpan = {
        setAttribute: jest.fn(),
        end: jest.fn(),
        setStatus: jest.fn(),
        recordException: jest.fn(),
      };
      const tracer = {
        startSpan: jest.fn().mockReturnValue(errorSpan),
      };

      const patcher = VertexAIWrapper._patchGenerateContent(tracer as any);
      const failingMethod = patcher(async () => {
        throw new Error('vertex unavailable');
      });

      await expect(
        failingMethod.call({ model: 'gemini-2.0-flash', location: 'us-central1' }, {
          contents: 'Hello',
          generationConfig: {},
        })
      ).rejects.toThrow('vertex unavailable');

      expect(errorSpan.setAttribute).toHaveBeenCalledWith('request.source', 'batch');
    });
  });

  describe('cache token attributes', () => {
    it('sets cache_read_input_tokens when non-zero', async () => {
      const mockArgs = [{ contents: 'Hello', generationConfig: {} }];
      const mockResponse = {
        response: {
          candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
            cachedContentTokenCount: 3,
          },
        },
      };

      await VertexAIWrapper._processResponse({
        args: mockArgs,
        genAIEndpoint: 'vertexai.generative_models.generate_content',
        response: mockResponse,
        span: mockSpan,
        requestModel: 'gemini-2.0-flash',
        serverAddress: 'us-central1-aiplatform.googleapis.com',
      });

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        3
      );
    });
  });
});
